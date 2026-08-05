/**
 * Transparent Self-Heal — docs/REVOLUTION.md Leap 3.
 *
 * When a ref is stale (the page changed since the model was built) or an
 * action fails (E_REF_STALE, E_CLICK_FAILED), self-heal automatically:
 *   1. Builds a fresh page model
 *   2. Re-grounds the intent (deterministic + embeddings fallback)
 *   3. Retries the action with the new ref
 *   4. If semantic re-grounding fails, captures a marked screenshot for
 *      vision-based disambiguation (opt-in)
 *   5. Logs every heal step for transparency — the agent sees what happened
 *
 * The agent never sees the underlying E_REF_STALE failure. It either gets a
 * successful result (with a "self-healed" note) or a clear failure with context.
 *
 * Prior art: Healenium (ML attribute-similarity self-heal for Selenium),
 * TestInspector (auto-retry with AI re-grounding). Vision + agent self-heal
 * is novel — no agentic-browser tool does it.
 */

import type { Page } from 'playwright';
import { buildPageModel, type PageModel, type EnhancedNode } from '../model/page-model.js';
import { clickByRef } from '../actions/click.js';
import { typeByRef } from '../actions/type.js';
import { hoverByRef } from '../actions/hover.js';
import { scrollByRef } from '../actions/scroll.js';
import { selectByRef } from '../actions/select.js';
import { waitForPageSettled, computeDelta, renderDelta, type DeltaResult } from '../model/delta.js';
import { groundIntentWithFallback, renderGroundResult, type GroundResult } from './grounding.js';
import { captureMarkedScreenshot } from '../vision/screenshot.js';
import type { Intent } from './parser.js';

export interface SelfHealResult {
  /** Whether the self-heal successfully recovered and retried the action. */
  healed: boolean;
  /** The ref that was stale / failed. */
  originalRef?: string;
  /** The new ref the action was retried with. */
  newRef?: string;
  /** The fresh page model built during healing. */
  newModel: PageModel;
  /** The re-grounding result. */
  ground?: GroundResult;
  /** Whether the retried action succeeded. */
  actionSuccess: boolean;
  /** Message from the retried action. */
  actionMessage: string;
  /** DOM delta observed after the healed action. */
  delta?: DeltaResult;
  /** Human-readable log of each heal step (for transparency). */
  healLog: string[];
  /** Path to a marked screenshot, if vision fallback was used. */
  screenshotPath?: string;
}

export type ActionKind = 'click' | 'type' | 'hover' | 'scroll' | 'select';

/**
 * Execute an action by ref + kind. Used by self-heal to retry with the new ref.
 */
async function executeAction(
  page: Page,
  ref: string,
  kind: ActionKind,
  text?: string,
): Promise<{ success: boolean; message: string }> {
  if (kind === 'click') {
    return clickByRef(page, ref);
  } else if (kind === 'type' && text !== undefined) {
    return typeByRef(page, ref, text);
  } else if (kind === 'hover') {
    return hoverByRef(page, ref);
  } else if (kind === 'scroll') {
    return scrollByRef(page, ref);
  } else if (kind === 'select' && text !== undefined) {
    return selectByRef(page, ref, text);
  }
  return { success: false, message: `unsupported action kind: ${kind}` };
}

/**
 * Self-heal an NL intent action that failed.
 *
 * Re-grounds the intent against a fresh page model and retries the action.
 * If deterministic + embeddings grounding fails, optionally captures a marked
 * screenshot for vision-based disambiguation.
 *
 * @param page       The Playwright page.
 * @param intent     The original parsed intent (re-grounded against fresh model).
 * @param staleRef   The ref that was stale / failed.
 * @param actionKind What action to retry.
 * @param text       For type/select intents, the text/value to use.
 * @param options    Healing options (vision fallback, max attempts).
 */
export async function selfHealIntent(
  page: Page,
  intent: Intent,
  staleRef: string | undefined,
  actionKind: ActionKind,
  text?: string,
  options: SelfHealOptions = {},
): Promise<SelfHealResult> {
  const log: string[] = [];
  const maxAttempts = options.maxAttempts ?? 1;

  log.push(`self-heal triggered: ref ${staleRef ?? 'N/A'} stale/failed, rebuilding model + re-grounding`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 1. Build a fresh page model
    const freshModel = await buildPageModel(page);
    log.push(`attempt ${attempt}: built fresh model (${freshModel.refIndex.size} refs, url=${freshModel.url})`);

    // 2. Re-ground the intent against the fresh model
    const reGround = await groundIntentWithFallback(intent, freshModel);

    if (reGround.status === 'match') {
      log.push(`attempt ${attempt}: re-grounded → [${reGround.ref}] ${reGround.node.role}${reGround.node.name ? ` "${reGround.node.name}"` : ''} (score: ${reGround.score.toFixed(2)})`);

      // Don't retry with the same stale ref
      if (reGround.ref === staleRef) {
        log.push(`attempt ${attempt}: re-grounded to same ref ${staleRef} — page didn't change, giving up`);
        return {
          healed: false,
          originalRef: staleRef,
          newRef: reGround.ref,
          newModel: freshModel,
          ground: reGround,
          actionSuccess: false,
          actionMessage: `self-heal: re-grounded to same ref ${staleRef} — the element is still stale`,
          healLog: log,
        };
      }

      // 3. Retry the action with the new ref
      const actionResult = await executeAction(page, reGround.ref, actionKind, text);
      log.push(`attempt ${attempt}: retried ${actionKind} → ${actionResult.success ? 'success' : 'failed'}`);

      if (actionResult.success) {
        // 4. Verify — wait for settle, compute delta
        await waitForPageSettled(page);
        const finalModel = await buildPageModel(page);
        const delta = computeDelta(freshModel, finalModel);

        const parts: string[] = [actionResult.message];
        if (delta.urlChanged) {
          parts.push(`navigated to ${finalModel.url}`);
        } else if (delta.nodes.length > 0) {
          parts.push(renderDelta(delta).split('\n').slice(0, 8).join('\n'));
        }

        log.push(`attempt ${attempt}: heal successful`);

        return {
          healed: true,
          originalRef: staleRef,
          newRef: reGround.ref,
          newModel: finalModel,
          ground: reGround,
          actionSuccess: true,
          actionMessage: parts.join('\n'),
          delta,
          healLog: log,
        };
      }

      // Action failed again with the new ref — try another attempt or give up
      log.push(`attempt ${attempt}: action failed with new ref ${reGround.ref}: ${actionResult.message}`);
      if (attempt < maxAttempts) {
        await page.waitForTimeout(500);
        continue;
      }

      return {
        healed: false,
        originalRef: staleRef,
        newRef: reGround.ref,
        newModel: freshModel,
        ground: reGround,
        actionSuccess: false,
        actionMessage: actionResult.message,
        healLog: log,
      };
    }

    // Re-grounding didn't find a match
    log.push(`attempt ${attempt}: re-grounding failed — ${renderGroundResult(reGround)}`);

    if (attempt < maxAttempts) {
      await page.waitForTimeout(500);
      continue;
    }
  }

  // 5. Semantic re-grounding exhausted — optional vision fallback
  let screenshotPath: string | undefined;
  if (options.useVisionFallback) {
    try {
      const freshModel = await buildPageModel(page);
      const shot = await captureMarkedScreenshot(page, freshModel, { sessionId: options.sessionId });
      screenshotPath = shot.path;
      log.push(`vision fallback: captured marked screenshot (${shot.markedCount} elements marked) → ${shot.path}`);
    } catch {
      log.push('vision fallback: failed to capture screenshot');
    }
  }

  const finalModel = await buildPageModel(page);
  return {
    healed: false,
    originalRef: staleRef,
    newModel: finalModel,
    actionSuccess: false,
    actionMessage: `self-heal could not recover: re-grounding found no match for "${intent.target ?? ''}"`,
    healLog: log,
    screenshotPath,
  };
}

export interface SelfHealOptions {
  /** Maximum re-grounding attempts before giving up. Default 1. */
  maxAttempts?: number;
  /** If true, capture a marked screenshot when semantic re-grounding fails. */
  useVisionFallback?: boolean;
  /** Session ID for screenshot file naming. */
  sessionId?: string;
}

// ─── By-ref self-heal (for CLI commands that take a ref directly) ──────────

export interface RefHealResult {
  healed: boolean;
  originalRef: string;
  newRef?: string;
  newModel: PageModel;
  healLog: string[];
}

/**
 * Self-heal a by-ref action (e.g. `cairn click e15`).
 *
 * When a ref-based action fails, the element may have drifted. We rebuild the
 * page model and search for an element matching the stale ref's role + name
 * (attribute-similarity self-heal, inspired by Healenium).
 *
 * @param page     The Playwright page.
 * @param staleRef The ref that failed.
 * @param model    The page model built before the failed action (contains the
 *                 stale ref's role + name for matching).
 */
export async function selfHealByRef(
  page: Page,
  staleRef: string,
  model: PageModel,
): Promise<RefHealResult> {
  const log: string[] = [];
  log.push(`self-heal triggered: ref ${staleRef} failed, rebuilding model`);

  // Look up the stale ref's attributes in the existing model
  const staleNode = model.refIndex.get(staleRef);
  if (!staleNode) {
    log.push(`ref ${staleRef} not found in model — cannot self-heal`);
    const freshModel = await buildPageModel(page);
    return { healed: false, originalRef: staleRef, newModel: freshModel, healLog: log };
  }

  log.push(`looking for element with role="${staleNode.role}" name="${staleNode.name ?? ''}" in fresh model`);

  // Build a fresh model
  const freshModel = await buildPageModel(page);

  // Search for a node with the same role + name (or close name)
  const match = findReplacementByAttributes(staleNode, freshModel, staleRef);

  if (match) {
    log.push(`found match: [${match.ref}] (score: ${match.score.toFixed(2)}) — same role + name similarity`);
    return {
      healed: true,
      originalRef: staleRef,
      newRef: match.ref,
      newModel: freshModel,
      healLog: log,
    };
  }

  log.push(`no suitable match found`);
  return { healed: false, originalRef: staleRef, newModel: freshModel, healLog: log };
}

/**
 * Pure attribute-similarity matching — the testable core of selfHealByRef.
 *
 * Given a stale node (from the old page model) and a fresh model (rebuilt after
 * the page changed), find the best replacement by role + name similarity.
 * Returns null if no candidate scores ≥ 0.5.
 *
 * Scoring: exact name match = 1.0, substring = 0.8, token overlap × 0.5,
 * role-only (no name on either) = 0.3.
 *
 * @param staleNode  The element that went stale (role + name used for matching).
 * @param freshModel The fresh page model to search for a replacement in.
 * @param staleRef   The stale ref (skipped so we never match to ourselves).
 */
export function findReplacementByAttributes(
  staleNode: EnhancedNode,
  freshModel: PageModel,
  staleRef: string,
): { ref: string; score: number } | null {
  const targetRole = staleNode.role;
  const targetName = staleNode.name ?? '';

  let bestRef: string | undefined;
  let bestScore = 0;

  for (const [ref, node] of freshModel.refIndex) {
    if (ref === staleRef) continue; // skip the stale ref itself
    if (node.role !== targetRole) continue;

    let score = 0;
    if (targetName && node.name) {
      // Name similarity: exact match = 1.0, substring = 0.8, token overlap = 0.5
      if (node.name === targetName) {
        score = 1.0;
      } else if (node.name.includes(targetName) || targetName.includes(node.name)) {
        score = 0.8;
      } else {
        const targetTokens = new Set(targetName.toLowerCase().split(/\s+/));
        const nodeTokens = new Set(node.name.toLowerCase().split(/\s+/));
        let overlap = 0;
        for (const t of targetTokens) {
          if (nodeTokens.has(t)) overlap++;
        }
        score = overlap / Math.max(targetTokens.size, 1) * 0.5;
      }
    } else if (!targetName && !node.name) {
      // No name on either — match by role alone (weaker)
      score = 0.3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestRef = ref;
    }
  }

  return bestRef && bestScore >= 0.5 ? { ref: bestRef, score: bestScore } : null;
}
