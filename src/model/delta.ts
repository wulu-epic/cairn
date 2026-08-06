/**
 * Delta-Based State Output
 *
 * After an action: inject MutationObserver via Runtime.evaluate, wait for
 * mutation-quiet (page settled), re-snapshot the filtered element list,
 * diff against the previous snapshot by stable ref, and emit only the delta
 * (changed/added/removed elements). An action that changes one field costs
 * ~one line of output, not a full page dump.
 *
 * docs/DESIGN.md §3.6: "Deltas, not snapshots. After an action, send only what
 * changed (MutationObserver/IntersectionObserver quiet → re-snapshot filtered
 * elements → diff by stable ref → emit delta)."
 */

import type { Page } from 'playwright';
import type { PageModel, EnhancedNode } from './page-model.js';
import { buildPageModel, getInteractiveNodes } from './page-model.js';

export interface NodeDelta {
  ref: string;
  change: 'added' | 'removed' | 'changed';
  role?: string;
  name?: string;
  region?: string;
  before?: { name?: string; text?: string; interactive: boolean };
  after?: { name?: string; text?: string; interactive: boolean };
}

export interface DeltaResult {
  urlChanged: boolean;
  oldUrl?: string;
  newUrl?: string;
  nodes: NodeDelta[];
  summary: string;
}

/** Wait for the page to settle (no DOM mutations for a quiet period). */
export async function waitForPageSettled(page: Page, quietMs: number = 300, maxWait: number = 5000): Promise<void> {
  await page.evaluate(`
    new Promise((resolve) => {
      let timer = null;
      let startTime = Date.now();
      const observer = new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        if (Date.now() - startTime > ${maxWait}) {
          observer.disconnect();
          resolve();
          return;
        }
        timer = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, ${quietMs});
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      // If no mutations happen at all, resolve after quietMs
      timer = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, ${quietMs});
    })
  `);
}

/** Compute the delta between two page models (by ref). */
export function computeDelta(prevModel: PageModel, currModel: PageModel): DeltaResult {
  const prevNodes = new Map<string, EnhancedNode>();
  const currNodes = new Map<string, EnhancedNode>();

  // Index all nodes (not just interactive) by ref for diffing
  function indexAll(node: EnhancedNode, map: Map<string, EnhancedNode>) {
    map.set(node.ref, node);
    for (const child of node.children) indexAll(child, map);
  }
  indexAll(prevModel.tree, prevNodes);
  indexAll(currModel.tree, currNodes);

  const deltas: NodeDelta[] = [];

  // Added nodes (in curr but not prev)
  for (const [ref, curr] of currNodes) {
    const prev = prevNodes.get(ref);
    if (!prev) {
      deltas.push({
        ref,
        change: 'added',
        role: curr.role,
        name: curr.name,
        region: curr.region,
        after: {
          name: curr.name,
          text: curr.text,
          interactive: curr.interactive,
        },
      });
    } else {
      // Changed nodes (name, text, or interactivity changed)
      const nameChanged = prev.name !== curr.name;
      const textChanged = prev.text !== curr.text;
      const interChanged = prev.interactive !== curr.interactive;
      if (nameChanged || textChanged || interChanged) {
        deltas.push({
          ref,
          change: 'changed',
          role: curr.role,
          name: curr.name,
          region: curr.region,
          before: {
            name: prev.name,
            text: prev.text,
            interactive: prev.interactive,
          },
          after: {
            name: curr.name,
            text: curr.text,
            interactive: curr.interactive,
          },
        });
      }
    }
  }

  // Removed nodes (in prev but not curr)
  for (const [ref, prev] of prevNodes) {
    if (!currNodes.has(ref)) {
      deltas.push({
        ref,
        change: 'removed',
        role: prev.role,
        name: prev.name,
        region: prev.region,
        before: {
          name: prev.name,
          text: prev.text,
          interactive: prev.interactive,
        },
      });
    }
  }

  const urlChanged = prevModel.url !== currModel.url;

  // Build summary
  const added = deltas.filter(d => d.change === 'added').length;
  const removed = deltas.filter(d => d.change === 'removed').length;
  const changed = deltas.filter(d => d.change === 'changed').length;
  const parts: string[] = [];
  if (urlChanged) parts.push(`url: ${prevModel.url} → ${currModel.url}`);
  if (added) parts.push(`+${added} added`);
  if (removed) parts.push(`-${removed} removed`);
  if (changed) parts.push(`~${changed} changed`);
  const summary = parts.length > 0 ? parts.join(', ') : 'no changes';

  return {
    urlChanged,
    oldUrl: prevModel.url,
    newUrl: currModel.url,
    nodes: deltas,
    summary,
  };
}

/** Render a delta as a compact string (the agent-facing output). */
export function renderDelta(delta: DeltaResult): string {
  const lines: string[] = [];

  if (delta.urlChanged) {
    lines.push(`navigated: ${delta.oldUrl} → ${delta.newUrl}`);
  }

  if (delta.nodes.length === 0 && !delta.urlChanged) {
    lines.push('no changes detected');
    return lines.join('\n');
  }

  // Gap #6: surface text changes prominently. Text changes in modal/form
  // regions (cart totals, item names) are the signal that an action had a
  // semantic effect — e.g. clicking "add to cart" should change a total.
  // Mark these with ★ so the agent notices them immediately, and show text
  // content on added nodes (new cart items surface as "Caffee Latte $4.50").
  const TEXT_HIGHLIGHT_REGIONS = ['modal', 'form'];
  let textChanges = 0;

  for (const d of delta.nodes) {
    const ref = `[${d.ref}]`;
    const label = d.name ? `"${d.name}"` : '';
    const inTextRegion = d.region ? TEXT_HIGHLIGHT_REGIONS.includes(d.region) : false;

    if (d.change === 'added') {
      // Show text content on added nodes — surfaces new cart items, new list
      // entries, new totals. Previously only role+name showed, so a cart item
      // "Caffee Latte $4.50" appeared as just "listitem" with no value.
      const textPart = (d.after?.text && !d.name) ? ` "${d.after.text.slice(0, 50)}"` : '';
      const regionPart = inTextRegion ? ` (${d.region})` : '';
      lines.push(`+ ${ref} ${d.role} ${label}${textPart} (new${d.after?.interactive ? ', interactive' : ''}${regionPart})`);
    } else if (d.change === 'removed') {
      const textPart = (d.before?.text && !d.name) ? ` "${d.before.text.slice(0, 50)}"` : '';
      lines.push(`- ${ref} ${d.role} ${label}${textPart} (removed)`);
    } else if (d.change === 'changed') {
      const changes: string[] = [];
      if (d.before?.name !== d.after?.name) {
        changes.push(`name: "${d.before?.name ?? ''}" → "${d.after?.name ?? ''}"`);
      }
      if (d.before?.text !== d.after?.text) {
        const oldText = (d.before?.text ?? '').slice(0, 40);
        const newText = (d.after?.text ?? '').slice(0, 40);
        changes.push(`text: "${oldText}" → "${newText}"`);
        if (inTextRegion) textChanges++;
      }
      if (d.before?.interactive !== d.after?.interactive) {
        changes.push(`interactive: ${d.before?.interactive} → ${d.after?.interactive}`);
      }
      const marker = (inTextRegion && d.before?.text !== d.after?.text) ? '★ ' : '';
      const regionPart = inTextRegion ? ` (${d.region})` : '';
      lines.push(`${marker}~ ${ref} ${d.role} ${label}${regionPart} — ${changes.join('; ')}`);
    }
  }

  // Summary now includes a text-changes count when text changed in key regions
  const parts: string[] = [delta.summary];
  if (textChanges > 0) {
    parts.push(`${textChanges} text change${textChanges === 1 ? '' : 's'} in modal/form`);
  }
  lines.push(`(${parts.join(', ')})`);

  return lines.join('\n');
}

/**
 * Perform an action, wait for settled, compute delta, and return compact output.
 * This is the "collapse the loop" function: action + wait + delta in one call.
 */
export async function actionWithDelta(
  page: Page,
  prevModel: PageModel | null,
  action: () => Promise<void>,
): Promise<{ delta: DeltaResult | null; model: PageModel }> {
  // Execute the action
  await action();

  // Wait for page to settle
  await waitForPageSettled(page);

  // Build the new model
  const model = await buildPageModel(page);

  // Compute delta if we have a previous model
  const delta = prevModel ? computeDelta(prevModel, model) : null;

  return { delta, model };
}
