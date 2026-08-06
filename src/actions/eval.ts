/**
 * Eval Action — read-only JavaScript escape hatch.
 *
 * Runs arbitrary JS in the page context and returns the result. This is the
 * general-purpose DOM-precision tool the comparison keeps citing — for reading
 * getComputedStyle, innerText, computed values, or any state not surfaced by
 * the structured model or `attr`.
 *
 * Read-only by CONVENTION (documented in the command help): the agent should
 * use this to READ state, not mutate it. Ref-based actions (click/type/etc.)
 * remain the discipline for mutations. Enforcing read-only at the JS level
 * would require a sandbox that blocks assignment — impractical and fragile.
 *
 * The pure formatting logic (formatEvalResult) is extracted for unit testing.
 */

import type { Page } from 'playwright';

export interface EvalResult {
  success: boolean;
  message: string;
  /** The raw result value, if serializable. */
  value?: string;
  /** The JS type of the result. */
  type?: string;
}

/**
 * Format an eval result as an agent-readable string.
 * Pure function — unit-testable.
 */
export function formatEvalResult(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  const type = typeof value;

  if (type === 'string') {
    return value as string;
  }

  if (type === 'number' || type === 'boolean' || type === 'bigint') {
    return String(value);
  }

  if (type === 'function') {
    return '[function]';
  }

  if (type === 'symbol') {
    return String(value);
  }

  // Object — try JSON, fall back to toString
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Detect the type label for a value (for the result's type field).
 * Pure function — unit-testable.
 */
export function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    if (Array.isArray(value)) return 'array';
    return 'object';
  }
  return typeof value;
}

/**
 * Run JavaScript in the page context and return the result.
 * The JS expression is wrapped in an IIFE so the agent can pass either
 * a bare expression ("document.title") or a statement block.
 */
export async function evalInPage(page: Page, js: string): Promise<EvalResult> {
  // Wrap in an IIFE — supports both bare expressions and statement blocks.
  // "document.title" → (() => document.title)()
  // "return document.title" → (() => { return document.title })()
  const wrapped = `(() => { ${js} })()`;

  let result: unknown;
  try {
    result = await page.evaluate(wrapped);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      message: `eval failed: ${msg}`,
    };
  }

  const type = typeOf(result);
  const formatted = formatEvalResult(result);

  return {
    success: true,
    message: formatted,
    value: formatted,
    type,
  };
}
