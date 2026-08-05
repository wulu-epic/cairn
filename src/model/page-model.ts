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
  isIframe?: boolean;            // true if this node is an <iframe>
  frameInaccessible?: boolean;   // true if cross-origin iframe (content not walkable)
}

interface InteractivitySignalsFlat {
  nativeInteractive: boolean;
  ariaInteractive: boolean;
  hasTabindex: boolean;
  cursorPointer: boolean;
  hasOnclick: boolean;
  isEditable: boolean;
}

export interface MediaRich {
  canvasCount: number;
  webglCount: number;
  shadowDomCount: number;
}

export interface PageModel {
  url: string;
  title: string;
  tree: EnhancedNode;
  refIndex: Map<string, EnhancedNode>; // ref → node for O(1) lookup
  mediaRich: MediaRich;
  timestamp: number;
}

/** True if the page has canvas/WebGL/shadow-DOM that the structured model is blind to. */
export function isMediaRich(m: MediaRich): boolean {
  return m.canvasCount > 0 || m.webglCount > 0 || m.shadowDomCount > 0;
}

/** Build the page model from the current page state. */
export async function buildPageModel(page: Page): Promise<PageModel> {
  const result = await page.evaluate(buildModelScript) as
    { tree: EnhancedNode; mediaRich: MediaRich };

  const tree = result.tree;

  // Build ref index for fast lookup
  const refIndex = new Map<string, EnhancedNode>();
  indexNode(tree, refIndex);

  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    tree,
    refIndex,
    mediaRich: result.mediaRich,
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

  var SKIP_TAGS = ['script','style','meta','link','head','noscript','template','svg','path','br','wbr','col','area','map','track','source','param','base'];

  var refCounter = 0;
  function nextRef() { return 'e' + (++refCounter); }

  // Phase 2: media-rich detection counters (canvas/WebGL/shadow-DOM)
  var canvasCount = 0;
  var webglCount = 0;
  var shadowDomCount = 0;

  // Test whether a <canvas> has an active WebGL/WebGL2 context.
  // getContext returns null (or throws) if a 2d context is already attached.
  function hasWebGLContext(canvas) {
    try {
      var gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      return false;
    }
  }

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
      'iframe': 'iframe',
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

    // Phase 2: media-rich detection (canvas/WebGL/shadow-DOM).
    // The structured model is blind to these, so we count them to trigger
    // the vision fallback path. Counting happens before pruning so a canvas
    // that gets pruned from the model still flags the page as media-rich.
    if (tag === 'canvas') {
      canvasCount++;
      if (hasWebGLContext(el)) webglCount++;
    }
    if (el.shadowRoot !== null) {
      shadowDomCount++; // open shadow root — directly observable
    } else if (tag.indexOf('-') >= 0 || el.hasAttribute('is')) {
      // Custom element (hyphenated tag) or customized built-in element.
      // Most attach a closed shadow root, which is undetectable; flag as
      // probable shadow-DOM host so the agent is warned.
      shadowDomCount++;
    }

    var ref = nextRef();
    el.setAttribute('data-cairn-ref', ref);
    var role = getImplicitRole(el);
    var name = getAccessibleName(el);
    var rect = el.getBoundingClientRect();
    var inter = computeInteractivity(el);
    var region = getRegion(el);

    var children = [];
    var frameInaccessible = false;
    for (var i = 0; i < el.children.length; i++) {
      var childNode = walk(el.children[i]);
      if (childNode) children.push(childNode);
    }

    // Iframe support: try to access same-origin iframe content.
    // Cross-origin iframes throw on contentDocument access — we catch
    // and mark them as inaccessible so the agent knows there's content
    // it can't see structurally (vision fallback needed).
    if (tag === 'iframe') {
      try {
        var iframeDoc = el.contentDocument;
        if (iframeDoc && iframeDoc.body) {
          // Same-origin iframe — walk its body's children into our tree
          for (var j = 0; j < iframeDoc.body.children.length; j++) {
            var frameChild = walk(iframeDoc.body.children[j]);
            if (frameChild) children.push(frameChild);
          }
        } else {
          // contentDocument is null (not loaded or cross-origin)
          frameInaccessible = true;
        }
      } catch (e) {
        // SecurityError: cross-origin iframe
        frameInaccessible = true;
      }
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
      children: children,
      isIframe: tag === 'iframe' ? true : undefined,
      frameInaccessible: frameInaccessible ? true : undefined
    };
  }

  var tree = walk(document.body);
  return {
    tree: tree,
    mediaRich: {
      canvasCount: canvasCount,
      webglCount: webglCount,
      shadowDomCount: shadowDomCount
    }
  };
})()
`;
