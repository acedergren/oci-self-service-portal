// src/tests/message-parts.test.ts
import { describe, test, expect } from 'vitest';
import { extractToolParts, getToolState, formatToolName } from '$lib/utils/message-parts.js';

describe('message-parts utilities', () => {
  describe('extractToolParts', () => {
    test('extracts tool parts from message parts array', () => {
      const parts = [
        { type: 'text', text: 'Let me check that' },
        { type: 'tool-list_instances', toolCallId: 'tc1', state: 'result', output: { success: true } },
        { type: 'text', text: 'Found 3 instances' },
      ];

      const toolParts = extractToolParts(parts);

      expect(toolParts).toHaveLength(1);
      expect(toolParts[0].toolCallId).toBe('tc1');
    });

    test('returns empty array when no tool parts', () => {
      const parts = [{ type: 'text', text: 'Hello' }];
      expect(extractToolParts(parts)).toEqual([]);
    });
  });

  describe('getToolState', () => {
    test('returns streaming for input-streaming state', () => {
      expect(getToolState('input-streaming')).toBe('streaming');
    });

    test('returns pending for input-available state', () => {
      expect(getToolState('input-available')).toBe('pending');
    });

    test('returns completed for result state', () => {
      expect(getToolState('result')).toBe('completed');
    });
  });

  describe('formatToolName', () => {
    test('removes tool- prefix and formats name', () => {
      expect(formatToolName('tool-list_instances')).toBe('list_instances');
    });

    test('returns dynamic-tool as is', () => {
      expect(formatToolName('dynamic-tool')).toBe('dynamic-tool');
    });
  });
});
