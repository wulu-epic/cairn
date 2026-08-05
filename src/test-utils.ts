/**
 * Test utilities — mock builders for unit tests.
 * Constructs EnhancedNode/PageModel objects without a browser.
 */
import type { EnhancedNode, PageModel, MediaRich } from './model/page-model.js';

/** Build a minimal EnhancedNode with sensible defaults. */
export function makeNode(opts: Partial<EnhancedNode> & { ref: string }): EnhancedNode {
  return {
    role: 'generic',
    interactive: false,
    children: [],
    bbox: { x: 0, y: 0, width: 100, height: 30 },
    ...opts,
  };
}

/** Build a PageModel from a list of top-level nodes (children of root). */
export function makeModel(
  nodes: EnhancedNode[],
  opts?: { url?: string; title?: string; mediaRich?: MediaRich },
): PageModel {
  const root = makeNode({ ref: 'root', role: 'document', children: nodes });
  const refIndex = new Map<string, EnhancedNode>();
  function index(node: EnhancedNode) {
    refIndex.set(node.ref, node);
    for (const child of node.children) index(child);
  }
  index(root);
  return {
    url: opts?.url ?? 'https://example.test',
    title: opts?.title ?? 'Test Page',
    tree: root,
    refIndex,
    mediaRich: opts?.mediaRich ?? { canvasCount: 0, webglCount: 0, shadowDomCount: 0 },
    timestamp: Date.now(),
  };
}
