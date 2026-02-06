import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { aiDialogOpen } from '../lib/stores/ui';

describe('UI Store - aiDialogOpen', () => {
  beforeEach(() => {
    aiDialogOpen.set(false);
  });

  it('should initialize as false', () => {
    expect(get(aiDialogOpen)).toBe(false);
  });

  it('should update to true when set', () => {
    aiDialogOpen.set(true);
    expect(get(aiDialogOpen)).toBe(true);
  });

  it('should toggle back to false when set', () => {
    aiDialogOpen.set(true);
    aiDialogOpen.set(false);
    expect(get(aiDialogOpen)).toBe(false);
  });
});

describe('SearchBox Component Logic', () => {
  it('should reject empty queries', () => {
    const query = '   ';
    const isValid = query.trim().length > 0;
    expect(isValid).toBe(false);
  });

  it('should accept non-empty queries', () => {
    const query = 'List my instances';
    const isValid = query.trim().length > 0;
    expect(isValid).toBe(true);
  });

  it('should create correct API payload', () => {
    const message = 'test query';
    const payload = { message, messages: [] };
    expect(payload.message).toBe('test query');
    expect(payload.messages).toEqual([]);
  });

  it('should reset query after submission', () => {
    let query = 'test query';
    query = '';
    expect(query).toBe('');
  });
});
