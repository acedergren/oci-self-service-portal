import { afterEach, vi } from 'vitest';

// Stable forwarding mock for @portal/server/logger.
//
// With vitest `mockReset: true`, mock implementations are reset between tests.
// Keep the module mock stable and forward to a variable that tests can
// reconfigure as needed.

type LoggerLike = {
	info: ReturnType<typeof vi.fn>;
	warn: ReturnType<typeof vi.fn>;
	error: ReturnType<typeof vi.fn>;
	fatal: ReturnType<typeof vi.fn>;
	debug: ReturnType<typeof vi.fn>;
	child: ReturnType<typeof vi.fn>;
};

function createLoggerMock(): LoggerLike {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	};
}

let currentLogger: LoggerLike = createLoggerMock();

export function __setLoggerMock(next: LoggerLike): void {
	currentLogger = next;
}

export function __resetLoggerMock(): void {
	currentLogger = createLoggerMock();
}

vi.mock('@portal/server/logger', () => ({
	createLogger: () => currentLogger
}));

// Keep the logger mock stable between tests even with `mockReset: true`.
// Vitest resets mocks after each test; we re-initialize our forwarding target.
afterEach(() => {
	__resetLoggerMock();
});
