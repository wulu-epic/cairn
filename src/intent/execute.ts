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
 * `cairn look --visual` for visual disambiguation (the agent, which IS an LLM,
 * then resolves it).
 *
 * Multi-step intent composition: when a type intent (e.g. "type X into the
 * search field") returns notFound because the field is hidden behind a
 * link→dialog pattern (Wikipedia, DuckDuckGo), the executor automatically
 * clicks the matching link/button to open the dialog, then re-grounds and
 * types. See clickToReveal() below.
 */

import type { Page } from 'playwright';
import { buildPageModel, type PageModel } from '../model/page-model.js';
import { clickByRef } from '../actions/click.js';
import { typeByRef } from '../actions/type.js';
import { hoverByRef } from '../actions/hover.js';
import { scrollByRef, scrollDirection } from '../actions/scroll.js';
import { selectByRef } from '../actions/select.js';
import { waitForPageSettled, computeDelta, renderDelta, type DeltaResult } from '../model/delta.js';
import { parseIntent, type Intent, type ClickIntent, type TypeIntent, type SelectIntent } from './parser.js';
import { groundIntent, groundIntentWithFallback, renderGroundResult, TYPEABLE_ROLES, type GroundResult } from './grounding.js';
import { selfHealIntent, type ActionKind } from './self-heal.js';
import type { TaskRecorder } from './recorder.js';

export interface ExecuteOptions {
  /** Enable transparent self-heal on action failure. Default true. */
  useSelfHeal?: boolean;
  /** If provided, record each successful step to this recorder. */
  recorder?: TaskRecorder;
  /** Session ID (for self-heal screenshot file naming). */
  sessionId?: string;
}

export interface ExecuteResult {
  success: boolean;
  message: string;
  intent?: Intent;
  ground?: GroundResult;
  delta?: DeltaResult;
  newModel?: PageModel;
  /** True if self-heal recovered a failed action. */
  healed?: boolean;
  /** Transparency log from self-heal (each step taken). */
  healLog?: string[];
  /** The new ref after self-heal (differs from the original if healed). */
  newRef?: string;
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

  // Return the result regardless of match status — the caller handles each case.
  // Even if re-grounding didn't find a match, the page changed (dialog opened),
  // so we report what happened.
  return { newModel, ground: reGround, clickedRef: clickGround.ref };
}

// ─── Main executor ─────────────────────────────────────────────

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
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const useSelfHeal = options.useSelfHeal ?? true;

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

  // 2.5. Scroll directional intents don't need grounding — just scroll the
  // page. "scroll down", "scroll to top", etc. have no target element.
  if (intent.kind === 'scroll' && intent.direction) {
    const scrollResult = await scrollDirection(page, intent.direction);
    await waitForPageSettled(page);
    const newModel = await buildPageModel(page);
    const delta = computeDelta(currentModel, newModel);
    const parts: string[] = [scrollResult.message];
    if (delta.urlChanged) {
      parts.push(`navigated to ${newModel.url}`);
    } else if (delta.nodes.length > 0) {
      const deltaStr = renderDelta(delta);
      parts.push(deltaStr.split('\n').slice(0, 8).join('\n'));
    }
    return {
      success: scrollResult.success,
      message: parts.join('\n'),
      intent,
      delta,
      newModel,
    };
  }

  // 3. Ground the intent → find the target ref
  // Uses the embeddings fallback: deterministic grounding first (fast path),
  // then semantic similarity for synonym matches ("sign in"↔"log in") if needed.
  const ground = await groundIntentWithFallback(intent, currentModel);

  if (ground.status === 'notFound') {
    // click-to-reveal fallback (multi-step intent composition):
    // For type intents, the target field (e.g. "search") might be hidden behind
    // a link→dialog pattern (Wikipedia, DuckDuckGo). Try clicking a matching
    // link/button to reveal it, then re-ground and type.
    if (intent.kind === 'type') {
      const revealed = await clickToReveal(page, intent, currentModel);
      if (revealed) {
        if (revealed.ground.status === 'match') {
          // Found the field after clicking to reveal — but the dialog/overlay
          // may still be animating (CSS transitions) or the DOM may have been
          // re-rendered (invalidating data-cairn-ref attributes). Wait, re-build
          // a fresh model, re-ground, and try to type.
          await page.waitForTimeout(800);
          const freshModel = await buildPageModel(page);
          const freshGround = groundIntent(intent, freshModel);

          let typed = false;
          let typeMsg = '';

          if (freshGround.status === 'match') {
            const typeResult = await typeByRef(page, freshGround.ref, intent.text);
            if (typeResult.success) {
              typed = true;
              typeMsg = typeResult.message;
            }
          }

          // Direct-locator fallback: if ref-based typing failed (the dialog's
          // JS may have re-rendered and stripped data-cairn-ref attributes), use
          // a Playwright locator to find the first visible input on the page.
          // This handles Wikipedia's search dialog which re-renders on open.
          if (!typed) {
            try {
              const inputLocator = page.locator('input:visible, textarea:visible').first();
              await inputLocator.waitFor({ state: 'visible', timeout: 3000 });
              await inputLocator.fill(intent.text, { timeout: 5000 });
              const inputInfo = await inputLocator.evaluate((el: HTMLElement) => ({
                tag: el.tagName.toLowerCase(),
                name: el.getAttribute('aria-label') || el.getAttribute('placeholder') || '',
              })).catch(() => ({ tag: 'input', name: '' }));
              typed = true;
              typeMsg = `typed "${intent.text}" into ${inputInfo.tag}${inputInfo.name ? ` "${inputInfo.name}"` : ''} (via direct locator — dialog re-rendered)`;
            } catch {
              // Direct locator also failed
            }
          }

          if (typed) {
            // Verify — wait for settle, compute delta
            await waitForPageSettled(page);
            const finalModel = await buildPageModel(page);
            const delta = computeDelta(freshModel, finalModel);

            const parts: string[] = [];
            parts.push(`auto-opened dialog via [${revealed.clickedRef}], then ${typeMsg}`);
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
              ground: freshGround.status === 'match' ? freshGround : revealed.ground,
              delta,
              newModel: finalModel,
            };
          }
        }
        // Clicked but typing still failed — report what happened
        const revealMsg = revealed.ground.status === 'notFound'
          ? `auto-clicked [${revealed.clickedRef}] to open a dialog, but still couldn't find "${intent.target}" —\n${renderGroundResult(revealed.ground)}\n→ try "cairn look --visual" to see the dialog contents.`
          : revealed.ground.status === 'ambiguous'
            ? `auto-clicked [${revealed.clickedRef}] to open a dialog, but found multiple matches for "${intent.target}" —\n${renderGroundResult(revealed.ground)}\n→ specify which one or run "cairn look --visual".`
            : `auto-clicked [${revealed.clickedRef}] to open a dialog, but couldn't type into the field. The dialog may use a custom input widget — try "cairn look --visual" then "cairn type <ref> <text>".`;
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
      message: `not found: no element matched "${intent.target}"${closestMsg}\n→ try "cairn look --visual" for a marked screenshot to visually locate the element.`,
      intent,
      ground,
      newModel: currentModel,
    };
  }

  if (ground.status === 'ambiguous') {
    return {
      success: false,
      message: `ambiguous: ${ground.candidates.length} elements match "${intent.target}" —\n${renderGroundResult(ground)}\n→ specify which one (e.g. "click the <unique name> button") or run "cairn look --visual".`,
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

  let actionResult: { success: boolean; message: string; ref?: string };
  if (actionKind === 'click') {
    actionResult = await clickByRef(page, ref);
  } else if (actionKind === 'type') {
    actionResult = await typeByRef(page, ref, (intent as Extract<Intent, { kind: 'type' }>).text);
  } else if (actionKind === 'hover') {
    actionResult = await hoverByRef(page, ref);
  } else if (actionKind === 'scroll') {
    actionResult = await scrollByRef(page, ref);
  } else if (actionKind === 'select') {
    const sel = intent as Extract<Intent, { kind: 'select' }>;
    actionResult = await selectByRef(page, ref, sel.value);
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
    // ── Transparent self-heal (Leap 3) ──
    // The action failed — the ref may be stale (page changed since grounding).
    // Re-ground the intent against a fresh model and retry transparently.
    if (useSelfHeal) {
      const healText = actionKind === 'type'
        ? (intent as Extract<Intent, { kind: 'type' }>).text
        : actionKind === 'select'
          ? (intent as Extract<Intent, { kind: 'select' }>).value
          : undefined;

      const heal = await selfHealIntent(page, intent, ref, actionKind as ActionKind, healText, {
        sessionId: options.sessionId,
      });

      if (heal.healed && heal.actionSuccess) {
        // Self-heal recovered — record + return the healed result
        if (options.recorder) {
          options.recorder.recordStep({
            goal,
            intent,
            groundedRef: heal.newRef,
            groundScore: heal.ground?.status === 'match' ? heal.ground.score : undefined,
            fallbacksUsed: ['selfHeal'],
            actionKind: actionKind as ActionKind,
            text: healText,
            success: true,
            message: heal.actionMessage,
            url: heal.newModel.url,
            timestamp: Date.now(),
          });
        }
        return {
          success: true,
          message: `[self-healed] ${heal.actionMessage}\n  (re-grounded [${ref}] → [${heal.newRef}])`,
          intent,
          ground: heal.ground,
          delta: heal.delta,
          newModel: heal.newModel,
          healed: true,
          healLog: heal.healLog,
          newRef: heal.newRef,
        };
      }

      // Self-heal failed — return the failure with the heal log for transparency
      return {
        success: false,
        message: `${actionResult.message}\n[self-heal attempted but failed: ${heal.actionMessage}]`,
        intent,
        ground,
        newModel: heal.newModel,
        healed: false,
        healLog: heal.healLog,
      };
    }

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

  // Record the successful step (if recording is enabled — Leap 2)
  if (options.recorder) {
    const recordText = actionKind === 'type'
      ? (intent as Extract<Intent, { kind: 'type' }>).text
      : actionKind === 'select'
        ? (intent as Extract<Intent, { kind: 'select' }>).value
        : undefined;
    options.recorder.recordStep({
      goal,
      intent,
      groundedRef: ref,
      groundScore: ground.status === 'match' ? ground.score : undefined,
      fallbacksUsed: [],
      actionKind: actionKind as ActionKind,
      text: recordText,
      success: true,
      message: parts.join('\n'),
      url: newModel.url,
      timestamp: Date.now(),
    });
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
