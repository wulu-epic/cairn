/**
 * Unit tests for the NL-to-Plan compiler (Leap 1).
 *
 * These tests cover the PURE functions (splitGoal, compilePlan) — no browser,
 * no Playwright. The execution layer (executePlan) is covered by E2E tests
 * (tests/plan-e2e.test.ts) and by the mock-executor tests below.
 */
import { describe, it, expect } from 'vitest';
import {
  splitGoal,
  compilePlan,
  executePlan,
  type CompiledPlan,
  type IntentExecutor,
  type PlanExecuteOptions,
} from './planner.js';

// ─── splitGoal ─────────────────────────────────────────────────

describe('splitGoal', () => {
  it('splits a compound goal on " then "', () => {
    const clauses = splitGoal('type hello into the search field then click the go button');
    expect(clauses).toEqual([
      'type hello into the search field',
      'click the go button',
    ]);
  });

  it('splits on " and then "', () => {
    const clauses = splitGoal('type foo into email and then type bar into password');
    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toBe('type foo into email');
    expect(clauses[1]).toBe('type bar into password');
  });

  it('splits a 3-step compound goal with "then" + comma', () => {
    const goal = 'type test@example.com into the email field, then type secret123 into the password field, then click the sign in button';
    const clauses = splitGoal(goal);
    expect(clauses).toHaveLength(3);
    expect(clauses[0]).toBe('type test@example.com into the email field');
    expect(clauses[1]).toBe('type secret123 into the password field');
    expect(clauses[2]).toBe('click the sign in button');
  });

  it('splits on semicolons', () => {
    const clauses = splitGoal('click the menu button; click settings; click save');
    expect(clauses).toEqual([
      'click the menu button',
      'click settings',
      'click save',
    ]);
  });

  it('splits on verb-gated commas', () => {
    const clauses = splitGoal('type hello into the email field, click the submit button');
    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toBe('type hello into the email field');
    expect(clauses[1]).toBe('click the submit button');
  });

  it('does NOT split commas inside double-quoted text', () => {
    const clauses = splitGoal('type "hello, world" into the search field');
    expect(clauses).toEqual(['type "hello, world" into the search field']);
  });

  it('does NOT split commas inside single-quoted text', () => {
    const clauses = splitGoal("type 'foo, bar' into the field");
    expect(clauses).toEqual(["type 'foo, bar' into the field"]);
  });

  it('does NOT split non-verb commas (unquoted value with comma)', () => {
    // "world" is not a verb, so the comma is part of the value
    const clauses = splitGoal('type hello, world into the search field');
    expect(clauses).toEqual(['type hello, world into the search field']);
  });

  it('returns a single clause for a simple goal', () => {
    const clauses = splitGoal('click the sign in button');
    expect(clauses).toEqual(['click the sign in button']);
  });

  it('returns empty array for empty string', () => {
    expect(splitGoal('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(splitGoal('   ')).toEqual([]);
  });

  it('handles multiple "then" separators', () => {
    const clauses = splitGoal('click a then click b then click c');
    expect(clauses).toEqual(['click a', 'click b', 'click c']);
  });

  it('trims whitespace around clauses', () => {
    const clauses = splitGoal('  type hello into email  ,  click submit  ');
    expect(clauses).toEqual(['type hello into email', 'click submit']);
  });
});

// ─── compilePlan ───────────────────────────────────────────────

describe('compilePlan', () => {
  it('compiles a 3-step compound goal into 3 steps', () => {
    const goal = 'type test@example.com into the email field, then type secret123 into the password field, then click the sign in button';
    const plan = compilePlan(goal);
    expect(plan.steps).toHaveLength(3);
    expect(plan.goal).toBe(goal);
  });

  it('parses each step into a structured intent', () => {
    const plan = compilePlan('type hello into the email field, click the sign in button');
    expect(plan.steps[0].intent).not.toBeNull();
    expect(plan.steps[0].intent!.kind).toBe('type');
    expect(plan.steps[1].intent!.kind).toBe('click');
  });

  it('preserves each step goal as the sub-clause', () => {
    const plan = compilePlan('type hello into the email field, click the sign in button');
    expect(plan.steps[0].goal).toBe('type hello into the email field');
    expect(plan.steps[1].goal).toBe('click the sign in button');
  });

  it('assigns sequential step indices', () => {
    const plan = compilePlan('click a, click b, click c');
    expect(plan.steps[0].stepIndex).toBe(0);
    expect(plan.steps[1].stepIndex).toBe(1);
    expect(plan.steps[2].stepIndex).toBe(2);
  });

  it('sets intent to null for unparseable sub-clauses', () => {
    // '@#$' normalizes to empty → parser returns null (bare-target fallback needs text)
    const plan = compilePlan('@#$, then click the sign in button');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].intent).toBeNull();
    expect(plan.steps[1].intent).not.toBeNull();
    expect(plan.steps[1].intent!.kind).toBe('click');
  });

  it('infers pre/post invariants for type intents', () => {
    const plan = compilePlan('type hello into the email field');
    const step = plan.steps[0];
    expect(step.pre).toContain('email');
    expect(step.pre).toContain('typeable');
    expect(step.post).toContain('hello');
  });

  it('infers pre/post invariants for click intents', () => {
    const plan = compilePlan('click the sign in button');
    const step = plan.steps[0];
    expect(step.pre).toContain('sign in');
    expect(step.pre).toContain('clickable');
    expect(step.post).toContain('changed');
  });

  it('leaves invariants empty for unparseable steps', () => {
    const plan = compilePlan('@#$');
    expect(plan.steps[0].pre).toBe('');
    expect(plan.steps[0].post).toBe('');
  });

  it('compiles a single-step goal into a 1-step plan', () => {
    const plan = compilePlan('click the sign in button');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].intent!.kind).toBe('click');
  });

  it('sets createdAt and version on the plan', () => {
    const plan = compilePlan('click the sign in button');
    expect(plan.createdAt).toBeGreaterThan(0);
    expect(plan.version).toBe('1.0');
  });

  it('leaves id empty until saved', () => {
    const plan = compilePlan('click the sign in button');
    expect(plan.id).toBe('');
  });
});

// ─── executePlan (with mock executor — no browser needed) ──────

describe('executePlan (mock executor)', () => {
  /** Build a mock executor that succeeds for all steps. */
  function mockSuccessExecutor(): IntentExecutor {
    return async (_page, goal) => ({
      success: true,
      message: `done: ${goal}`,
    });
  }

  /** Build a mock executor that fails at the given step index. */
  function mockFailAtStep(failIndex: number): IntentExecutor {
    let callCount = 0;
    return async (_page, goal) => {
      if (callCount === failIndex) {
        callCount++;
        return { success: false, message: `failed: ${goal}` };
      }
      callCount++;
      return { success: true, message: `done: ${goal}` };
    };
  }

  /** A minimal fake Page (executePlan doesn't touch it — the executor does). */
  const fakePage = {} as any;

  it('executes all steps and reports success', async () => {
    const plan = compilePlan('click a, click b, click c');
    const result = await executePlan(fakePage, plan, {}, mockSuccessExecutor());
    expect(result.success).toBe(true);
    expect(result.stepsCompleted).toBe(3);
    expect(result.stepsTotal).toBe(3);
    expect(result.stepResults).toHaveLength(3);
    expect(result.stepResults.every((r) => r.success)).toBe(true);
  });

  it('stops on first failure (default behavior)', async () => {
    const plan = compilePlan('click a, click b, click c');
    const result = await executePlan(fakePage, plan, {}, mockFailAtStep(1));
    expect(result.success).toBe(false);
    expect(result.stepsCompleted).toBe(1);  // step 0 succeeded, step 1 failed
    expect(result.stepResults).toHaveLength(2);  // results for steps 0 and 1
    expect(result.stepResults[0].success).toBe(true);
    expect(result.stepResults[1].success).toBe(false);
  });

  it('continues on failure when continueOnFailure is set', async () => {
    const plan = compilePlan('click a, click b, click c');
    const opts: PlanExecuteOptions = { continueOnFailure: true };
    const result = await executePlan(fakePage, plan, opts, mockFailAtStep(1));
    expect(result.success).toBe(false);
    expect(result.stepsCompleted).toBe(2);  // steps 0 and 2 succeeded
    expect(result.stepResults).toHaveLength(3);  // all 3 have results
    expect(result.stepResults[0].success).toBe(true);
    expect(result.stepResults[1].success).toBe(false);
    expect(result.stepResults[2].success).toBe(true);
  });

  it('fires onStep callback for each step', async () => {
    const plan = compilePlan('click a, click b');
    const stepsSeen: number[] = [];
    const opts: PlanExecuteOptions = {
      onStep: (step) => stepsSeen.push(step.stepIndex),
    };
    await executePlan(fakePage, plan, opts, mockSuccessExecutor());
    expect(stepsSeen).toEqual([0, 1]);
  });

  it('reports an unparseable step as a failure', async () => {
    const plan = compilePlan('@#$, click the sign in button');
    const result = await executePlan(fakePage, plan, {}, mockSuccessExecutor());
    expect(result.success).toBe(false);
    expect(result.stepsCompleted).toBe(0);
    expect(result.stepResults[0].success).toBe(false);
    expect(result.stepResults[0].message).toContain('could not be parsed');
  });

  it('counts heals when the executor reports healed=true', async () => {
    const plan = compilePlan('click the sign in button');
    const healingExecutor: IntentExecutor = async (_page, goal) => ({
      success: true,
      message: `[self-healed] done: ${goal}`,
      healed: true,
      newRef: 'e5',
    });
    const result = await executePlan(fakePage, plan, {}, healingExecutor);
    expect(result.healsTriggered).toBe(1);
    expect(result.stepResults[0].healed).toBe(true);
    expect(result.stepResults[0].groundedRef).toBe('e5');
  });
});
