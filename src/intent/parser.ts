/**
 * NL Intent Parser — deterministic natural-language → structured Intent.
 *
 * DESIGN.md §4.5: the `goto "<nl goal>"` command collapses 4-5 agent steps
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

export type Intent = ClickIntent | TypeIntent | NavigateIntent;

export interface ParseResult {
  intent: Intent | null;
  raw: string;
}

// ─── Verb patterns ─────────────────────────────────────────────

const CLICK_VERBS = ['click', 'press', 'select', 'tap', 'hit', 'choose'];
const TYPE_VERBS = ['type', 'enter', 'fill', 'input', 'write'];
const NAVIGATE_VERBS = ['go to', 'navigate to', 'open', 'visit', 'jump to'];

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
  const words = text.toLowerCase().split(/\s+/);
  const lastWord = words[words.length - 1] ?? '';
  const roleHint = ROLE_HINTS[lastWord];
  if (roleHint) {
    return { roleHint, remainder: words.slice(0, -1).join(' ').trim() };
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
  return s.replace(/^(?:the|a|an)\s+/i, '').trim();
}
