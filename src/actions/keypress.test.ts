import { describe, it, expect } from 'vitest';
import { normalizeKey, isValidKey } from './keypress.js';

// ─── normalizeKey ───────────────────────────────────────────────

describe('normalizeKey', () => {
  it('normalizes "enter" → "Enter"', () => {
    expect(normalizeKey('enter')).toBe('Enter');
  });

  it('normalizes "ENTER" → "Enter"', () => {
    expect(normalizeKey('ENTER')).toBe('Enter');
  });

  it('normalizes "esc" → "Escape"', () => {
    expect(normalizeKey('esc')).toBe('Escape');
  });

  it('normalizes "return" → "Enter"', () => {
    expect(normalizeKey('return')).toBe('Enter');
  });

  it('normalizes "up" → "ArrowUp"', () => {
    expect(normalizeKey('up')).toBe('ArrowUp');
  });

  it('normalizes "del" → "Delete"', () => {
    expect(normalizeKey('del')).toBe('Delete');
  });

  it('normalizes "cmd+c" → "Meta+c"', () => {
    expect(normalizeKey('cmd+c')).toBe('Meta+c');
  });

  it('normalizes "ctrl+a" → "Control+a"', () => {
    expect(normalizeKey('ctrl+a')).toBe('Control+a');
  });

  it('normalizes "Control+Shift+ArrowDown"', () => {
    expect(normalizeKey('Control+Shift+ArrowDown')).toBe('Control+Shift+ArrowDown');
  });

  it('normalizes "option+v" → "Alt+v"', () => {
    expect(normalizeKey('option+v')).toBe('Alt+v');
  });

  it('passes through "F1" unchanged', () => {
    expect(normalizeKey('F1')).toBe('F1');
  });

  it('keeps single letter "a" lowercase (Playwright convention)', () => {
    expect(normalizeKey('a')).toBe('a');
  });
});

// ─── isValidKey ────────────────────────────────────────────────

describe('isValidKey', () => {
  it('accepts "Enter"', () => {
    expect(isValidKey('Enter')).toBe(true);
  });

  it('accepts "Control+a"', () => {
    expect(isValidKey('Control+a')).toBe(true);
  });

  it('accepts "Escape"', () => {
    expect(isValidKey('Escape')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidKey('')).toBe(false);
  });
});
