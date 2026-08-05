import { describe, it, expect } from 'vitest';
import { parseIntent } from './parser.js';

// ─── Click intents ─────────────────────────────────────────────

describe('parseIntent — click intents', () => {
  it('parses "click submit"', () => {
    const { intent } = parseIntent('click submit');
    expect(intent).toMatchObject({ kind: 'click', target: 'submit' });
  });

  it('parses "click the sign in button" with roleHint', () => {
    const { intent } = parseIntent('click the sign in button');
    expect(intent).toMatchObject({ kind: 'click', target: 'sign in', roleHint: 'button' });
  });

  it('parses "press the submit button" with roleHint', () => {
    const { intent } = parseIntent('press the submit button');
    expect(intent).toMatchObject({ kind: 'click', target: 'submit', roleHint: 'button' });
  });

  it('parses "click the about link in the nav" with roleHint + region', () => {
    const { intent } = parseIntent('click the about link in the nav');
    expect(intent).toMatchObject({ kind: 'click', target: 'about', roleHint: 'link', region: 'nav' });
  });

  it('strips "on" after click verb', () => {
    const { intent } = parseIntent('click on submit');
    expect(intent).toMatchObject({ kind: 'click', target: 'submit' });
  });

  it('parses "tap the menu icon" with roleHint (icon→img)', () => {
    const { intent } = parseIntent('tap the menu icon');
    expect(intent).toMatchObject({ kind: 'click', target: 'menu', roleHint: 'img' });
  });
});

// ─── Type intents ──────────────────────────────────────────────

describe('parseIntent — type intents', () => {
  it('parses "type hello into the email field"', () => {
    const { intent } = parseIntent('type hello into the email field');
    expect(intent).toMatchObject({ kind: 'type', target: 'email', text: 'hello', roleHint: 'textbox' });
  });

  it('parses quoted text: type "hello world" into the email field', () => {
    const { intent } = parseIntent('type "hello world" into the email field');
    expect(intent).toMatchObject({ kind: 'type', target: 'email', text: 'hello world', roleHint: 'textbox' });
  });

  it('parses "fill in test@example.com in the email box"', () => {
    const { intent } = parseIntent('fill in test@example.com in the email box');
    expect(intent).toMatchObject({ kind: 'type', target: 'email', text: 'test@example.com', roleHint: 'textbox' });
  });

  it('parses "enter hello in the search field"', () => {
    const { intent } = parseIntent('enter hello in the search field');
    expect(intent).toMatchObject({ kind: 'type', target: 'search', text: 'hello', roleHint: 'textbox' });
  });

  it('parses single-quoted text: type \'hi\' into the name field', () => {
    const { intent } = parseIntent("type 'hi' into the name field");
    expect(intent).toMatchObject({ kind: 'type', target: 'name', text: 'hi', roleHint: 'textbox' });
  });
});

// ─── Navigate intents ──────────────────────────────────────────

describe('parseIntent — navigate intents', () => {
  it('parses "go to settings"', () => {
    const { intent } = parseIntent('go to settings');
    expect(intent).toMatchObject({ kind: 'navigate', target: 'settings' });
  });

  it('parses "navigate to about page"', () => {
    const { intent } = parseIntent('navigate to about page');
    expect(intent).toMatchObject({ kind: 'navigate', target: 'about page' });
  });

  it('parses "open the dashboard"', () => {
    const { intent } = parseIntent('open the dashboard');
    expect(intent).toMatchObject({ kind: 'navigate', target: 'dashboard' });
  });

  it('parses "go to settings in the header" with region', () => {
    const { intent } = parseIntent('go to settings in the header');
    expect(intent).toMatchObject({ kind: 'navigate', target: 'settings', region: 'header' });
  });
});

// ─── Bare target (no verb) ─────────────────────────────────────

describe('parseIntent — bare target fallback', () => {
  it('parses "sign in button" as a click intent with roleHint', () => {
    const { intent } = parseIntent('sign in button');
    expect(intent).toMatchObject({ kind: 'click', target: 'sign in', roleHint: 'button' });
  });

  it('parses "the email field" as a click intent with roleHint', () => {
    const { intent } = parseIntent('the email field');
    expect(intent).toMatchObject({ kind: 'click', target: 'email', roleHint: 'textbox' });
  });
});

// ─── Edge cases ────────────────────────────────────────────────

describe('parseIntent — edge cases', () => {
  it('returns null for empty string', () => {
    const { intent } = parseIntent('');
    expect(intent).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    const { intent } = parseIntent('   ');
    expect(intent).toBeNull();
  });
});

// ─── Hover intents ──────────────────────────────────────────────

describe('parseIntent — hover intents', () => {
  it('parses "hover over the menu"', () => {
    const { intent } = parseIntent('hover over the menu');
    expect(intent).toMatchObject({ kind: 'hover', target: 'menu' });
  });

  it('parses "hover the profile button" with roleHint', () => {
    const { intent } = parseIntent('hover the profile button');
    expect(intent).toMatchObject({ kind: 'hover', target: 'profile', roleHint: 'button' });
  });

  it('parses "hover over the account link in the nav" with region', () => {
    const { intent } = parseIntent('hover over the account link in the nav');
    expect(intent).toMatchObject({ kind: 'hover', target: 'account', roleHint: 'link', region: 'nav' });
  });
});

// ─── Scroll intents ─────────────────────────────────────────────

describe('parseIntent — scroll intents', () => {
  it('parses "scroll down"', () => {
    const { intent } = parseIntent('scroll down');
    expect(intent).toMatchObject({ kind: 'scroll', direction: 'down' });
  });

  it('parses "scroll up"', () => {
    const { intent } = parseIntent('scroll up');
    expect(intent).toMatchObject({ kind: 'scroll', direction: 'up' });
  });

  it('parses "scroll to top"', () => {
    const { intent } = parseIntent('scroll to top');
    expect(intent).toMatchObject({ kind: 'scroll', direction: 'top' });
  });

  it('parses "scroll to bottom"', () => {
    const { intent } = parseIntent('scroll to bottom');
    expect(intent).toMatchObject({ kind: 'scroll', direction: 'bottom' });
  });

  it('parses "scroll to the comments" as scroll-to-element', () => {
    const { intent } = parseIntent('scroll to the comments');
    expect(intent).toMatchObject({ kind: 'scroll', target: 'comments' });
    expect(intent).not.toHaveProperty('direction');
  });

  it('parses bare "scroll" as scroll down', () => {
    const { intent } = parseIntent('scroll');
    expect(intent).toMatchObject({ kind: 'scroll', direction: 'down' });
  });
});

// ─── Select intents ─────────────────────────────────────────────

describe('parseIntent — select intents', () => {
  it('parses "select USA from the country dropdown"', () => {
    const { intent } = parseIntent('select USA from the country dropdown');
    expect(intent).toMatchObject({ kind: 'select', value: 'USA', target: 'country', roleHint: 'combobox' });
  });

  it('parses "choose Texas in the state field"', () => {
    const { intent } = parseIntent('choose Texas in the state field');
    expect(intent).toMatchObject({ kind: 'select', value: 'Texas', target: 'state', roleHint: 'textbox' });
  });

  it('parses "pick 2 from the quantity dropdown"', () => {
    const { intent } = parseIntent('pick 2 from the quantity dropdown');
    expect(intent).toMatchObject({ kind: 'select', value: '2', target: 'quantity', roleHint: 'combobox' });
  });

  it('falls through to click when no "from/in" separator', () => {
    const { intent } = parseIntent('select the submit button');
    expect(intent).toMatchObject({ kind: 'click', target: 'submit', roleHint: 'button' });
  });
});
