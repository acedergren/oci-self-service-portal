import { describe, it, expect } from 'vitest';
import {
	parseStreamLine,
	createToolTimelineState,
	updateToolTimeline,
	buildChatRequestPayload
} from '../../routes/admin/agents/streaming.js';

describe('parseStreamLine', () => {
	it('parses text tokens emitted as 0-prefixed JSON strings', () => {
		const event = parseStreamLine('0:"Hello"');
		expect(event).toEqual({ type: 'text', text: 'Hello' });
	});

	it('parses tool call start events (9: prefix)', () => {
		const event = parseStreamLine(
			'9:{"id":"call-1","tool":"oci.listInstances","args":{"compartmentId":"ocid1"}}'
		);
		expect(event).toEqual({
			type: 'toolCall',
			call: {
				id: 'call-1',
				tool: 'oci.listInstances',
				args: { compartmentId: 'ocid1' }
			}
		});
	});

	it('parses tool result events (a: prefix)', () => {
		const event = parseStreamLine('a:{"id":"call-1","ok":true,"result":{"instances":2}}');
		expect(event).toEqual({
			type: 'toolResult',
			result: {
				id: 'call-1',
				ok: true,
				result: { instances: 2 }
			}
		});
	});
});

describe('updateToolTimeline', () => {
	it('adds tool call entries and merges results with duration tracking', () => {
		let state = createToolTimelineState();
		state = updateToolTimeline(
			state,
			{
				type: 'toolCall',
				call: { id: 'call-42', tool: 'oci.listInstances', args: { region: 'us-ashburn-1' } }
			},
			1_000
		);

		expect(state.entries['call-42']).toMatchObject({
			tool: 'oci.listInstances',
			status: 'running',
			args: { region: 'us-ashburn-1' },
			startedAt: 1_000,
			finishedAt: null
		});

		state = updateToolTimeline(
			state,
			{
				type: 'toolResult',
				result: { id: 'call-42', ok: true, result: { instances: 3 } }
			},
			1_750
		);

		expect(state.entries['call-42']).toMatchObject({
			status: 'success',
			result: { instances: 3 },
			finishedAt: 1_750,
			durationMs: 750
		});
	});
});

describe('buildChatRequestPayload', () => {
	it('injects agent config, temperature, and topP into the chat body', () => {
		const payload = buildChatRequestPayload(
			[
				{ role: 'user', content: 'hello' },
				{ role: 'assistant', content: 'hi' }
			],
			{
				agentId: 'agent-123',
				model: 'oci.gpt-4o',
				systemPrompt: 'You are CloudAdvisor',
				temperature: 0.6,
				topP: 0.9
			}
		);

		expect(payload).toEqual({
			agentId: 'agent-123',
			model: 'oci.gpt-4o',
			system: 'You are CloudAdvisor',
			temperature: 0.6,
			topP: 0.9,
			messages: [
				{ role: 'user', content: 'hello' },
				{ role: 'assistant', content: 'hi' }
			]
		});
	});

	it('omits optional fields when not provided', () => {
		const payload = buildChatRequestPayload([{ role: 'user', content: 'ping' }], {
			agentId: 'agent-abc',
			temperature: 1,
			topP: 1
		});

		expect(payload).toEqual({
			agentId: 'agent-abc',
			temperature: 1,
			topP: 1,
			messages: [{ role: 'user', content: 'ping' }]
		});
	});

	it('clamps temperature and topP within supported ranges', () => {
		const payload = buildChatRequestPayload([{ role: 'user', content: 'range check' }], {
			agentId: 'agent-range',
			temperature: 9,
			topP: -3
		});

		expect(payload).toMatchObject({
			agentId: 'agent-range',
			temperature: 2,
			topP: 0
		});
	});
});
