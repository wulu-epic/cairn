/**
 * Intent Executor — the full perceive→ground→act→verify loop in one call.
 *
 * DESIGN.md §4.5: "the agent states intent in English, the tool runs the
 * perceive/ground/act/verify loop internally (using deterministic logic),
 * and returns 'done: clicked Sign in, now on /dashboard' or 'ambiguous: two
 * Sign in buttons, which?'"
 *
 * This is the "collapse the loop" function: one bash command per unit of
 * progress instead of 4-5. It's deterministic — no in-tool LLM call. When
 * grounding is ambiguous or fails, it returns the candidates and suggests
 * `abt look --visual` for visual disambiguation (the agent, which IS an LLM,
 * then resolves it).
 */

import type { Page } from 'playwright';
import { buildPageModel, type PageModel } from '../model/page-model.js';
import { clickByRef } from '../actions/click.js';
import { typeByRef } from '../actions/type.js';
import { waitForPageSettled, computeDelta, renderDelta, type DeltaResult } from '../model/delta.js';
import { parseIntent, type Intent } from './parser.js';
import { groundIntent, renderGroundResult, type GroundResult } from './grounding.js';

export interface ExecuteResult {
  success: boolean;
  message: string;
  intent?: Intent;
  ground?: GroundResult;
  delta?: DeltaResult;
  newModel?: PageModel;
}

/**
 * Execute a natural-language `goto` intent end-to-end.
 *
 * Steps: parse goal → build model → ground intent → act (click/type) →
 * wait for settled → compute delta → return compact result.
 *
 * If model is provided, it's used for grounding (avoids a rebuild); otherwise
 * a fresh model is built.
 */
export async function executeGoto(
  page: Page,
  goal: string,
  model?: PageModel,
): Promise<ExecuteResult> {
  // 1. Parse the NL goal into a structured Intent
  const { intent } = parseIntent(goal);
  if (!intent) {
    return {
      success: false,
      message: `could not parse intent from "${goal}". Try: "click the <name> button", "type "<text>" into the <name> field", or "go to <page>".`,
    };
  }

  // 2. Build the page model (if not provided)
  const currentModel = model ?? await buildPageModel(page);

  // 3. Ground the intent → find the target ref
  const ground = groundIntent(intent, currentModel);

  if (ground.status === 'notFound') {
    const closestMsg = ground.closest.length > 0
      ? `\n${renderGroundResult(ground)}`
      : '';
    return {
      success: false,
      message: `not found: no element matched "${intent.target}"${closestMsg}\n→ try "abt look --visual" for a marked screenshot to visually locate the element.`,
      intent,
      ground,
      newModel: currentModel,
    };
  }

  if (ground.status === 'ambiguous') {
    return {
      success: false,
      message: `ambiguous: ${ground.candidates.length} elements match "${intent.target}" —\n${renderGroundResult(ground)}\n→ specify which one (e.g. "click the <unique name> button") or run "abt look --visual".`,
      intent,
      ground,
      newModel: currentModel,
    };
  }

  // 4. Act — execute the grounded action by ref
  const ref = ground.ref;
  const node = ground.node;

  // For navigate intents, the action is a click (on a link)
  const actionKind = intent.kind === 'navigate' ? 'click' : intent.kind;

  let actionResult: { success: boolean; message: string; ref: string };
  if (actionKind === 'click') {
    actionResult = await clickByRef(page, ref);
  } else if (actionKind === 'type') {
    actionResult = await typeByRef(page, ref, (intent as Extract<Intent, { kind: 'type' }>).text);
  } else {
    return {
      success: false,
      message: `unsupported intent kind: ${(intent as Intent).kind}`,
      intent,
      ground,
      newModel: currentModel,
    };
  }

  if (!actionResult.success) {
    return {
      success: false,
      message: actionResult.message,
      intent,
      ground,
      newModel: currentModel,
    };
  }

  // 5. Verify — wait for page to settle, compute delta
  await waitForPageSettled(page);
  const newModel = await buildPageModel(page);
  const delta = computeDelta(currentModel, newModel);

  // 6. Build the compact result message
  const parts: string[] = [];
  parts.push(actionResult.message);

  if (delta.urlChanged) {
    parts.push(`navigated to ${newModel.url}`);
  } else if (delta.nodes.length > 0) {
    // Include a compact delta summary
    const deltaStr = renderDelta(delta);
    // Only include the delta if it's short (keep output compact)
    const deltaLines = deltaStr.split('\n').slice(0, 8);  // cap at 8 lines
    parts.push(deltaLines.join('\n'));
  } else {
    parts.push('(no visible changes detected)');
  }

  return {
    success: true,
    message: parts.join('\n'),
    intent,
    ground,
    delta,
    newModel,
  };
}

/**
 * A compact one-line summary for CLI output, prefixed with ✓/✗.
 * Useful when the CLI just wants the bottom line.
 */
export function summarizeResult(result: ExecuteResult): string {
  const prefix = result.success ? '✓' : '✗';
  return `${prefix} ${result.message}`;
}
