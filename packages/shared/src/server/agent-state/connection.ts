// packages/agent-state/src/connection.ts
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initializeSchema } from './schema';

/**
 * Singleton connection state.
 *
 * Note: This singleton is intentionally synchronous because better-sqlite3
 * is a synchronous library. No race condition concerns exist for the
 * connection initialization since all operations are blocking.
 */
interface ConnectionState {
	db: Database.Database | null;
	path: string | null;
}

const state: ConnectionState = {
	db: null,
	path: null
};

const DEFAULT_DB_DIR = path.join(os.homedir(), '.oci-provider-examples');
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, 'agent-state.db');

/**
 * Get the database path from environment or default.
 */
export function getDatabasePath(): string {
	return process.env.AGENT_STATE_DB_PATH ?? DEFAULT_DB_PATH;
}

/**
 * Ensure the directory for the database file exists.
 */
function ensureDirectory(dbPath: string): void {
	const dir = path.dirname(dbPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/**
 * Get or create the database connection.
 *
 * Uses singleton pattern - returns same connection on subsequent calls.
 * Automatically initializes schema on first connection.
 *
 * @param customPath - Optional custom database path. If provided after a
 *                     connection already exists with a different path, throws an error.
 * @throws Error if customPath differs from existing connection's path
 */
export function getConnection(customPath?: string): Database.Database {
	const requestedPath = customPath ?? getDatabasePath();

	if (state.db) {
		// Validate that the requested path matches the existing connection
		if (state.path && requestedPath !== state.path) {
			throw new Error(
				`Connection already exists to "${state.path}". ` +
					`Cannot connect to "${requestedPath}". ` +
					`Call resetConnection() first to connect to a different database.`
			);
		}
		return state.db;
	}

	ensureDirectory(requestedPath);

	state.db = new Database(requestedPath);
	state.path = requestedPath;

	// Enable WAL mode for better concurrent access
	state.db.pragma('journal_mode = WAL');

	// Enable foreign keys
	state.db.pragma('foreign_keys = ON');

	// Initialize schema
	initializeSchema(state.db);

	return state.db;
}

/**
 * Close the database connection.
 * Useful for graceful shutdown. Does not clear the singleton state,
 * so subsequent getConnection() calls will fail until resetConnection() is called.
 */
export function closeConnection(): void {
	if (state.db) {
		state.db.close();
		state.db = null;
	}
}

/**
 * Reset the connection state completely.
 *
 * Closes the connection and clears singleton state, allowing a new
 * connection to be established with a different path. Essential for:
 * - Testing with multiple database files
 * - Switching databases at runtime
 */
export function resetConnection(): void {
	closeConnection();
	state.path = null;
}

/**
 * Get the current connection path, or null if no connection exists.
 * Useful for debugging and testing.
 */
export function getConnectionPath(): string | null {
	return state.path;
}
