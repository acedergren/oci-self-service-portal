import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, simulateSession } from '../routes/test-helpers.js';
import workflowRoutes from '../../routes/workflows.js';
import {
	emitWorkflowStream,
	clearWorkflowStreamState
} from '../../services/workflow-stream-bus.js';

interface RepoMock {
	proxy: Record<string | symbol, ReturnType<typeof vi.fn>>;
	ensure: (name: string | symbol) => ReturnType<typeof vi.fn>;
	reset: () => void;
}

function createRepoMock(): RepoMock {
	const methods = new Map<string | symbol, ReturnType<typeof vi.fn>>();
	const ensure = (name: string | symbol) => {
		if (!methods.has(name)) {
			methods.set(name, vi.fn());
		}
		return methods.get(name)!;
	};

	return {
		proxy: new Proxy(
			{},
			{
				get: (_target, prop: string | symbol) => ensure(prop)
			}
		),
		ensure,
		reset: () => {
			methods.forEach((fn) => fn.mockReset());
		}
	};
}

const workflowRepo = createRepoMock();
const runsRepo = createRepoMock();
const stepsRepo = createRepoMock();

vi.mock('../../services/workflow-repository.js', () => ({
	createWorkflowRepository: () => workflowRepo.proxy,
	createWorkflowRunRepository: () => runsRepo.proxy,
	createWorkflowRunStepRepository: () => stepsRepo.proxy
}));

describe('Workflow SSE stream', () => {
	let app: FastifyInstance;

	const fakeOracle = {
		isAvailable: () => true,
		withConnection: async (fn: (conn: unknown) => unknown) => fn({})
	};

	beforeEach(async () => {
		clearWorkflowStreamState();
		workflowRepo.reset();
		runsRepo.reset();
		stepsRepo.reset();

		app = await buildTestApp({ withRbac: true });
		app.decorate('oracle', fakeOracle);
		simulateSession(app, { id: 'user-1' }, ['workflows:read']);
		app.addHook('onRequest', async (request) => {
			(request as Record<string, unknown>).session = { activeOrganizationId: 'org-1' };
			(request as Record<string, unknown>).apiKeyContext = {
				orgId: 'org-1',
				permissions: ['workflows:read']
			};
		});

		await app.register(workflowRoutes);
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	it('emits step and status events with explicit event names', async () => {
		const workflowId = '12345678-1234-4123-8123-123456789012';
		const runId = '13345678-1234-4123-8123-123456789012';
		const runRecord = {
			id: runId,
			definitionId: workflowId,
			status: 'running',
			output: null,
			error: null
		};

		runsRepo.ensure('getByIdForUser').mockResolvedValue(runRecord);
		runsRepo.ensure('getByIdForOrg').mockResolvedValue(runRecord);

		const responsePromise = app.inject({
			method: 'GET',
			url: `/api/v1/workflows/${workflowId}/runs/${runId}/stream`
		});

		// Allow the route handler to subscribe before emitting events
		await new Promise((resolve) => setTimeout(resolve, 0));

		emitWorkflowStream({
			type: 'step',
			runId,
			stage: 'start',
			nodeId: 'aiStep1',
			nodeType: 'ai-step',
			payload: { tokens: 24 }
		});

		emitWorkflowStream({
			type: 'status',
			runId,
			status: 'completed',
			output: { summary: 'ok' },
			error: null
		});

		const res = await responsePromise;
		expect(res.statusCode).toBe(200);
		expect(res.body).toContain('event: step');
		expect(res.body).toContain('"nodeId":"aiStep1"');
		expect(res.body).toContain('event: status');
		expect(res.body).toContain('"status":"completed"');
	});
});
