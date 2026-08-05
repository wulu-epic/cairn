/**
 * NL Intent Parser — deterministic natural-language → structured Intent.
 *
 * docs/DESIGN.md §4.5: the `goto "<nl goal>"` command collapses 4-5 agent steps
 * into one by running perceive→ground→act→verify internally. This parser is
 * the first stage: it converts a free-text goal into a structured Intent that
 * the grounder and executor can act on — using deterministic pattern matching,
 * NO LLM call (keeping it fast and free).
 *
 * Supported patterns:
 *   click/press/select/tap <target>        → ClickIntent
 *   type/enter/fill/input "<text>" into <target>  → TypeIntent
 *   go to/navigate to/open <target>        → NavigateIntent (→ click a link)
 *
 * Target extraction strips articles ("the/a/an"), pulls role hints
 * ("button"/"field"/"link"), and region hints ("in the nav").
 */

// ─── Intent types ──────────────────────────────────────────────

export interface ClickIntent {
  kind: 'click';
  target: string;       // normalized target description, e.g. "sign in"
  roleHint?: string;    // 'button' | 'link' | 'textbox' | 'checkbox' | ...
  region?: string;      // 'nav' | 'header' | 'main' | 'sidebar' | 'footer' | 'modal'
}

export interface TypeIntent {
  kind: 'type';
  target: string;       // the field to type into, e.g. "email"
  text: string;         // the text to type
  roleHint?: string;
  region?: string;
}

export interface NavigateIntent {
  kind: 'navigate';
  target: string;       // where to go, e.g. "settings" or "about page"
  region?: string;
}

export interface HoverIntent {
  kind: 'hover';
  target: string;       // element to hover over, e.g. "menu"
  roleHint?: string;
  region?: string;
}

export interface ScrollIntent {
  kind: 'scroll';
  direction?: 'up' | 'down' | 'top' | 'bottom';  // directional scroll
  target?: string;       // element to scroll into view (if not directional)
  roleHint?: string;
  region?: string;
}

export interface SelectIntent {
  kind: 'select';
  value: string;         // the option to select (value or label)
  target: string;        // the dropdown element, e.g. "country"
  roleHint?: string;
  region?: string;
}

export type Intent = ClickIntent | TypeIntent | NavigateIntent | HoverIntent | ScrollIntent | SelectIntent;

export interface ParseResult {
  intent: Intent | null;
  raw: string;
}

// ─── Verb patterns ─────────────────────────────────────────────

const CLICK_VERBS = ['click', 'press', 'select', 'tap', 'hit', 'choose'];
const TYPE_VERBS = ['type', 'enter', 'fill', 'input', 'write'];
const NAVIGATE_VERBS = ['go to', 'navigate to', 'open', 'visit', 'jump to'];
const HOVER_VERBS = ['hover over', 'hover'];
const SCROLL_DIRECTIONS = ['up', 'down', 'top', 'bottom'];
const SELECT_VERBS = ['select', 'choose', 'pick'];

// Words that describe element roles — stripped from the target but captured as hints.
const ROLE_HINTS: Record<string, string> = {
  button: 'button',
  btn: 'button',
  link: 'link',
  field: 'textbox',
  textbox: 'textbox',
  input: 'textbox',
  textarea: 'textbox',
  box: 'textbox',
  checkbox: 'checkbox',
  radio: 'radio',
  dropdown: 'combobox',
  select: 'combobox',
  combo: 'combobox',
  menu: 'menu',
  tab: 'tab',
  icon: 'img',
  image: 'img',
  logo: 'img',
  search: 'searchbox',
  searchbox: 'searchbox',
  slider: 'slider',
  toggle: 'switch',
  switch: 'switch',
};

// Region keywords → canonical region names (must match page-model getRegion).
const REGION_HINTS: Record<string, string> = {
  nav: 'nav',
  navigation: 'nav',
  navbar: 'nav',
  menu: 'nav',
  header: 'header',
  top: 'header',
  main: 'main',
  content: 'main',
  body: 'main',
  sidebar: 'sidebar',
  aside: 'sidebar',
  footer: 'footer',
  bottom: 'footer',
  modal: 'modal',
  dialog: 'modal',
  popup: 'modal',
  form: 'form',
};

// ─── Helpers ───────────────────────────────────────────────────

/** Lowercase + strip leading/trailing punctuation and articles. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')  // punctuation → spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract a region hint from the tail of a phrase ("... in the nav"). */
function extractRegion(text: string): { region: string | undefined; remainder: string } {
  // Match "in the <region>" / "in <region>" / "from the <region>" at the end
  const m = text.match(/\s+(?:in|from|inside|within)\s+(?:the\s+)?(\w+)\s*$/i);
  if (m) {
    const regionKey = m[1].toLowerCase();
    const region = REGION_HINTS[regionKey];
    if (region) {
      return { region, remainder: text.slice(0, m.index).trim() };
    }
  }
  return { region: undefined, remainder: text };
}

/** Extract a role hint from the tail of a phrase ("sign in button" → button). */
function extractRoleHint(text: string): { roleHint: string | undefined; remainder: string } {
  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  const lastWord = words[words.length - 1] ?? '';
  const roleHint = ROLE_HINTS[lastWord];
  if (roleHint) {
    const remainder = words.slice(0, -1).join(' ').trim();
    // Don't strip the role hint if the remainder would be empty after
    // removing articles — e.g. "the menu" shouldn't lose "menu" (which is
    // both a role hint AND part of the target name).
    if (stripArticles(remainder).length > 0) {
      return { roleHint, remainder };
    }
  }
  return { roleHint: undefined, remainder: text };
}

/**
 * Extract the text-to-type from a type-intent phrase.
 * Patterns:
 *   type "hello world" into the email field
 *   type hello into the email field
 *   fill in "test@example.com" in the email box
 *   enter hello in the search
 */
function extractTypeText(phrase: string): { text: string; targetPhrase: string } | null {
  // Try double-quoted text first: type "hello world" into ...
  let m = phrase.match(/^["'](.+?)["']\s+(?:into|in|inside)\s+(.+)$/i);
  if (m) return { text: m[1], targetPhrase: m[2] };

  // Try text before "into"/"in": type hello into the email field
  m = phrase.match(/^(.+?)\s+(?:into|in|inside)\s+(.+)$/i);
  if (m) {
    // The first group is the text — but make sure it's not the verb.
    // (verb was already stripped before this function is called)
    return { text: m[1].trim(), targetPhrase: m[2] };
  }

  // No "into"/"in" separator — ambiguous, can't determine text vs target
  return null;
}

// ─── Main parser ───────────────────────────────────────────────

/**
 * Parse a natural-language goal into a structured Intent.
 * Returns { intent: null } if the goal doesn't match any known pattern.
 */
export function parseIntent(goal: string): ParseResult {
  const raw = goal.trim();
  const lower = raw.toLowerCase();

  // ── Type intents ──
  for (const verb of TYPE_VERBS) {
    const prefix = verb + ' ';
    if (lower.startsWith(prefix)) {
      const rest = raw.slice(prefix.length).trim();
      // Handle "fill in" / "type in" where "in" is part of the verb, not a separator
      const phrase = rest.replace(/^(?:in|into)\s+/i, '');
      const extracted = extractTypeText(phrase);
      if (extracted) {
        const { region, remainder } = extractRegion(extracted.targetPhrase);
        const { roleHint, remainder: targetClean } = extractRoleHint(remainder);
        const target = normalize(stripArticles(targetClean));
        if (target && extracted.text) {
          return {
            intent: { kind: 'type', target, text: extracted.text, roleHint, region },
            raw,
          };
        }
      }
      // Fallback: no "into" separator — treat the whole phrase as the target
      // (the agent may have said "type in the email field" meaning "focus it")
      // This is ambiguous; return null to let the agent be more specific.
    }
  }

  // ── Navigate intents ──
  // Check multi-word verbs first ("go to" before "go")
  for (const verb of NAVIGATE_VERBS) {
    if (lower.startsWith(verb + ' ')) {
      const rest = raw.slice(verb.length).trim();
      const { region, remainder } = extractRegion(rest);
      const target = normalize(stripArticles(remainder));
      if (target) {
        return { intent: { kind: 'navigate', target, region }, raw };
      }
    }
  }

  // ── Hover intents ──
  // "hover over the menu" / "hover the profile button"
  for (const verb of HOVER_VERBS) {
    if (lower.startsWith(verb + ' ')) {
      const rest = raw.slice(verb.length).trim().replace(/^over\s+/i, '');
      const { region, remainder } = extractRegion(rest);
      const { roleHint, remainder: targetClean } = extractRoleHint(remainder);
      const target = normalize(stripArticles(targetClean));
      if (target) {
        return { intent: { kind: 'hover', target, roleHint, region }, raw };
      }
    }
  }

  // ── Scroll intents ──
  // "scroll down" / "scroll up" / "scroll to top" / "scroll to bottom"
  // "scroll to the comments" / "scroll to e15" (scroll element into view)
  if (lower === 'scroll' || lower.startsWith('scroll ')) {
    const rest = lower === 'scroll' ? '' : lower.slice(7).trim();

    // Directional: "scroll down", "scroll up", "scroll to top", "scroll to bottom"
    const dirMatch = rest.match(/^(?:to\s+)?(up|down|top|bottom)$/i);
    if (dirMatch) {
      const dir = dirMatch[1].toLowerCase() as 'up' | 'down' | 'top' | 'bottom';
      return { intent: { kind: 'scroll', direction: dir }, raw };
    }

    // Scroll to element: "scroll to the comments", "scroll to e15"
    if (rest.startsWith('to ') || rest.startsWith('to the ') || rest.startsWith('to a ')) {
      const targetPhrase = rest.replace(/^to\s+(?:the\s+|a\s+|an\s+)?/i, '');
      const { region, remainder } = extractRegion(targetPhrase);
      const { roleHint, remainder: targetClean } = extractRoleHint(remainder);
      const target = normalize(stripArticles(targetClean));
      if (target) {
        return { intent: { kind: 'scroll', target, roleHint, region }, raw };
      }
    }

    // Bare "scroll" with no direction/target — treat as scroll down
    if (rest === '') {
      return { intent: { kind: 'scroll', direction: 'down' }, raw };
    }
  }

  // ── Select intents (dropdown) ──
  // "select USA from the country dropdown"
  // "choose Texas in the state field"
  // Must check BEFORE click intents — 'select' and 'choose' are also click verbs.
  // The distinguishing pattern: a "from/in <target>" separator separates the
  // value from the dropdown. Without it, "select the button" is a click.
  for (const verb of SELECT_VERBS) {
    if (lower.startsWith(verb + ' ')) {
      const rest = raw.slice(verb.length).trim();
      // Match "<value> from <target>" or "<value> in <target>"
      const selectMatch = rest.match(/^(.+?)\s+(?:from|in|inside|in the)\s+(.+)$/i);
      if (selectMatch) {
        const value = selectMatch[1].trim();
        const { region, remainder } = extractRegion(selectMatch[2]);
        const { roleHint, remainder: targetClean } = extractRoleHint(remainder);
        const target = normalize(stripArticles(targetClean));
        if (value && target) {
          return { intent: { kind: 'select', value, target, roleHint, region }, raw };
        }
      }
      // No "from/in" separator — fall through to click handler
      // ("select the button" → click)
    }
  }

  // ── Click intents ──
  for (const verb of CLICK_VERBS) {
    if (lower.startsWith(verb + ' ')) {
      const rest = raw.slice(verb.length).trim();
      // Handle "on": "click on the button" → "click the button"
      const phrase = rest.replace(/^on\s+/i, '');
      const { region, remainder } = extractRegion(phrase);
      const { roleHint, remainder: targetClean } = extractRoleHint(remainder);
      const target = normalize(stripArticles(targetClean));
      if (target) {
        return { intent: { kind: 'click', target, roleHint, region }, raw };
      }
    }
  }

  // ── Bare target (no verb) ──
  // If the agent says just "sign in button" or "the email field", treat it as a click.
  {
    const { region, remainder: r1 } = extractRegion(raw);
    const { roleHint, remainder: r2 } = extractRoleHint(r1);
    const target = normalize(stripArticles(r2));
    if (target) {
      // If there's a textbox/field hint and no click verb, default to type? No —
      // ambiguous. Default to click (most common intent on a bare target).
      return { intent: { kind: 'click', target, roleHint, region }, raw };
    }
  }

  return { intent: null, raw };
}

/** Strip leading articles from a phrase. */
function stripArticles(s: string): string {
  return s.replace(/^(?:the|a|an)(?:\s+|$)/i, '').trim();
}
