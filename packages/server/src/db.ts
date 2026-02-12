import { getConnection, StateRepository } from './agent-state/index.js';

/** @deprecated Use Oracle repositories from './oracle' instead */
let repository: StateRepository | null = null;

/** @deprecated Use Oracle repositories from './oracle' instead */
export function getRepository(): StateRepository {
	if (!repository) {
		const db = getConnection();
		repository = new StateRepository(db);
	}
	return repository;
}

// Re-export Oracle DB utilities for convenience
export { withConnection, initPool, closePool } from './oracle/connection.js';
