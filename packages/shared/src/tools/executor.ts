import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import { OCIError } from '../server/errors';
import { wrapWithSpan, captureError } from '../server/sentry';

const execFileAsync = promisify(execFile);

/**
 * Get the default compartment ID from environment
 */
export function getDefaultCompartmentId(): string | undefined {
	return process.env.OCI_COMPARTMENT_ID;
}

/**
 * Require a compartment ID, falling back to env var
 */
export function requireCompartmentId(args: Record<string, unknown>): string {
	const compartmentId = (args.compartmentId as string) || getDefaultCompartmentId();
	if (!compartmentId) {
		throw new OCIError('No compartmentId provided and OCI_COMPARTMENT_ID not set', {
			field: 'compartmentId'
		});
	}
	return compartmentId;
}

/**
 * Execute an OCI CLI command safely (synchronous)
 */
export function executeOCI(args: string[]): unknown {
	try {
		const output = execFileSync('oci', args, {
			encoding: 'utf-8',
			timeout: 60000,
			maxBuffer: 10 * 1024 * 1024 // 10MB
		});
		return JSON.parse(output);
	} catch (error: unknown) {
		const execError = error as { stderr?: string; message?: string; status?: number };
		throw new OCIError(
			`OCI CLI error: ${execError.stderr || execError.message}`,
			{ command: `oci ${args.join(' ')}`, exitCode: execError.status, stderr: execError.stderr },
			error instanceof Error ? error : undefined
		);
	}
}

/**
 * Execute an OCI CLI command asynchronously (for composite/multi-step operations)
 */
export async function executeOCIAsync(args: string[]): Promise<unknown> {
	return wrapWithSpan(`oci ${args.slice(0, 3).join(' ')}`, 'oci.cli', async () => {
		try {
			const { stdout } = await execFileAsync('oci', args, {
				encoding: 'utf-8',
				timeout: 120000,
				maxBuffer: 10 * 1024 * 1024
			});
			return JSON.parse(stdout);
		} catch (error: unknown) {
			const execError = error as { stderr?: string; message?: string; status?: number };
			const ociErr = new OCIError(
				`OCI CLI error: ${execError.stderr || execError.message}`,
				{ command: `oci ${args.join(' ')}`, exitCode: execError.status, stderr: execError.stderr },
				error instanceof Error ? error : undefined
			);
			captureError(ociErr);
			throw ociErr;
		}
	});
}

/**
 * Slim down OCI CLI responses to only include fields the AI needs.
 * Raw OCI CLI output contains many internal fields that bloat tool results
 * and can exceed model context limits (e.g. listShapes = 346KB raw).
 */
export function slimOCIResponse(data: unknown, pickFields: string[]): unknown {
	if (!data || typeof data !== 'object') return data;
	const obj = data as Record<string, unknown>;
	if (Array.isArray(obj.data)) {
		return { data: obj.data.map((item: Record<string, unknown>) => pick(item, pickFields)) };
	}
	if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
		return { data: pick(obj.data as Record<string, unknown>, pickFields) };
	}
	return data;
}

function pick(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const field of fields) {
		if (field in obj) result[field] = obj[field];
	}
	return result;
}

/**
 * Round a date to midnight UTC (usage API requires this precision)
 */
export function toMidnightUTC(d: Date): string {
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T00:00:00.000Z`;
}
