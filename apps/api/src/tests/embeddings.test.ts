/**
 * Tests for packages/server/src/embeddings.ts
 *
 * Covers the OCI SDK-based embedding implementation:
 * - generateEmbedding() single text
 * - generateEmbeddings() batch with auto-chunking
 * - Error handling (ValidationError, OCIError, graceful degradation)
 * - Missing OCI_COMPARTMENT_ID → null (graceful skip)
 *
 * Mock pattern: inject a mock client via __setGenAiClientForTesting() instead of
 * mocking the entire oci-sdk CJS package (vi.mock does not reliably intercept CJS).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@portal/server/sentry', () => ({
	wrapWithSpan: (...args: unknown[]) => {
		const fn = args[2] as () => unknown;
		return fn();
	},
	captureError: vi.fn()
}));

// ── Module under test ─────────────────────────────────────────────────────────
import {
	generateEmbedding,
	generateEmbeddings,
	resetGenAiClient,
	__setGenAiClientForTesting
} from '@portal/server/embeddings';
import { ValidationError } from '@portal/server/errors';

// ── Mock GenAI client ─────────────────────────────────────────────────────────

const mockEmbedText = vi.fn();

/** A minimal mock matching oci.generativeaiinference.GenerativeAiInferenceClient */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockClient: any = { embedText: (...args: unknown[]) => mockEmbedText(...args) };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock embed-text SDK response with n embeddings of the given dimension. */
function buildEmbedResponse(count: number, dim = 1536): object {
	const embeddings = Array.from({ length: count }, () =>
		Array.from({ length: dim }, (_, i) => i / dim)
	);
	return { embedTextResult: { id: 'result-1', embeddings } };
}

// ── generateEmbedding tests ──────────────────────────────────────────────────

describe('generateEmbedding', () => {
	const originalCompartment = process.env.OCI_COMPARTMENT_ID;
	const originalRegion = process.env.OCI_REGION;

	beforeEach(() => {
		process.env.OCI_COMPARTMENT_ID = 'ocid1.compartment.test';
		process.env.OCI_REGION = 'eu-frankfurt-1';
		// Inject mock client so callOCIEmbedAPI uses our mock rather than real SDK
		__setGenAiClientForTesting(mockClient, 'eu-frankfurt-1');
		// Re-configure forwarded mock each test (mockReset: true cleared return values)
		mockEmbedText.mockResolvedValue(buildEmbedResponse(1));
	});

	afterEach(() => {
		if (originalCompartment === undefined) {
			delete process.env.OCI_COMPARTMENT_ID;
		} else {
			process.env.OCI_COMPARTMENT_ID = originalCompartment;
		}
		if (originalRegion === undefined) {
			delete process.env.OCI_REGION;
		} else {
			process.env.OCI_REGION = originalRegion;
		}
		resetGenAiClient();
	});

	it('throws ValidationError for empty text', async () => {
		await expect(generateEmbedding('')).rejects.toThrow(ValidationError);
	});

	it('throws ValidationError for whitespace-only text', async () => {
		await expect(generateEmbedding('   ')).rejects.toThrow(ValidationError);
	});

	it('returns a Float32Array of 1536 dimensions on success', async () => {
		const result = await generateEmbedding('hello world');

		expect(result).toBeInstanceOf(Float32Array);
		expect(result?.length).toBe(1536);
	});

	it('calls SDK with correct request shape', async () => {
		await generateEmbedding('test text');

		expect(mockEmbedText).toHaveBeenCalledWith(
			expect.objectContaining({
				embedTextDetails: expect.objectContaining({
					inputs: ['test text'],
					compartmentId: 'ocid1.compartment.test',
					truncate: 'END',
					inputType: 'SEARCH_DOCUMENT'
				})
			})
		);
	});

	it('returns null when OCI_COMPARTMENT_ID is not set', async () => {
		delete process.env.OCI_COMPARTMENT_ID;

		const result = await generateEmbedding('hello');

		expect(result).toBeNull();
		expect(mockEmbedText).not.toHaveBeenCalled();
	});

	it('returns null when SDK returns empty embeddings array', async () => {
		mockEmbedText.mockResolvedValue({ embedTextResult: { id: 'r1', embeddings: [] } });

		const result = await generateEmbedding('hello');

		expect(result).toBeNull();
	});

	it('returns null on 503 ServiceUnavailable (graceful degradation)', async () => {
		const sdkError = Object.assign(new Error('ServiceUnavailable'), { statusCode: 503 });
		mockEmbedText.mockRejectedValue(sdkError);

		const result = await generateEmbedding('hello');
		// callOCIEmbedAPI returns null for 503; generateEmbedding propagates null
		expect(result).toBeNull();
	});

	it('returns null on 401 auth error (generateEmbedding degrades gracefully)', async () => {
		const sdkError = Object.assign(new Error('NotAuthorized'), { statusCode: 401 });
		mockEmbedText.mockRejectedValue(sdkError);

		// callOCIEmbedAPI throws OCIError; generateEmbedding's catch returns null
		const result = await generateEmbedding('hello');
		expect(result).toBeNull();
	});

	it('returns null on unexpected SDK errors (graceful degradation)', async () => {
		const sdkError = Object.assign(new Error('InternalServerError'), { statusCode: 500 });
		mockEmbedText.mockRejectedValue(sdkError);

		const result = await generateEmbedding('hello');
		expect(result).toBeNull();
	});
});

// ── ValidationError re-throw test ────────────────────────────────────────────

describe('generateEmbedding - ValidationError re-throw', () => {
	it('re-throws ValidationError from empty text input', async () => {
		await expect(generateEmbedding('')).rejects.toThrow(ValidationError);
	});
});

// ── generateEmbeddings tests ─────────────────────────────────────────────────

describe('generateEmbeddings', () => {
	const originalCompartment = process.env.OCI_COMPARTMENT_ID;
	const originalRegion = process.env.OCI_REGION;

	beforeEach(() => {
		process.env.OCI_COMPARTMENT_ID = 'ocid1.compartment.test';
		process.env.OCI_REGION = 'eu-frankfurt-1';
		__setGenAiClientForTesting(mockClient, 'eu-frankfurt-1');
		mockEmbedText.mockResolvedValue(buildEmbedResponse(3));
	});

	afterEach(() => {
		if (originalCompartment === undefined) {
			delete process.env.OCI_COMPARTMENT_ID;
		} else {
			process.env.OCI_COMPARTMENT_ID = originalCompartment;
		}
		if (originalRegion === undefined) {
			delete process.env.OCI_REGION;
		} else {
			process.env.OCI_REGION = originalRegion;
		}
		resetGenAiClient();
	});

	it('returns empty array for empty input', async () => {
		const results = await generateEmbeddings([]);
		expect(results).toEqual([]);
		expect(mockEmbedText).not.toHaveBeenCalled();
	});

	it('returns array of Float32Arrays matching input count', async () => {
		const results = await generateEmbeddings(['a', 'b', 'c']);

		expect(results).toHaveLength(3);
		for (const r of results) {
			expect(r).toBeInstanceOf(Float32Array);
			expect(r?.length).toBe(1536);
		}
	});

	it('sends texts in batches of 96', async () => {
		// 97 texts → 2 SDK calls: batch of 96 then batch of 1
		const texts = Array.from({ length: 97 }, (_, i) => `text-${i}`);

		let callCount = 0;
		mockEmbedText.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return buildEmbedResponse(96);
			return buildEmbedResponse(1);
		});

		const results = await generateEmbeddings(texts);

		expect(mockEmbedText).toHaveBeenCalledTimes(2);
		expect(results).toHaveLength(97);
	});

	it('fills batch with nulls when a batch call fails', async () => {
		const sdkError = Object.assign(new Error('InternalServerError'), { statusCode: 500 });
		mockEmbedText.mockRejectedValue(sdkError);

		const results = await generateEmbeddings(['a', 'b', 'c']);

		expect(results).toHaveLength(3);
		expect(results.every((r) => r === null)).toBe(true);
	});

	it('returns nulls for all items when OCI_COMPARTMENT_ID is missing', async () => {
		delete process.env.OCI_COMPARTMENT_ID;

		const results = await generateEmbeddings(['x', 'y']);

		expect(results).toHaveLength(2);
		expect(results.every((r) => r === null)).toBe(true);
		expect(mockEmbedText).not.toHaveBeenCalled();
	});

	it('passes all texts in single batch when ≤ 96', async () => {
		mockEmbedText.mockResolvedValue(buildEmbedResponse(2));

		const results = await generateEmbeddings(['first', 'second']);

		expect(mockEmbedText).toHaveBeenCalledTimes(1);
		expect(mockEmbedText).toHaveBeenCalledWith(
			expect.objectContaining({
				embedTextDetails: expect.objectContaining({
					inputs: ['first', 'second']
				})
			})
		);
		expect(results).toHaveLength(2);
	});
});
