/**
 * Agent-Facing Hierarchical Renderer
 *
 * Takes the spatial-semantic page model and produces a compact, bash-like,
 * hierarchical tree view with [ref=eN] refs — matching DESIGN.md §4.2 format.
 *
 * Features:
 *   - Region clustering: groups nodes by region (nav/main/sidebar/footer/modal)
 *   - Focus/zoom: when a region is focused, shows only that subtree (token-efficient)
 *   - Interactive flag: marks clickable elements with (clickable)
 *   - Self-describing: header shows URL + focused region + what's possible
 *   - Compact: only shows interactive elements + containers + text nodes
 */

import type { PageModel, EnhancedNode } from '../model/page-model.js';
import { isMediaRich, getInteractiveNodes } from '../model/page-model.js';

const REGION_ORDER = ['header', 'nav', 'main', 'sidebar', 'footer', 'modal', 'form'];
const REGION_LABELS: Record<string, string> = {
  header: 'Header',
  nav: 'Navigation',
  main: 'Main',
  sidebar: 'Sidebar',
  footer: 'Footer',
  modal: 'Modal',
  form: 'Form',
};

export interface RenderOptions {
  focusedRegion?: string | null;
  maxDepth?: number;
  showAll?: boolean; // if true, show non-interactive nodes too (for debugging)
  visualMode?: boolean; // if true, suppress the "run cairn look --visual" hint (already in visual mode)
  interactiveOnly?: boolean; // if true, show only interactive elements (compact, ~3x smaller)
}

/** Render the full page model as a compact hierarchical tree. */
export function renderPage(model: PageModel, options: RenderOptions = {}): string {
  const lines: string[] = [];

  // Header: URL + focused region
  lines.push(`page: ${model.url}`);
  if (options.focusedRegion) {
    lines.push(`(region: ${REGION_LABELS[options.focusedRegion] ?? options.focusedRegion})`);
  }
  lines.push('---');

  // Phase 2: warn the agent when the page is media-rich (canvas/WebGL/shadow-DOM).
  // The structured model is blind to these; vision fallback disambiguates.
  if (isMediaRich(model.mediaRich)) {
    const mr = model.mediaRich;
    const parts: string[] = [];
    if (mr.canvasCount) parts.push(`${mr.canvasCount} canvas${mr.canvasCount > 1 ? 'es' : ''}`);
    if (mr.webglCount) parts.push(`${mr.webglCount} webgl`);
    if (mr.shadowDomCount) parts.push(`${mr.shadowDomCount} shadow-dom`);
    const hint = options.visualMode
      ? 'see marked screenshot above for visual grounding'
      : 'run "cairn look --visual" for a marked screenshot';
    lines.push(`⚠ media-rich page (${parts.join(', ')}) — structured model is blind to these; ${hint}`);
  }

  // Interactive-only mode: compact flat list of just the actionable elements,
  // grouped by region. Matches agent-browser's `-i` compactness (~3x smaller
  // than the full tree). Skips all text nodes, containers, and headings.
  if (options.interactiveOnly) {
    const allInteractive = getInteractiveNodes(model);
    const interactive = options.focusedRegion
      ? allInteractive.filter((n) => n.region === options.focusedRegion)
      : allInteractive;

    if (interactive.length === 0) {
      lines.push('(no interactive elements found)');
    } else {
      // Group by region for context, then list each element on one line
      const byRegion = new Map<string, EnhancedNode[]>();
      for (const node of interactive) {
        const r = node.region ?? 'main';
        if (!byRegion.has(r)) byRegion.set(r, []);
        byRegion.get(r)!.push(node);
      }
      const sorted = [...byRegion.entries()].sort((a, b) => {
        const ai = REGION_ORDER.indexOf(a[0]);
        const bi = REGION_ORDER.indexOf(b[0]);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      for (const [region, nodes] of sorted) {
        lines.push(`▼ ${REGION_LABELS[region] ?? region}`);
        for (const node of nodes) {
          const parts: string[] = [node.role];
          if (node.name) parts.push(`"${truncate(node.name, 50)}"`);
          else if (node.text) parts.push(`"${truncate(node.text, 50)}"`);
          parts.push(`[ref=${node.ref}]`);
          const sig = node.interactivitySignals;
          if (sig?.cursorPointer && !sig.nativeInteractive && !sig.ariaInteractive) {
            parts.push('(inferred)');
          }
          lines.push(`  ${parts.join(' ')}`);
        }
        lines.push('');
      }
    }

    lines.push(`---`);
    lines.push(`${interactive.length} interactive elements. Use "cairn click <ref>" or "cairn type <ref> <text>".`);
    return lines.join('\n');
  }

  if (options.focusedRegion) {
    // Zoom into the focused region
    const regionNode = findRegionNode(model.tree, options.focusedRegion);
    if (regionNode) {
      renderNode(regionNode, lines, 0, options);
    } else {
      lines.push(`(region "${options.focusedRegion}" not found — use "cairn look" to see all regions)`);
    }
  } else {
    // Show all regions
    const regions = clusterByRegion(model.tree);
    if (regions.length === 0) {
      // No regions detected — just render the tree as-is
      renderNode(model.tree, lines, 0, options);
    } else {
      // Render each region as a labeled section
      const sorted = regions.sort((a, b) => {
        const ai = REGION_ORDER.indexOf(a.region);
        const bi = REGION_ORDER.indexOf(b.region);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      for (const r of sorted) {
        lines.push(`▼ ${REGION_LABELS[r.region] ?? r.region}`);
        for (const child of r.nodes) {
          renderNode(child, lines, 1, options);
        }
        lines.push('');
      }
    }
  }

  // Footer: action hints
  const interactiveCount = countInteractive(model.tree);
  lines.push(`---`);
  lines.push(`${interactiveCount} interactive elements. Use "cairn click <ref>" or "cairn type <ref> <text>".`);

  return lines.join('\n');
}

/** Render a single node and its children recursively. */
function renderNode(node: EnhancedNode, lines: string[], depth: number, options: RenderOptions): void {
  const maxDepth = options.maxDepth ?? 10;
  if (depth > maxDepth) return;

  const indent = '  '.repeat(depth);

  // Skip non-interactive, non-container, non-text nodes unless showAll
  // Exception: always show iframe nodes so the agent knows about
  // cross-origin iframes it can't see structurally.
  if (!options.showAll && !node.interactive && node.children.length === 0 && !node.text && !node.isIframe) {
    return;
  }

  // Build the node line
  const parts: string[] = [];
  parts.push(node.role);

  if (node.name) {
    parts.push(`"${truncate(node.name, 60)}"`);
  } else if (node.text) {
    parts.push(`"${truncate(node.text, 80)}"`);
  }

  // Level for headings
  const headingMatch = node.role === 'heading';
  if (headingMatch) {
    // Could add level info if available
  }

  parts.push(`[ref=${node.ref}]`);

  // Iframe markers — show the agent when content is inside an iframe
  // and whether it's accessible (same-origin) or not (cross-origin)
  if (node.isIframe) {
    parts.push(node.frameInaccessible ? '(cross-origin iframe)' : '(iframe)');
  }

  // Hidden marker — only set when the model was built with includeHidden.
  // Surfaces CSS-hidden / aria-hidden content (disclaimers, deceptive patterns)
  // that the a11y tree normally excludes.
  if (node.hidden) {
    parts.push(`(hidden: ${node.hidden})`);
  }

  // Interactive marker
  if (node.interactive) {
    const signals = node.interactivitySignals;
    if (signals?.cursorPointer && !signals.nativeInteractive && !signals.ariaInteractive) {
      parts.push('(inferred clickable)');
    } else {
      parts.push('(clickable)');
    }
  }

  lines.push(`${indent}${parts.join(' ')}`);

  // Render children
  for (const child of node.children) {
    renderNode(child, lines, depth + 1, options);
  }
}

/** Group top-level nodes by their region. */
interface RegionGroup {
  region: string;
  nodes: EnhancedNode[];
}

function clusterByRegion(root: EnhancedNode): RegionGroup[] {
  const groups: RegionGroup[] = [];
  const seen = new Set<string>();

  function findRegions(node: EnhancedNode) {
    if (node.region && !seen.has(node.region)) {
      seen.add(node.region);
      groups.push({ region: node.region, nodes: [node] });
    } else {
      for (const child of node.children) {
        findRegions(child);
      }
    }
  }

  findRegions(root);

  // Collect nodes without a region into a "main" fallback
  const ungrouped: EnhancedNode[] = [];
  function collectUngrouped(node: EnhancedNode, insideRegion: boolean) {
    if (node.region && seen.has(node.region)) {
      insideRegion = true;
    }
    if (!insideRegion && node !== root) {
      // This node is not inside any region
    }
    for (const child of node.children) {
      collectUngrouped(child, insideRegion);
    }
  }

  return groups;
}

/** Find the first node with the given region. */
function findRegionNode(node: EnhancedNode, region: string): EnhancedNode | null {
  if (node.region === region) return node;
  for (const child of node.children) {
    const found = findRegionNode(child, region);
    if (found) return found;
  }
  return null;
}

/** Count interactive nodes in the tree. */
function countInteractive(node: EnhancedNode): number {
  let count = node.interactive ? 1 : 0;
  for (const child of node.children) {
    count += countInteractive(child);
  }
  return count;
}

/** Truncate text with ellipsis. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}
