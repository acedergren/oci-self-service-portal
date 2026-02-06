import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { execFile } from 'node:child_process';
import { withConnection } from '$lib/server/oracle/connection.js';

const APP_VERSION = '0.1.0';

function checkOciCli(): Promise<boolean> {
	return new Promise((resolve) => {
		execFile('oci', ['--version'], { timeout: 5000 }, (error) => {
			resolve(!error);
		});
	});
}

export const GET: RequestHandler = async ({ locals }) => {
	const ociCliAvailable = await checkOciCli();

	let dbStatus: string = 'not_configured';
	if (locals.dbAvailable) {
		try {
			await withConnection(async (conn) => {
				await conn.execute('SELECT 1 FROM DUAL');
			});
			dbStatus = 'ok';
		} catch {
			dbStatus = 'error';
		}
	}

	const checks: Record<string, boolean | string> = {
		oci_cli: ociCliAvailable,
		database: dbStatus
	};

	const hasCriticalFailure = !ociCliAvailable || dbStatus === 'error';
	const status = hasCriticalFailure ? 'degraded' : 'ok';

	return json({
		status,
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
		version: APP_VERSION,
		checks
	});
};
