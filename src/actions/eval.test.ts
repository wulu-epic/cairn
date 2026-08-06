import { describe, it, expect } from 'vitest';
import { formatEvalResult, typeOf } from './eval.js';

// ─── formatEvalResult ──────────────────────────────────────────

describe('formatEvalResult', () => {
  it('returns "null" for null', () => {
    expect(formatEvalResult(null)).toBe('null');
  });

  it('returns "null" for undefined', () => {
    expect(formatEvalResult(undefined)).toBe('null');
  });

  it('returns string value as-is', () => {
    expect(formatEvalResult('Total $9.40')).toBe('Total $9.40');
  });

  it('returns number as string', () => {
    expect(formatEvalResult(42)).toBe('42');
  });

  it('returns boolean as string', () => {
    expect(formatEvalResult(true)).toBe('true');
  });

  it('returns bigint as string', () => {
    expect(formatEvalResult(BigInt(999))).toBe('999');
  });

  it('returns [function] for functions', () => {
    expect(formatEvalResult(() => 5)).toBe('[function]');
  });

  it('JSON-serializes objects', () => {
    const obj = { name: 'Submit', value: 'test' };
    const out = formatEvalResult(obj);
    expect(out).toContain('"name": "Submit"');
    expect(out).toContain('"value": "test"');
  });

  it('JSON-serializes arrays', () => {
    expect(formatEvalResult([1, 2, 3])).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('handles nested objects', () => {
    const obj = { a: { b: 1 } };
    const out = formatEvalResult(obj);
    expect(out).toContain('"a":');
    expect(out).toContain('"b": 1');
  });
});

// ─── typeOf ────────────────────────────────────────────────────

describe('typeOf', () => {
  it('returns "null" for null', () => {
    expect(typeOf(null)).toBe('null');
  });

  it('returns "undefined" for undefined', () => {
    expect(typeOf(undefined)).toBe('undefined');
  });

  it('returns "string" for strings', () => {
    expect(typeOf('hello')).toBe('string');
  });

  it('returns "number" for numbers', () => {
    expect(typeOf(42)).toBe('number');
  });

  it('returns "boolean" for booleans', () => {
    expect(typeOf(true)).toBe('boolean');
  });

  it('returns "array" for arrays', () => {
    expect(typeOf([1, 2, 3])).toBe('array');
  });

  it('returns "object" for plain objects', () => {
    expect(typeOf({ a: 1 })).toBe('object');
  });
});
