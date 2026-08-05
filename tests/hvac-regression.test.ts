/**
 * HVAC Demo Regression Suite — Cairn vs the 9 planted bugs.
 *
 * This is the ground-truth test site from HVAC_BUGREPORT.md (hvac-demo/),
 * repurposed as a reusable regression suite. Each test asserts Cairn can
 * (1) model/surface each bug-relevant element and (2) interact + observe
 * the buggy behavior. The two fixes under test:
 *   - Shadow-DOM piercing (bug #6): filter buttons inside an open shadow
 *     root must surface as actionable refs.
 *   - Hidden-content surfacing (bug #5): `look --include-hidden` must
 *     surface the display:none warranty disclaimer.
 *
 * Served via file:// URLs (JS runs fine on file://; matches the existing
 * e2e pattern in tests/e2e.test.ts). Each page group uses a unique session
 * ID so browser sessions don't interfere.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const DEMO = path.join(ROOT, 'hvac-demo');

/** Convert a Windows/POSIX path to a file:// URL. */
function fileUrl(p: string): string {
  return pathToFileURL(p).href;
}

interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run the Cairn CLI with the given args and optional session ID. */
function runCairn(args: string[], sessionId?: string, timeoutMs = 45000): CLIResult {
  const parts = ['npx', 'tsx', `"${CLI}"`, ...args.map((a) => (a.includes(' ') ? `"${a}"` : a))];
  if (sessionId) parts.push('--session', sessionId);
  const cmd = parts.join(' ');
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status ?? 1,
    };
  }
}

/** Release a session (clean up Chrome) after tests. */
function releaseSession(sessionId: string): void {
  try {
    runCairn(['release'], sessionId, 10000);
  } catch {
    // ignore — best-effort cleanup
  }
}

// ─── Bug #1: About Us → 404 ─────────────────────────────────────

describe('HVAC #1 — About Us link 404s', () => {
  const session = 'hvac-1';
  const url = fileUrl(path.join(DEMO, 'index.html'));

  afterAll(() => releaseSession(session));

  it('surfaces the About Us link as a ref', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('About Us');
  }, 60000);

  it('the About Us link target (about.html) does not exist — 404', () => {
    // The About Us nav link points to about.html, which is not a real file.
    // Navigate directly to it: a nonexistent file:// URL throws ERR_FILE_NOT_FOUND,
    // which the CLI surfaces as a structured CairnError (nonzero exit).
    const aboutUrl = fileUrl(path.join(DEMO, 'about.html'));
    const r = runCairn(['goto', aboutUrl], session);
    // The goto must fail — the destination doesn't exist.
    expect(r.exitCode).not.toBe(0);
    // The failure is surfaced as a structured error code the agent can read.
    expect(r.stderr + r.stdout).toContain('E_');
  }, 60000);
});

// ─── Bug #2: Contact form has no validation ──────────────────────

describe('HVAC #2 — Contact form accepts empty submit', () => {
  const session = 'hvac-2';
  const url = fileUrl(path.join(DEMO, 'contact.html'));

  afterAll(() => releaseSession(session));

  it('navigates to the contact page', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Contact');
  }, 60000);

  it('submitting an empty form shows a fake success message', () => {
    // Click "Send Message" with all fields empty — the bug shows success.
    const r = runCairn(['goto', 'click the Send Message button'], session);
    // The form's submit handler calls preventDefault + shows success text.
    // After the click, look for the fake confirmation.
    const look = runCairn(['look'], session);
    expect(look.stdout).toContain('message has been sent');
  }, 60000);
});

// ─── Bug #3: BTU calculator miscalculation (25 not 20) ──────────

describe('HVAC #3 — BTU calculator uses 25 not 20', () => {
  const session = 'hvac-3';
  const url = fileUrl(path.join(DEMO, 'quote.html'));

  afterAll(() => releaseSession(session));

  it('navigates to the quote page', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('BTU');
  }, 60000);

  it('1000 sqft yields 25,000 BTU (should be 20,000 at 20/sqft)', () => {
    // Type 1000 into the sqft field
    const type = runCairn(['goto', 'type 1000 into the Home Square Footage field'], session);
    expect(type.exitCode).toBe(0);
    // Click Calculate
    const click = runCairn(['goto', 'click the Calculate BTU Need button'], session);
    expect(click.exitCode).toBe(0);
    // The result should show 25,000 (the buggy 25x multiplier)
    const look = runCairn(['look'], session);
    expect(look.stdout).toContain('25,000');
  }, 60000);
});

// ─── Bug #4: "Save 40%" discount is wrong (actual 30%) ──────────

describe('HVAC #4 — Save 40% badge is actually 30%', () => {
  const session = 'hvac-4';
  const url = fileUrl(path.join(DEMO, 'index.html'));

  afterAll(() => releaseSession(session));

  it('surfaces the discount card content (Was/Now/Save)', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
    // The card text includes the price, was-price, and the misleading badge.
    expect(r.stdout).toContain('1,399');
    expect(r.stdout).toContain('1,999');
    expect(r.stdout).toContain('Save 40%');
  }, 60000);
});

// ─── Bug #5: Hidden warranty disclaimer (display:none) ──────────

describe('HVAC #5 — hidden warranty disclaimer', () => {
  const session = 'hvac-5';
  const url = fileUrl(path.join(DEMO, 'index.html'));

  afterAll(() => releaseSession(session));

  it('normal look does NOT surface the display:none disclaimer', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
    // The warranty text is hidden via CSS .hidden { display: none }
    expect(r.stdout).not.toContain('Warranty excludes labor');
  }, 60000);

  it('look --include-hidden surfaces the display:none disclaimer', () => {
    const r = runCairn(['look', '--include-hidden'], session);
    expect(r.exitCode).toBe(0);
    // The hidden warranty text must now be visible in the model.
    expect(r.stdout).toContain('Warranty excludes labor');
    // And it should be marked as hidden so the agent knows.
    expect(r.stdout).toContain('(hidden:');
  }, 60000);
});

// ─── Bug #6: Broken shadow-DOM product filter ───────────────────

describe('HVAC #6 — shadow-DOM product filter', () => {
  const session = 'hvac-6';
  const url = fileUrl(path.join(DEMO, 'products.html'));

  afterAll(() => releaseSession(session));

  it('surfaces the shadow-root filter buttons as refs', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
    // The 4 filter buttons live inside an open shadow root. With the
    // shadow-DOM piercing fix, they must surface as actionable refs.
    expect(r.stdout).toContain('Furnaces');
    expect(r.stdout).toContain('Air Conditioners');
    expect(r.stdout).toContain('Thermostats');
    // And the page is flagged as shadow-dom (media-rich warning)
    expect(r.stdout).toContain('shadow-dom');
  }, 60000);

  it('clicking the Furnaces filter hides all product cards (bug)', () => {
    // Click the Furnaces filter button (inside the shadow root)
    const r = runCairn(['goto', 'click the Furnaces filter button'], session);
    expect(r.exitCode).toBe(0);
    // The buggy handler hides every card (never matches the category).
    // After the click, re-look — product cards should now be hidden.
    const look = runCairn(['look'], session);
    // The product names should no longer be visible (all display:none)
    expect(look.stdout).not.toContain('ArcticPro X Furnace');
  }, 60000);
});

// ─── Bug #7: Services tabs show wrong content ───────────────────

describe('HVAC #7 — services tabs miswired', () => {
  const session = 'hvac-7';
  const url = fileUrl(path.join(DEMO, 'services.html'));

  afterAll(() => releaseSession(session));

  it('navigates to the services page', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Installation');
    expect(r.stdout).toContain('Repair');
  }, 60000);

  it('clicking Repair shows Installation content (miswired)', () => {
    const r = runCairn(['goto', 'click the Repair tab button'], session);
    expect(r.exitCode).toBe(0);
    // The wrongMap swaps installation↔repair, so clicking "Repair" shows
    // the "Installation" panel content ("Furnace & AC Installation").
    const look = runCairn(['look'], session);
    expect(look.stdout).toContain('Furnace & AC Installation');
  }, 60000);
});

// ─── Bug #8: "Schedule Service" button clears form ─────────────

describe('HVAC #8 — Schedule button clears form', () => {
  const session = 'hvac-8';
  const url = fileUrl(path.join(DEMO, 'contact.html'));

  afterAll(() => releaseSession(session));

  it('navigates to the contact page', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
  }, 60000);

  it('filling the form + clicking Schedule clears it', () => {
    // Fill the name field first (so the reset is observable)
    const type = runCairn(['goto', 'type Test User into the Full Name field'], session);
    expect(type.exitCode).toBe(0);
    // Click "Schedule Service" — the buggy handler calls form.reset()
    const click = runCairn(['goto', 'click the Schedule Service button'], session);
    expect(click.exitCode).toBe(0);
    // The status text confirms the form was cleared
    const look = runCairn(['look'], session);
    expect(look.stdout).toContain('Form cleared');
  }, 60000);
});

// ─── Bug #9: ZIP service-area off-by-one ────────────────────────

describe('HVAC #9 — ZIP off-by-one (14999 rejected)', () => {
  const session = 'hvac-9';
  const url = fileUrl(path.join(DEMO, 'quote.html'));

  afterAll(() => releaseSession(session));

  it('navigates to the quote page', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('ZIP');
  }, 60000);

  it('ZIP 14999 is rejected as outside the service area (bug)', () => {
    // Type 14999 into the ZIP field (the boundary value)
    const type = runCairn(['goto', 'type 14999 into the Your ZIP Code field'], session);
    expect(type.exitCode).toBe(0);
    // Click "Check Service Area"
    const click = runCairn(['goto', 'click the Check Service Area button'], session);
    expect(click.exitCode).toBe(0);
    // The page claims to serve 10000-14999 inclusive, but the JS uses
    // n < 14999 (strict), so 14999 is wrongly rejected.
    const look = runCairn(['look'], session);
    expect(look.stdout).toContain('outside our service area');
  }, 60000);
});
