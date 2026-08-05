/**
 * Spatial-Semantic Page Model
 *
 * Builds a unified model by walking the DOM and computing for each element:
 *   - stable ref (e1, e2, ...) for deterministic ref-based actions
 *   - role (from ARIA or inferred from tag)
 *   - accessible name (aria-label, label, text, title)
 *   - bounding box (getBoundingClientRect)
 *   - inferred interactivity (from interactivity.ts)
 *   - region (nav/main/sidebar/footer/modal)
 *   - children (recursive tree)
 *
 * The model is built in one page.evaluate() round-trip for efficiency.
 * CDP AX tree (Accessibility.getFullAXTree) enhancement is a future improvement.
 */

import type { Page } from 'playwright';
import { INTERACTIVITY_SCRIPT } from './interactivity.js';

export interface EnhancedNode {
  ref: string;
  role: string;
  name?: string;
  text?: string;
  bbox: { x: number; y: number; width: number; height: number };
  interactive: boolean;
  interactivitySignals?: InteractivitySignalsFlat;
  region?: string;
  children: EnhancedNode[];
}

interface InteractivitySignalsFlat {
  nativeInteractive: boolean;
  ariaInteractive: boolean;
  hasTabindex: boolean;
  cursorPointer: boolean;
  hasOnclick: boolean;
  isEditable: boolean;
}

export interface PageModel {
  url: string;
  title: string;
  tree: EnhancedNode;
  refIndex: Map<string, EnhancedNode>; // ref → node for O(1) lookup
  timestamp: number;
}

/** Build the page model from the current page state. */
export async function buildPageModel(page: Page): Promise<PageModel> {
  const tree = await page.evaluate(buildModelScript) as EnhancedNode;

  // Build ref index for fast lookup
  const refIndex = new Map<string, EnhancedNode>();
  indexNode(tree, refIndex);

  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    tree,
    refIndex,
    timestamp: Date.now(),
  };
}

function indexNode(node: EnhancedNode, index: Map<string, EnhancedNode>): void {
  index.set(node.ref, node);
  for (const child of node.children) {
    indexNode(child, index);
  }
}

/** Flatten the model to a list of interactive nodes (for delta diffing + actions). */
export function getInteractiveNodes(model: PageModel): EnhancedNode[] {
  const result: EnhancedNode[] = [];
  function collect(node: EnhancedNode) {
    if (node.interactive) result.push(node);
    for (const child of node.children) collect(child);
  }
  collect(model.tree);
  return result;
}

// ─── Browser-side script (injected via page.evaluate) ──────────

const buildModelScript = `
(() => {
  ${INTERACTIVITY_SCRIPT}

  var SKIP_TAGS = ['script','style','meta','link','head','noscript','template','svg','path','br','wbr','iframe','col','area','map','track','source','param','base'];

  var refCounter = 0;
  function nextRef() { return 'e' + (++refCounter); }

  function getImplicitRole(el) {
    var role = el.getAttribute('role');
    if (role) return role;
    var tag = el.tagName.toLowerCase();
    var map = {
      'a': el.href ? 'link' : 'generic',
      'button': 'button',
      'input': getInputRole(el),
      'select': 'combobox',
      'textarea': 'textbox',
      'h1':'heading','h2':'heading','h3':'heading','h4':'heading','h5':'heading','h6':'heading',
      'img': 'img',
      'nav': 'navigation',
      'main': 'main',
      'aside': 'complementary',
      'footer': 'contentinfo',
      'header': 'banner',
      'form': 'form',
      'ul': 'list', 'ol': 'list',
      'li': 'listitem',
      'table': 'table',
      'tr': 'row',
      'td': 'cell',
      'th': 'columnheader',
      'label': 'label',
      'p': 'paragraph',
      'section': 'region',
      'article': 'article',
      'dialog': 'dialog',
      'figure': 'figure',
      'figcaption': 'caption',
      'details': 'group',
      'summary': 'button',
      'fieldset': 'group',
      'legend': 'legend',
      'option': 'option',
      'optgroup': 'group'
    };
    return map[tag] || 'generic';
  }

  function getInputRole(el) {
    var type = (el.type || '').toLowerCase();
    var map = {
      'text': 'textbox', 'email': 'textbox', 'password': 'textbox',
      'search': 'searchbox', 'tel': 'textbox', 'url': 'textbox',
      'number': 'spinbutton', 'range': 'slider',
      'checkbox': 'checkbox', 'radio': 'radio',
      'submit': 'button', 'button': 'button', 'reset': 'button',
      'file': 'button', 'image': 'button'
    };
    return map[type] || 'textbox';
  }

  function getDirectText(el) {
    var text = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) text += el.childNodes[i].textContent;
    }
    return text.trim();
  }

  function getAccessibleName(el) {
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var labelEl = document.getElementById(labelledBy);
      if (labelEl) return (labelEl.textContent || '').trim().slice(0, 100);
    }

    var tag = el.tagName.toLowerCase();

    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      var id = el.id;
      if (id) {
        var label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
        if (label) return (label.textContent || '').trim().slice(0, 100);
      }
      var parentLabel = el.closest('label');
      if (parentLabel) return (parentLabel.textContent || '').trim().slice(0, 100);
      if (el.placeholder) return el.placeholder;
      if (el.getAttribute('title')) return el.getAttribute('title');
      if (el.type === 'submit' || el.type === 'button') return el.value || '';
    }

    if (tag === 'img') return el.alt || el.getAttribute('title') || '';

    var directText = getDirectText(el);
    if (directText) return directText.slice(0, 100);

    if (el.getAttribute('title')) return el.getAttribute('title');
    return '';
  }

  function getRegion(el) {
    var tag = el.tagName.toLowerCase();
    var role = el.getAttribute('role');
    if (tag === 'nav' || role === 'navigation') return 'nav';
    if (tag === 'main' || role === 'main') return 'main';
    if (tag === 'aside' || role === 'complementary') return 'sidebar';
    if (tag === 'footer' || role === 'contentinfo') return 'footer';
    if (tag === 'header' || role === 'banner') return 'header';
    if (tag === 'dialog' || role === 'dialog') return 'modal';
    if (tag === 'form' || role === 'form') return 'form';
    return null;
  }

  function walk(el) {
    var tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.indexOf(tag) >= 0) return null;

    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;

    var ref = nextRef();
    var role = getImplicitRole(el);
    var name = getAccessibleName(el);
    var rect = el.getBoundingClientRect();
    var inter = computeInteractivity(el);
    var region = getRegion(el);

    var children = [];
    for (var i = 0; i < el.children.length; i++) {
      var childNode = walk(el.children[i]);
      if (childNode) children.push(childNode);
    }

    // Prune: skip elements with no content
    var directText = getDirectText(el);
    if (!inter.interactive && !name && children.length === 0 && !directText) {
      return null;
    }

    var text = undefined;
    if (children.length === 0 && directText) {
      text = directText.slice(0, 200);
    }

    return {
      ref: ref,
      role: role,
      name: name || undefined,
      text: text,
      bbox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      interactive: inter.interactive,
      interactivitySignals: inter.interactive ? inter.signals : undefined,
      region: region || undefined,
      children: children
    };
  }

  return walk(document.body);
})()
`;
