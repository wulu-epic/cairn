/**
 * Unit tests for the by-ref self-heal matching logic (Leap 3).
 *
 * Tests the REAL findReplacementByAttributes function exported from
 * self-heal.ts — the pure attribute-similarity matching core that powers
 * selfHealByRef. Uses mock PageModels (no browser needed).
 */
import { describe, it, expect } from 'vitest';
import { makeNode, makeModel } from './test-utils.js';
import { findReplacementByAttributes } from './intent/self-heal.js';

describe('Self-Heal by-ref matching (findReplacementByAttributes)', () => {
  it('finds exact role+name match when ref is stale', () => {
    const stale = makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true });
    const fresh = makeNode({ ref: 'e5', role: 'button', name: 'Submit', interactive: true });
    const freshModel = makeModel([fresh]);

    const match = findReplacementByAttributes(stale, freshModel, 'e1');
    expect(match).not.toBeNull();
    expect(match!.ref).toBe('e5');
    expect(match!.score).toBe(1.0);
  });

  it('finds substring name match (weaker score)', () => {
    const stale = makeNode({ ref: 'e1', role: 'button', name: 'Sign in', interactive: true });
    const fresh = makeNode({ ref: 'e3', role: 'button', name: 'Sign in to your account', interactive: true });
    const freshModel = makeModel([fresh]);

    const match = findReplacementByAttributes(stale, freshModel, 'e1');
    expect(match).not.toBeNull();
    expect(match!.ref).toBe('e3');
    expect(match!.score).toBe(0.8);
  });

  it('rejects low-overlap matches (below 0.5 threshold)', () => {
    const stale = makeNode({ ref: 'e1', role: 'button', name: 'Submit Form', interactive: true });
    const fresh = makeNode({ ref: 'e7', role: 'button', name: 'Submit Order', interactive: true });
    const freshModel = makeModel([fresh]);

    // 1 of 2 tokens overlap → score = (1/2) * 0.5 = 0.25 → below 0.5 threshold
    const match = findReplacementByAttributes(stale, freshModel, 'e1');
    expect(match).toBeNull();
  });

  it('returns null when no element with same role exists', () => {
    const stale = makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true });
    const other = makeNode({ ref: 'e2', role: 'link', name: 'Submit', interactive: true });
    const freshModel = makeModel([other]);

    const match = findReplacementByAttributes(stale, freshModel, 'e1');
    expect(match).toBeNull();
  });

  it('returns null when best score is below threshold', () => {
    const stale = makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true });
    const fresh = makeNode({ ref: 'e2', role: 'button', name: 'Completely Different', interactive: true });
    const freshModel = makeModel([fresh]);

    const match = findReplacementByAttributes(stale, freshModel, 'e1');
    expect(match).toBeNull();
  });

  it('prefers exact match over substring match', () => {
    const stale = makeNode({ ref: 'e1', role: 'button', name: 'Login', interactive: true });
    const exact = makeNode({ ref: 'e2', role: 'button', name: 'Login', interactive: true });
    const substring = makeNode({ ref: 'e3', role: 'button', name: 'Login Page', interactive: true });
    const freshModel = makeModel([exact, substring]);

    const match = findReplacementByAttributes(stale, freshModel, 'e1');
    expect(match).not.toBeNull();
    expect(match!.ref).toBe('e2');
    expect(match!.score).toBe(1.0);
  });

  it('returns null for role-only match (no name on either, score 0.3 < 0.5)', () => {
    const stale = makeNode({ ref: 'e1', role: 'button', interactive: true });
    const fresh = makeNode({ ref: 'e2', role: 'button', interactive: true });
    const freshModel = makeModel([fresh]);

    // No name on either → role-only match = 0.3 → below 0.5 threshold
    const match = findReplacementByAttributes(stale, freshModel, 'e1');
    expect(match).toBeNull();
  });

  it('does not match the stale ref to itself', () => {
    // Even if the stale ref is still in the fresh model, it should be skipped
    const stale = makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true });
    const fresh = makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true });
    const freshModel = makeModel([fresh]);

    const match = findReplacementByAttributes(stale, freshModel, 'e1');
    expect(match).toBeNull();
  });
});
