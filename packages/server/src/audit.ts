import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { createLogger } from './logger.js';
import { auditRepository } from './oracle/repositories/audit-repository.js';
import { blockchainAuditRepository } from './oracle/repositories/blockchain-audit-repository.js';
import { fireWebhookEvent } from './webhooks.js';
import type { InsertToolExecution } from './oracle/types.js';
import type { BlockchainAuditEntry } from '@portal/types/server/api/types.js';

const log = createLogger('audit');

/**
 * Audit log entry for tool operations
 */
export interface AuditLogEntry {
	id: string;
	timestamp: string;
	sessionId?: string;
	userId?: string;

	// Tool information
	toolName: string;
	toolCategory: string;
	approvalLevel: 'auto' | 'confirm' | 'danger';

	// Operation details
	action: 'requested' | 'approved' | 'rejected' | 'executed' | 'failed';
	args: Record<string, unknown>;

	// For sensitive args, we redact values but keep keys for debugging
	redactedArgs?: Record<string, string>;

	// Result (only for executed/failed)
	success?: boolean;
	error?: string;
	duration?: number;

	// Context
	userAgent?: string;
	ipAddress?: string;
}

/**
 * Sensitive parameter names that should be redacted in logs
 */
const SENSITIVE_PARAMS = [
	'password',
	'secret',
	'key',
	'token',
	'credential',
	'privateKey',
	'apiKey'
];

/**
 * Redact sensitive values from arguments
 */
function redactSensitiveArgs(args: Record<string, unknown>): Record<string, string> {
	const redacted: Record<string, string> = {};

	for (const [key, value] of Object.entries(args)) {
		const lowerKey = key.toLowerCase();
		const isSensitive = SENSITIVE_PARAMS.some((param) => lowerKey.includes(param));

		if (isSensitive) {
			redacted[key] = '[REDACTED]';
		} else if (typeof value === 'string' && value.startsWith('ocid1.')) {
			// Keep OCIDs but truncate for readability
			redacted[key] = value.substring(0, 30) + '...';
		} else if (typeof value === 'object') {
			redacted[key] = '[object]';
		} else {
			redacted[key] = String(value);
		}
	}

	return redacted;
}

// ── JSONL file fallback ─────────────────────────────────────────────────────

/**
 * Get the audit log directory path
 */
function getAuditLogDir(): string {
	const baseDir = process.env.AUDIT_LOG_DIR || join(process.cwd(), 'data', 'audit');

	if (!existsSync(baseDir)) {
		mkdirSync(baseDir, { recursive: true });
	}

	return baseDir;
}

/**
 * Validate and sanitize a date string to prevent path traversal.
 * Only allows YYYY-MM-DD format.
 */
function sanitizeDateParam(date: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw new Error(`Invalid date format: expected YYYY-MM-DD, got "${date}"`);
	}
	return date;
}

/**
 * Build an audit log file path, ensuring it stays within the audit directory.
 */
function safeAuditLogPath(date: string): string {
	const dir = getAuditLogDir();
	const safeDate = sanitizeDateParam(date);
	const candidate = resolve(dir, `audit-${safeDate}.jsonl`);

	if (!candidate.startsWith(dir + '/')) {
		throw new Error('Path traversal detected in audit log path');
	}

	return candidate;
}

/**
 * Get the current audit log file path (daily rotation)
 */
function getAuditLogPath(): string {
	const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
	return safeAuditLogPath(date);
}

/**
 * Generate a unique audit log entry ID
 */
function generateAuditId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 8);
	return `audit_${timestamp}_${random}`;
}

/**
 * Write an audit log entry to a JSONL file (fallback when Oracle is unavailable)
 */
function writeAuditLogToFile(entry: AuditLogEntry): void {
	const logPath = getAuditLogPath();
	const line = JSON.stringify(entry) + '\n';

	try {
		appendFileSync(logPath, line, 'utf-8');
	} catch (error) {
		log.error({ err: error, entry }, 'failed to write audit log to file');
	}
}

/**
 * Write an audit log entry.
 * Tries Oracle first; falls back to JSONL file if the DB write fails.
 */
export function writeAuditLog(
	entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'redactedArgs'>
): void {
	const fullEntry: AuditLogEntry = {
		id: generateAuditId(),
		timestamp: new Date().toISOString(),
		redactedArgs: redactSensitiveArgs(entry.args),
		...entry
	};

	// Map to Oracle schema and attempt DB write
	const dbEntry: InsertToolExecution = {
		sessionId: entry.sessionId,
		userId: entry.userId,
		toolName: entry.toolName,
		toolCategory: entry.toolCategory,
		approvalLevel: entry.approvalLevel,
		action: entry.action,
		args: entry.args,
		redactedArgs: fullEntry.redactedArgs as Record<string, unknown> | undefined,
		success: entry.success,
		error: entry.error,
		durationMs: entry.duration,
		ipAddress: entry.ipAddress,
		userAgent: entry.userAgent
	};

	auditRepository.write(dbEntry).catch((err) => {
		log.warn({ err }, 'Oracle audit write failed, falling back to JSONL');
		writeAuditLogToFile(fullEntry);
	});

	// Dual-write to blockchain audit table (tamper-proof ledger).
	// Failures are logged but never block the request.
	const blockchainEntry: BlockchainAuditEntry = {
		userId: entry.userId ?? 'anonymous',
		orgId: entry.sessionId ? undefined : undefined,
		action: `tool.${entry.action}`,
		toolName: entry.toolName,
		resourceType: entry.toolCategory,
		detail: {
			approvalLevel: entry.approvalLevel,
			success: entry.success,
			duration: entry.duration,
			error: entry.error
		},
		ipAddress: entry.ipAddress
	};

	blockchainAuditRepository.insert(blockchainEntry).catch((err) => {
		log.warn({ err }, 'Blockchain audit write failed (non-critical)');
	});
}

/**
 * Log a tool request (before approval)
 */
export function logToolRequest(
	toolName: string,
	toolCategory: string,
	approvalLevel: 'auto' | 'confirm' | 'danger',
	args: Record<string, unknown>,
	sessionId?: string,
	userId?: string
): string {
	const entryId = generateAuditId();

	writeAuditLog({
		toolName,
		toolCategory,
		approvalLevel,
		action: 'requested',
		args,
		sessionId,
		userId
	});

	return entryId;
}

/**
 * Log a tool approval decision
 */
export function logToolApproval(
	toolName: string,
	toolCategory: string,
	approvalLevel: 'auto' | 'confirm' | 'danger',
	args: Record<string, unknown>,
	approved: boolean,
	sessionId?: string,
	userId?: string
): void {
	writeAuditLog({
		toolName,
		toolCategory,
		approvalLevel,
		action: approved ? 'approved' : 'rejected',
		args,
		sessionId,
		userId
	});
}

/**
 * Log a tool execution result
 */
export function logToolExecution(
	toolName: string,
	toolCategory: string,
	approvalLevel: 'auto' | 'confirm' | 'danger',
	args: Record<string, unknown>,
	success: boolean,
	duration: number,
	error?: string,
	sessionId?: string,
	userId?: string,
	orgId?: string
): void {
	writeAuditLog({
		toolName,
		toolCategory,
		approvalLevel,
		action: success ? 'executed' : 'failed',
		args,
		success,
		error,
		duration,
		sessionId,
		userId
	});

	// Fire webhook event (non-blocking) when org context is available
	if (orgId) {
		fireWebhookEvent({
			type: 'tool.executed',
			orgId,
			data: {
				toolName,
				toolCategory,
				approvalLevel,
				success,
				duration,
				error
			}
		});
	}
}

/**
 * Audit log summary for a time period
 */
export interface AuditSummary {
	period: { start: string; end: string };
	totalRequests: number;
	byAction: Record<string, number>;
	byCategory: Record<string, number>;
	byApprovalLevel: Record<string, number>;
	failures: number;
	rejections: number;
}

/**
 * Parse audit log entries from a JSONL file (for reporting).
 * This reads from the file-based fallback logs.
 */
export async function parseAuditLog(date: string): Promise<AuditLogEntry[]> {
	const { readFileSync } = await import('fs');
	const logPath = safeAuditLogPath(date);

	if (!existsSync(logPath)) {
		return [];
	}

	const content = readFileSync(logPath, 'utf-8');
	const lines = content.trim().split('\n').filter(Boolean);

	return lines.map((line) => JSON.parse(line) as AuditLogEntry);
}
