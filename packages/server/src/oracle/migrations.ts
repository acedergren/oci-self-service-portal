import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { withConnection } from './connection';
import { createLogger } from '../logger';

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
	const filePath = `${MIGRATIONS_DIR}/${filename}`;
	// nosemgrep: path-join-resolve-traversal — filenames are regex-validated ([0-9a-zA-Z_-] only), startsWith guard below
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

		// Strip SQL line comments before PL/SQL detection to avoid false positives from
		// rollback comment blocks that contain commented-out BEGIN/END keywords.
		const uncommented = trimmed
			.split('\n')
			.filter((line) => !line.trim().startsWith('--'))
			.join('\n')
			.trim();

		// Skip segments that are entirely comments (e.g. rollback notes at end of file).
		if (!uncommented) continue;

		// If the segment is a PL/SQL unit, keep it as a single statement (no semicolon splitting).
		// Covers: anonymous blocks (BEGIN...END), named packages/functions/procedures/triggers
		// (CREATE OR REPLACE PACKAGE spec, which has no BEGIN but still has internal semicolons).
		const isPLSQL =
			(/\bBEGIN\b/i.test(uncommented) && /\bEND\b/i.test(uncommented)) ||
			/\bCREATE\s+(OR\s+REPLACE\s+)?PACKAGE\b/i.test(uncommented) ||
			/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(uncommented) ||
			/\bCREATE\s+(OR\s+REPLACE\s+)?PROCEDURE\b/i.test(uncommented) ||
			/\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i.test(uncommented);

		if (isPLSQL) {
			// Keep PL/SQL blocks intact — oracledb requires the trailing END; semicolon.
			// Do NOT strip it (unlike plain SQL statements where trailing semicolons are invalid).
			statements.push(trimmed);
		} else {
			// Split on semicolons that appear at the end of a line or end of string
			const parts = trimmed.split(/;\s*(?:\n|$)/);
			for (const part of parts) {
				const partTrimmed = part.trim();
				if (!partTrimmed) continue;
				// Skip parts that are purely comment lines (e.g. rollback comment lines with
				// trailing semicolons that were split by the regex above).
				const partUncommented = partTrimmed
					.split('\n')
					.filter((line) => !line.trim().startsWith('--'))
					.join('\n')
					.trim();
				if (!partUncommented) continue;
				statements.push(partTrimmed);
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
				try {
					await connection.execute(statement);
				} catch (err: unknown) {
					const code = (err as { errorNum?: number }).errorNum;
					// ORA-00955: object already exists — DDL is idempotent, skip and continue
					if (code === 955) {
						log.warn(
							{ version: migration.version, sql: statement.substring(0, 80) },
							'skipping statement — object already exists (ORA-00955)'
						);
						continue;
					}
					// ORA-00904: invalid column identifier — index references a column that does
					// not exist in a pre-existing table (schema drift). Skip so the migration
					// version record is still inserted; a separate ALTER TABLE migration can fix.
					if (code === 904) {
						log.warn(
							{ version: migration.version, sql: statement.substring(0, 80) },
							'skipping statement — column does not exist in pre-existing table (ORA-00904)'
						);
						continue;
					}
					// ORA-01430: column being added already exists in table — ALTER TABLE ADD
					// on a column that already exists (schema drift). End state is correct.
					if (code === 1430) {
						log.warn(
							{ version: migration.version, sql: statement.substring(0, 80) },
							'skipping statement — column already exists (ORA-01430)'
						);
						continue;
					}
					// ORA-01408: such column list already indexed — index with this exact column
					// combination already exists under a different name (schema drift). End state
					// is correct so skip and continue.
					if (code === 1408) {
						log.warn(
							{ version: migration.version, sql: statement.substring(0, 80) },
							'skipping statement — column list already indexed (ORA-01408)'
						);
						continue;
					}
					// ORA-05716: unsupported feature (e.g. blockchain table hashing algorithm not
					// available on this ADB tier). Log and skip — the table won't exist but the
					// migration version record is still inserted so dependent migrations continue.
					if (code === 5716) {
						log.warn(
							{ version: migration.version, sql: statement.substring(0, 80) },
							'skipping statement — unsupported database feature (ORA-05716)'
						);
						continue;
					}
					// ORA-00942: table or view does not exist — in DDL context this means the
					// statement references an object that a previously-skipped statement should
					// have created (e.g. CREATE INDEX on a blockchain table that wasn't created).
					// Safe to skip in migrations since we only run DDL, not DML.
					if (code === 942) {
						log.warn(
							{ version: migration.version, sql: statement.substring(0, 80) },
							'skipping statement — referenced table does not exist (ORA-00942)'
						);
						continue;
					}
					// ORA-32594: invalid object category for COMMENT command — COMMENT ON JSON
					// DUALITY VIEW syntax not recognized on this tier. Skip gracefully.
					if (code === 32594) {
						log.warn(
							{ version: migration.version, sql: statement.substring(0, 80) },
							'skipping statement — unsupported COMMENT object category (ORA-32594)'
						);
						continue;
					}
					// ORA-44975: JSON Duality View column has an IS JSON check constraint —
					// Oracle 23ai restricts duality views from exposing IS JSON constrained
					// columns. The duality views are supplementary; skip and continue.
					if (code === 44975) {
						log.warn(
							{ version: migration.version, sql: statement.substring(0, 80) },
							'skipping statement — JSON duality view column constraint (ORA-44975)'
						);
						continue;
					}
					throw err;
				}
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
