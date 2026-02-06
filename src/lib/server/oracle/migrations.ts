import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { withConnection } from './connection.js';
import { createLogger } from '../logger.js';

const log = createLogger('migrations');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Hardcoded migrations directory resolved at module load time. */
const MIGRATIONS_DIR = resolve(__dirname, 'migrations');

export interface Migration {
	version: number;
	name: string;
	sql: string;
}

/**
 * Read a migration file safely, ensuring the resolved path stays within
 * MIGRATIONS_DIR to prevent path traversal.
 */
function readMigrationFile(filename: string): string {
	// nosemgrep: path-join-resolve-traversal
	const filePath = `${MIGRATIONS_DIR}/${filename}`;
	const resolved = resolve(filePath);

	if (!resolved.startsWith(MIGRATIONS_DIR + '/')) {
		throw new Error(`Path traversal detected: ${filename}`);
	}

	return readFileSync(resolved, 'utf-8');
}

/**
 * Load migration files from the migrations/ subdirectory.
 * Files are named like 001-core.sql, 002-vector.sql.
 */
export function loadMigrations(): Migration[] {
	const files = readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort();

	return files.map((file) => {
		const match = file.match(/^(\d+)-([a-zA-Z0-9_-]+)\.sql$/);
		if (!match) {
			throw new Error(`Invalid migration filename: ${file}. Expected format: 001-name.sql`);
		}

		const version = parseInt(match[1], 10);
		const name = match[2];

		// Reconstruct a safe filename from validated capture groups to prevent
		// any path traversal — only alphanumeric, hyphens, and underscores pass.
		const safeFilename = `${match[1]}-${name}.sql`;
		const sql = readMigrationFile(safeFilename);

		return { version, name, sql };
	});
}

/**
 * Split an Oracle SQL file into individual executable statements.
 *
 * Handles two delimiters:
 *   1. A forward slash `/` on its own line (PL/SQL block terminator)
 *   2. A semicolon at the end of a DDL/DML line (but NOT inside PL/SQL blocks)
 *
 * Strategy: first split on standalone `/` lines. For each resulting segment,
 * if it contains a PL/SQL block (BEGIN...END), treat the whole segment as one
 * statement. Otherwise split further on semicolons followed by a newline.
 */
function splitStatements(sql: string): string[] {
	// Split on lines that contain only a forward slash (with optional whitespace)
	const segments = sql.split(/\n\s*\/\s*\n/);

	const statements: string[] = [];

	for (const segment of segments) {
		const trimmed = segment.trim();
		if (!trimmed) continue;

		// If the segment contains a PL/SQL block, keep it as a single statement
		const isPLSQL = /\bBEGIN\b/i.test(trimmed) && /\bEND\b/i.test(trimmed);

		if (isPLSQL) {
			// Remove any trailing semicolon from the outer block
			const cleaned = trimmed.replace(/;\s*$/, '');
			if (cleaned) {
				statements.push(cleaned);
			}
		} else {
			// Split on semicolons that appear at the end of a line or end of string
			const parts = trimmed.split(/;\s*(?:\n|$)/);
			for (const part of parts) {
				const partTrimmed = part.trim();
				if (partTrimmed) {
					statements.push(partTrimmed);
				}
			}
		}
	}

	return statements;
}

/**
 * Ensure the schema_migrations tracking table exists.
 */
async function ensureMigrationsTable(): Promise<void> {
	await withConnection(async (connection) => {
		await connection.execute(`
			BEGIN
				EXECUTE IMMEDIATE '
					CREATE TABLE schema_migrations (
						version    NUMBER PRIMARY KEY,
						name       VARCHAR2(255) NOT NULL,
						applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
					)
				';
			EXCEPTION
				WHEN OTHERS THEN
					IF SQLCODE != -955 THEN
						RAISE;
					END IF;
			END;
		`);
		await connection.commit();
	});
}

/**
 * Query the schema_migrations table for already-applied version numbers.
 */
export async function getAppliedVersions(): Promise<number[]> {
	return withConnection(async (connection) => {
		const result = await connection.execute<{ VERSION: number }>(
			'SELECT version FROM schema_migrations ORDER BY version'
		);

		if (!result.rows) return [];
		return result.rows.map((row) => row.VERSION);
	});
}

/**
 * Run all pending migrations in order.
 *
 * - Creates the schema_migrations table if it does not exist
 * - Loads migration SQL files from disk
 * - Skips already-applied migrations
 * - Executes each pending migration's statements one at a time
 * - Records each successful migration in schema_migrations
 */
export async function runMigrations(): Promise<void> {
	log.info('starting migration run');

	await ensureMigrationsTable();

	const migrations = loadMigrations();
	const applied = await getAppliedVersions();
	const appliedSet = new Set(applied);

	const pending = migrations.filter((m) => !appliedSet.has(m.version));

	if (pending.length === 0) {
		log.info('no pending migrations');
		return;
	}

	log.info({ count: pending.length }, 'pending migrations found');

	for (const migration of pending) {
		log.info({ version: migration.version, name: migration.name }, 'applying migration');

		const statements = splitStatements(migration.sql);

		await withConnection(async (connection) => {
			for (const statement of statements) {
				log.debug(
					{ version: migration.version, sql: statement.substring(0, 120) },
					'executing statement'
				);
				await connection.execute(statement);
			}

			await connection.execute(
				'INSERT INTO schema_migrations (version, name) VALUES (:version, :name)',
				{ version: migration.version, name: migration.name }
			);

			await connection.commit();
		});

		log.info({ version: migration.version, name: migration.name }, 'migration applied');
	}

	log.info({ applied: pending.length }, 'migration run complete');
}
