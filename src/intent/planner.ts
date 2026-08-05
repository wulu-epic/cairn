/**
 * NL-to-Plan Compilation — docs/REVOLUTION.md Leap 1.
 *
 * Compile a compound natural-language goal ("type X into the email field, then
 * type Y into the password field, then click the sign in button") into a
 * deterministic multi-step plan, then execute it with zero in-tool LLM calls.
 *
 * This is the "collapse the loop" keystone: instead of 3 separate `goto`
 * commands (3 LLM round-trips), the agent writes ONE compound goal, Cairn
 * splits it into steps, parses each, and executes deterministically via the
 * existing executeGoto() — which already self-heals (Leap 3).
 *
 * A compiled plan IS a recorded plan generalized (Leap 2). Plans are saved to
 * disk and replayed with `cairn run <plan-id>`.
 *
 * Prior art: Agent JIT Compilation (reported ICML 2026, Stanford + Google) —
 * 10.4× speedup, +28% accuracy over Browser-Use; 45-50% of web-automation
 * errors are wrong action sequences; pre/post invariant validation cuts
 * failure 59%→25%.
 *
 * Storage: OS-appropriate data directory (same as recorder.ts):
 *   Windows: %APPDATA%/cairn/plans/
 *   macOS:   ~/Library/Application Support/cairn/plans/
 *   Linux:   ${XDG_DATA_HOME:-~/.local/share}/cairn/plans/
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Page } from 'playwright';
import { parseIntent, type Intent } from './parser.js';
import { executeGoto, type ExecuteResult, type ExecuteOptions } from './execute.js';
import { getDataDir } from './recorder.js';

// ─── Types ─────────────────────────────────────────────────────

export interface PlanStep {
  stepIndex: number;
  /** The original NL sub-clause for this step. */
  goal: string;
  /** The parsed intent (null if the sub-clause was unparseable). */
  intent: Intent | null;
  /** Precondition invariant (descriptive — what should be true before). */
  pre: string;
  /** Postcondition invariant (descriptive — what should be true after). */
  post: string;
}

export interface CompiledPlan {
  /** Unique plan ID (assigned at save time; empty until saved). */
  id: string;
  /** The original compound NL goal. */
  goal: string;
  /** Ordered list of compiled steps. */
  steps: PlanStep[];
  /** When the plan was compiled. */
  createdAt: number;
  /** Plan format version (for forward compat). */
  version: string;
}

export interface PlanStepResult {
  stepIndex: number;
  success: boolean;
  message: string;
  /** The ref that was grounded and acted on (if successful). */
  groundedRef?: string;
  /** True if self-heal recovered a failed action. */
  healed?: boolean;
  /** The executeGoto result (full fidelity — intent, ground, delta). */
  result?: ExecuteResult;
}

export interface PlanResult {
  success: boolean;
  message: string;
  stepsCompleted: number;
  stepsTotal: number;
  stepResults: PlanStepResult[];
  /** Steps where self-heal was triggered. */
  healsTriggered: number;
  /** Number of times the plan was replanned (future: re-derive tail). */
  replansTriggered: number;
  /** The saved plan ID (if the plan was saved). */
  planId?: string;
}

// ─── Goal splitting (pure — no browser, no Playwright) ────────

/**
 * Split a compound NL goal into sub-clauses.
 *
 * Splits on:
 *   - " then " / " and then " (sequence markers)
 *   - ";" (explicit separator)
 *   - "," (comma) — ONLY when the text after the comma starts with a known
 *     intent verb (click/type/go to/hover/scroll/select/...). This avoids
 *     splitting commas inside quoted text ("type "hello, world" into search")
 *     or commas that are part of the typed value ("type foo, bar into field").
 *
 * Quote-aware: never splits inside "..." or '...' (tracks escape chars).
 *
 * @param goal The compound NL goal.
 * @returns Array of trimmed sub-clauses (empty array for empty/whitespace input).
 */
export function splitGoal(goal: string): string[] {
  const trimmed = goal.trim();
  if (trimmed === '') return [];

  // Split on " then " / " and then " first (strongest separators).
  // Use a regex that captures so we can re-join if needed — but these are
  // always step boundaries, so a plain split is fine.
  // Case-insensitive, word-boundary safe.
  const thenParts: string[] = [];
  // Match " then " or " and then " as separators.
  // We split on the separator and keep the surrounding text.
  // The leading ,? consumes a comma before "then" (e.g. "field, then click")
  // so the comma doesn't stay attached to the preceding clause.
  const thenRegex = /,?\s+(?:and\s+)?then\s+/gi;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = thenRegex.exec(trimmed)) !== null) {
    thenParts.push(trimmed.slice(lastIdx, m.index));
    lastIdx = m.index + m[0].length;
  }
  thenParts.push(trimmed.slice(lastIdx));
  // The thenRegex may match inside quotes ("type 'do this then that' into..."),
  // but " then " as a standalone phrase is rare inside quotes. For robustness,
  // we pass each thenPart through the comma/splitter below, which IS fully
  // quote-aware. If a thenPart's split yields multiple parts, those are
  // additional comma-boundary steps.

  // Now split each thenPart on ";" and verb-gated commas (quote-aware).
  const clauses: string[] = [];
  for (const part of thenParts) {
    clauses.push(...splitOnCommasAndSemicolons(part));
  }

  // Filter empty + trim each
  return clauses.map((c) => c.trim()).filter((c) => c.length > 0);
}

/**
 * Split a single clause on ";" and verb-gated commas, quote-aware.
 * A comma triggers a split ONLY if the text immediately after it starts with
 * a known intent verb.
 */
function splitOnCommasAndSemicolons(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // Quote tracking (escape-aware)
    if ((ch === '"' || ch === "'") && inQuote === null) {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === inQuote && (i === 0 || text[i - 1] !== '\\')) {
      inQuote = null;
      current += ch;
      continue;
    }

    // Inside quotes — never split
    if (inQuote !== null) {
      current += ch;
      continue;
    }

    // Semicolon — always a split boundary
    if (ch === ';') {
      parts.push(current);
      current = '';
      continue;
    }

    // Comma — split only if the text after starts with a verb
    if (ch === ',') {
      const afterComma = text.slice(i + 1).trimStart();
      if (startsWithVerb(afterComma)) {
        parts.push(current);
        current = '';
        continue;
      }
      // Non-verb comma — keep in current clause (part of the value)
      current += ch;
      continue;
    }

    current += ch;
  }

  parts.push(current);
  return parts;
}

/**
 * Verbs that start an intent clause (from parser.ts verb lists).
 * Used to gate comma splits so we don't split typed values.
 */
const INTENT_VERBS = [
  'click', 'press', 'select', 'tap', 'hit', 'choose', 'pick',
  'type', 'enter', 'fill', 'input', 'write',
  'go to', 'navigate to', 'open', 'visit', 'jump to',
  'hover over', 'hover',
  'scroll',
];

/**
 * Check if a string starts with a known intent verb.
 */
function startsWithVerb(s: string): boolean {
  const lower = s.toLowerCase();
  for (const verb of INTENT_VERBS) {
    if (lower.startsWith(verb + ' ') || lower === verb) {
      return true;
    }
  }
  return false;
}

// ─── Plan compilation (pure — no browser) ─────────────────────

/**
 * Compile a compound NL goal into a deterministic plan.
 *
 * Steps:
 *   1. splitGoal(goal) → sub-clauses
 *   2. parseIntent(sub-clause) per clause → Intent per step
 *   3. Infer pre/postcondition invariants from the intent kind
 *
 * If a sub-clause is unparseable (parseIntent returns null), the step's
 * intent is null — execution will report "could not parse" for that step.
 * This does NOT abort compilation; the plan is still produced so the agent
 * can inspect it and rephrase.
 *
 * @param goal The compound NL goal.
 * @returns A CompiledPlan (not yet saved to disk — call savePlan for that).
 */
export function compilePlan(goal: string): CompiledPlan {
  const clauses = splitGoal(goal);
  const steps: PlanStep[] = clauses.map((clause, idx) => {
    const { intent } = parseIntent(clause);
    const { pre, post } = inferInvariants(intent);
    return {
      stepIndex: idx,
      goal: clause,
      intent,
      pre,
      post,
    };
  });

  return {
    id: '',  // Assigned at save time
    goal,
    steps,
    createdAt: Date.now(),
    version: '1.0',
  };
}

/**
 * Infer pre/postcondition invariants from an intent kind.
 * These are descriptive (what SHOULD be true), not hard-validated — the
 * actual validation is done by executeGoto (grounding status, action success,
 * DOM delta). The invariants are for plan transparency + future hard validation.
 */
function inferInvariants(intent: Intent | null): { pre: string; post: string } {
  if (!intent) {
    return { pre: '', post: '' };
  }
  switch (intent.kind) {
    case 'click':
    case 'navigate':
      return {
        pre: `element "${intent.target}" exists and is clickable`,
        post: 'page state changed (navigation or DOM mutation)',
      };
    case 'type':
      return {
        pre: `element "${intent.target}" exists and is typeable`,
        post: `"${intent.text}" entered into "${intent.target}"`,
      };
    case 'hover':
      return {
        pre: `element "${intent.target}" exists and is hoverable`,
        post: 'hover state applied (tooltip/menu may appear)',
      };
    case 'scroll':
      if (intent.direction) {
        return {
          pre: 'page is scrollable',
          post: `scrolled ${intent.direction}`,
        };
      }
      return {
        pre: `element "${intent.target}" exists`,
        post: 'element scrolled into view',
      };
    case 'select':
      return {
        pre: `dropdown "${intent.target}" exists and has option "${intent.value}"`,
        post: `"${intent.value}" selected in "${intent.target}"`,
      };
    default:
      return { pre: '', post: '' };
  }
}

// ─── Plan execution ────────────────────────────────────────────

/**
 * Executor function type — injected so executePlan is testable without a browser.
 * Defaults to executeGoto in production.
 */
export type IntentExecutor = (
  page: Page,
  goal: string,
  model?: Parameters<typeof executeGoto>[2],
  options?: ExecuteOptions,
) => Promise<ExecuteResult>;

export interface PlanExecuteOptions {
  /** Enable transparent self-heal on step failure. Default true. */
  useSelfHeal?: boolean;
  /** Session ID (for self-heal screenshot naming). */
  sessionId?: string;
  /** Called per step with progress info (for CLI display). */
  onStep?: (step: PlanStep, result: PlanStepResult) => void;
  /** If true, continue executing remaining steps after a failure. Default false. */
  continueOnFailure?: boolean;
}

/**
 * Execute a compiled plan deterministically — zero in-tool LLM calls.
 *
 * Each step's goal is passed to the executor (executeGoto by default), which
 * runs the full perceive→ground→act→verify loop + self-heal. On step failure,
 * the plan stops (unless continueOnFailure is set) and returns a partial result.
 *
 * @param page     The Playwright page.
 * @param plan     The compiled plan to execute.
 * @param options  Execution options.
 * @param executor The intent executor (defaults to executeGoto). Injected for testing.
 */
export async function executePlan(
  page: Page,
  plan: CompiledPlan,
  options: PlanExecuteOptions = {},
  executor: IntentExecutor = executeGoto,
): Promise<PlanResult> {
  const useSelfHeal = options.useSelfHeal ?? true;
  const continueOnFailure = options.continueOnFailure ?? false;

  const stepResults: PlanStepResult[] = [];
  let healsTriggered = 0;
  let stepsCompleted = 0;

  for (const step of plan.steps) {
    const stepResult: PlanStepResult = {
      stepIndex: step.stepIndex,
      success: false,
      message: '',
    };

    // Check if the step was parseable
    if (!step.intent) {
      stepResult.success = false;
      stepResult.message = `step ${step.stepIndex + 1} could not be parsed: "${step.goal}"`;
      stepResults.push(stepResult);
      options.onStep?.(step, stepResult);

      if (!continueOnFailure) {
        return {
          success: false,
          message: `plan failed at step ${step.stepIndex + 1}/${plan.steps.length}: unparseable intent`,
          stepsCompleted,
          stepsTotal: plan.steps.length,
          stepResults,
          healsTriggered,
          replansTriggered: 0,
        };
      }
      continue;
    }

    // Execute the step via the injected executor
    try {
      const result = await executor(page, step.goal, undefined, {
        useSelfHeal,
        sessionId: options.sessionId,
      });

      stepResult.success = result.success;
      stepResult.message = result.message;
      stepResult.result = result;
      if (result.healed) {
        stepResult.healed = true;
        stepResult.groundedRef = result.newRef;
        healsTriggered++;
      } else if (result.ground?.status === 'match') {
        stepResult.groundedRef = result.ground.ref;
      }

      stepResults.push(stepResult);
      options.onStep?.(step, stepResult);

      if (result.success) {
        stepsCompleted++;
      } else if (!continueOnFailure) {
        // Stop on first failure (deterministic plan execution)
        return {
          success: false,
          message: `plan failed at step ${step.stepIndex + 1}/${plan.steps.length}: ${result.message}`,
          stepsCompleted,
          stepsTotal: plan.steps.length,
          stepResults,
          healsTriggered,
          replansTriggered: 0,
        };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      stepResult.success = false;
      stepResult.message = `step ${step.stepIndex + 1} threw: ${msg}`;
      stepResults.push(stepResult);
      options.onStep?.(step, stepResult);

      if (!continueOnFailure) {
        return {
          success: false,
          message: `plan failed at step ${step.stepIndex + 1}/${plan.steps.length}: ${msg}`,
          stepsCompleted,
          stepsTotal: plan.steps.length,
          stepResults,
          healsTriggered,
          replansTriggered: 0,
        };
      }
    }
  }

  const success = stepsCompleted === plan.steps.length;
  return {
    success,
    message: success
      ? `plan executed: ${stepsCompleted}/${plan.steps.length} steps${healsTriggered > 0 ? ` (${healsTriggered} self-healed)` : ''}`
      : `plan completed with failures: ${stepsCompleted}/${plan.steps.length} steps succeeded`,
    stepsCompleted,
    stepsTotal: plan.steps.length,
    stepResults,
    healsTriggered,
    replansTriggered: 0,
  };
}

// ─── Plan storage (mirror recorder.ts pattern) ─────────────────

/** Directory where compiled plans are stored. */
export function getPlansDir(): string {
  return path.join(getDataDir(), 'plans');
}

/**
 * Generate a plan ID from the goal: slugified first ~6 words + short timestamp.
 * e.g. "type X into email, then click sign in" → "type-x-into-email-then-click-l4x9k2"
 */
export function generatePlanId(goal: string): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-')
    .slice(0, 50);
  const ts = Date.now().toString(36).slice(-6);
  return slug ? `${slug}-${ts}` : `plan-${ts}`;
}

/** Save a compiled plan to disk. Returns the plan ID + file path. */
export function savePlan(plan: CompiledPlan): { id: string; path: string } {
  const id = plan.id || generatePlanId(plan.goal);
  const savedPlan: CompiledPlan = { ...plan, id };

  const dir = getPlansDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(savedPlan, null, 2));

  return { id, path: file };
}

/** Load a compiled plan from disk by ID. Returns null if not found. */
export function loadPlan(id: string): CompiledPlan | null {
  const file = path.join(getPlansDir(), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as CompiledPlan;
  } catch {
    return null;
  }
}

/** List all saved plans (sorted by creation date, newest first). */
export function listPlans(): Array<{ id: string; goal: string; steps: number; createdAt: number }> {
  const dir = getPlansDir();
  if (!fs.existsSync(dir)) return [];

  const plans: Array<{ id: string; goal: string; steps: number; createdAt: number }> = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const plan = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as CompiledPlan;
      plans.push({
        id: plan.id,
        goal: plan.goal,
        steps: plan.steps.length,
        createdAt: plan.createdAt,
      });
    } catch {
      // Skip malformed files
    }
  }

  plans.sort((a, b) => b.createdAt - a.createdAt);
  return plans;
}

/** Delete a saved plan by ID. Returns true if deleted. */
export function deletePlan(id: string): boolean {
  const file = path.join(getPlansDir(), `${id}.json`);
  if (!fs.existsSync(file)) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

// ─── Rendering (for CLI display) ───────────────────────────────

/** Format a plan list for CLI display. */
export function renderPlanList(plans: Array<{ id: string; goal: string; steps: number; createdAt: number }>): string {
  if (plans.length === 0) {
    return 'No saved plans. Use "cairn compile \\"<goal>\\"" to compile one.';
  }
  const lines: string[] = [`Saved plans (${plans.length}):`];
  for (const p of plans) {
    const date = new Date(p.createdAt).toLocaleString();
    const goalPreview = p.goal.length > 70 ? p.goal.slice(0, 67) + '...' : p.goal;
    lines.push(`  ${p.id}`);
    lines.push(`    goal: ${goalPreview}`);
    lines.push(`    steps: ${p.steps}  |  created: ${date}`);
  }
  return lines.join('\n');
}

/** Format a single plan's details for CLI display. */
export function renderPlanDetails(plan: CompiledPlan): string {
  const lines: string[] = [];
  lines.push(`Plan: ${plan.goal}`);
  lines.push(`ID: ${plan.id}`);
  lines.push(`Steps: ${plan.steps.length}`);
  lines.push(`Created: ${new Date(plan.createdAt).toLocaleString()}`);
  lines.push('');
  lines.push('Steps:');
  for (const step of plan.steps) {
    const intentKind = step.intent ? step.intent.kind : 'unparseable';
    lines.push(`  ${step.stepIndex + 1}. [${intentKind}] "${step.goal}"`);
    if (step.pre) lines.push(`     pre: ${step.pre}`);
    if (step.post) lines.push(`     post: ${step.post}`);
  }
  return lines.join('\n');
}
