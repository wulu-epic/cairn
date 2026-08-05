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
import { parseIntent, type Intent, type ClickIntent, type TypeIntent } from './parser.js';
import { groundIntent, renderGroundResult, TYPEABLE_ROLES, type GroundResult } from './grounding.js';

export interface ExecuteResult {
  success: boolean;
  message: string;
  intent?: Intent;
  ground?: GroundResult;
  delta?: DeltaResult;
  newModel?: PageModel;
}

// ─── Click-to-reveal fallback (multi-step intent composition) ──────────

interface RevealResult {
  newModel: PageModel;
  ground: GroundResult;
  clickedRef: string;
}

/**
 * Multi-step intent composition: when a type intent's target (e.g. "search
 * field") isn't found on the current page, check if there's a clickable
 * link/button with the same name (e.g. a "Search" link that opens a dialog).
 * If so, click it, wait for the page to settle (dialog/form appears), rebuild
 * the model, and re-ground the original type intent.
 *
 * This handles sites like Wikipedia and DuckDuckGo that hide search inputs
 * behind a link→dialog pattern. Capped at one fallback hop.
 */
async function clickToReveal(
  page: Page,
  intent: TypeIntent,
  model: PageModel,
): Promise<RevealResult | null> {
  // Re-ground the same target as a CLICK intent (no typeability penalty —
  // we want links/buttons, not inputs)
  const clickIntent: ClickIntent = {
    kind: 'click',
    target: intent.target,
    // No roleHint — accept any clickable element
  };
  const clickGround = groundIntent(clickIntent, model);
  if (clickGround.status !== 'match') return null;

  // Don't click on typeable elements (inputs) — we're looking for a trigger,
  // not the field itself (which we already failed to find as typeable)
  if (TYPEABLE_ROLES.includes(clickGround.node.role)) return null;

  // Click the element to reveal the dialog/form
  const clickResult = await clickByRef(page, clickGround.ref);
  if (!clickResult.success) return null;

  // Wait for the page to settle (dialog opens, DOM mutates)
  await waitForPageSettled(page);

  // Re-build the model and re-ground the ORIGINAL type intent
  const newModel = await buildPageModel(page);
  const reGround = groundIntent(intent, newModel);

  if (reGround.status === 'match') {
    return { newModel, ground: reGround, clickedRef: clickGround.ref };
  }

  // Even if re-grounding didn't find a match, return the result so the caller
  // can report that a click happened but the field still wasn't found.
  return { newModel, ground: reGround, clickedRef: clickGround.ref };
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
    // Click-to-reveal fallback (multi-step intent composition):
    // For type intents, the target field (e.g. "search") might be hidden behind
    // a link→dialog pattern (Wikipedia, DuckDuckGo). Try clicking a matching
    // link/button to reveal it, then re-ground and type.
    if (intent.kind === 'type') {
      const revealed = await clickToReveal(page, intent, currentModel);
      if (revealed) {
        if (revealed.ground.status === 'match') {
          // Found the field after clicking to reveal — type into it
          const typeResult = await typeByRef(page, revealed.ground.ref, intent.text);
          if (typeResult.success) {
            // Verify — wait for settle, compute delta from the post-click model
            await waitForPageSettled(page);
            const finalModel = await buildPageModel(page);
            const delta = computeDelta(revealed.newModel, finalModel);

            const parts: string[] = [];
            parts.push(`auto-opened dialog via [${revealed.clickedRef}], then ${typeResult.message}`);
            if (delta.urlChanged) {
              parts.push(`navigated to ${finalModel.url}`);
            } else if (delta.nodes.length > 0) {
              const deltaStr = renderDelta(delta);
              parts.push(deltaStr.split('\n').slice(0, 8).join('\n'));
            } else {
              parts.push('(no visible changes detected)');
            }
            return {
              success: true,
              message: parts.join('\n'),
              intent,
              ground: revealed.ground,
              delta,
              newModel: finalModel,
            };
          }
        }
        // Clicked but re-grounding still failed — report what happened
        const revealMsg = revealed.ground.status === 'notFound'
          ? `auto-clicked [${revealed.clickedRef}] to open a dialog, but still couldn't find "${intent.target}" —\n${renderGroundResult(revealed.ground)}\n→ try "abt look --visual" to see the dialog contents.`
          : revealed.ground.status === 'ambiguous'
            ? `auto-clicked [${revealed.clickedRef}] to open a dialog, but found multiple matches for "${intent.target}" —\n${renderGroundResult(revealed.ground)}\n→ specify which one or run "abt look --visual".`
            : `auto-clicked [${revealed.clickedRef}] but couldn't complete the type action.`;
        return {
          success: false,
          message: revealMsg,
          intent,
          ground: revealed.ground,
          newModel: revealed.newModel,
        };
      }
    }

    // No fallback attempted (non-type intent) or fallback found nothing to click
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
