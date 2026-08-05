/**
 * Interactivity Inference — the core differentiator.
 *
 * Instead of trusting declared ARIA attributes (which "lie" on custom widgets),
 * we compute interactivity from a fusion of signals:
 *   - Native interactive tags (button, a, input, select, textarea, ...)
 *   - ARIA interactive roles (button, link, textbox, checkbox, ...)
 *   - Tabindex (tabindex >= 0)
 *   - Computed style (cursor: pointer)
 *   - Inline onclick handlers
 *   - contenteditable
 *   - Visibility + size (must be visible and have dimensions)
 *
 * This catches div-as-button (cursor:pointer + onclick but no role) that
 * attribute-only approaches miss entirely.
 *
 * The INTERACTIVITY_SCRIPT is injected into the browser via page.evaluate()
 * and must be fully self-contained (no closures, no external references).
 */

export interface InteractivitySignals {
  nativeInteractive: boolean;
  ariaInteractive: boolean;
  hasTabindex: boolean;
  cursorPointer: boolean;
  hasOnclick: boolean;
  isEditable: boolean;
}

export const NATIVE_INTERACTIVE_TAGS = [
  'button', 'a', 'input', 'select', 'textarea', 'summary', 'details',
  'option', 'optgroup', 'fieldset', 'legend', 'label',
];

export const INTERACTIVE_ARIA_ROLES = [
  'button', 'link', 'textbox', 'checkbox', 'radio', 'slider', 'tab',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'combobox', 'option',
  'switch', 'searchbox', 'spinbutton',
];

/**
 * Self-contained function string injected into the browser context.
 * Returns { interactive, signals } for a given element.
 */
export const INTERACTIVITY_SCRIPT = `
function computeInteractivity(el) {
  var tagName = el.tagName.toLowerCase();
  var role = el.getAttribute('role');
  var cs = getComputedStyle(el);

  var nativeTags = ['button','a','input','select','textarea','summary','details','option','optgroup','fieldset','legend','label'];
  var ariaRoles = ['button','link','textbox','checkbox','radio','slider','tab','menuitem','menuitemcheckbox','menuitemradio','combobox','option','switch','searchbox','spinbutton'];

  var nativeInteractive = nativeTags.indexOf(tagName) >= 0;
  var ariaInteractive = role && ariaRoles.indexOf(role) >= 0;
  var hasTabindex = el.tabIndex >= 0;
  var cursorPointer = cs.cursor === 'pointer';
  var hasOnclick = !!el.onclick;
  var isEditable = el.isContentEditable;
  var pointerEventsAuto = cs.pointerEvents !== 'none';

  var rect = el.getBoundingClientRect();
  var hasSize = rect.width > 0 && rect.height > 0;
  var isVisible = cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';

  var interactive = (nativeInteractive || ariaInteractive || hasTabindex || cursorPointer || hasOnclick || isEditable)
    && isVisible && hasSize && pointerEventsAuto;

  return {
    interactive: interactive,
    signals: {
      nativeInteractive: nativeInteractive,
      ariaInteractive: !!ariaInteractive,
      hasTabindex: hasTabindex,
      cursorPointer: cursorPointer,
      hasOnclick: hasOnclick,
      isEditable: isEditable
    }
  };
}
`;
