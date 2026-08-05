/**
 * E2E CLI Tests — drive the full Cairn CLI (npx tsx src/cli.ts) against
 * local HTML fixtures to verify the integrated perceive→ground→act→verify loop.
 *
 * Fixtures (tests/fixtures/):
 *   - login.html: standard form with email/password/submit (native interactivity)
 *   - div-button.html: div with onclick + cursor:pointer (inferred interactivity)
 *   - dialog-search.html: search field hidden behind a link→dialog (click-to-reveal)
 *
 * Each test runs the CLI as a child process with a unique --session ID so
 * browser sessions don't interfere. Chrome is launched on first use and
 * persists (detached) across commands in the same session.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const FIXTURES = path.join(__dirname, 'fixtures');

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

// ─── Login form (native interactivity) ────────────────────────

describe('E2E — login fixture', () => {
  const session = 'e2e-login';
  const url = fileUrl(path.join(FIXTURES, 'login.html'));

  afterAll(() => releaseSession(session));

  it('navigates to the login page via goto <url>', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Login');
  }, 60000);

  it('look shows the interactive form elements', () => {
    const r = runCairn(['look'], session);
    expect(r.exitCode).toBe(0);
    // Should list the email input, password input, and sign-in button
    expect(r.stdout).toContain('Sign In');
    expect(r.stdout).toContain('Email');
  }, 30000);

  it('look -i shows only interactive elements (compact)', () => {
    const r = runCairn(['look', '-i'], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Sign In');
  }, 30000);

  it('goto "type ... into the email field" fills the input', () => {
    const r = runCairn(['goto', 'type test@example.com into the email field'], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('✓');
  }, 45000);
});

// ─── Div-as-button (inferred interactivity) ───────────────────

describe('E2E — div-as-button fixture', () => {
  const session = 'e2e-div';
  const url = fileUrl(path.join(FIXTURES, 'div-button.html'));

  afterAll(() => releaseSession(session));

  it('navigates to the div-button page', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
  }, 60000);

  it('look detects the div as interactive (inferred from cursor:pointer + onclick)', () => {
    const r = runCairn(['look'], session);
    expect(r.exitCode).toBe(0);
    // The div with "Click Me" text should appear with a ref (inferred interactive)
    expect(r.stdout).toContain('Click Me');
  }, 30000);
});

// ─── Dialog search (click-to-reveal) ──────────────────────────

describe('E2E — dialog-search fixture', () => {
  const session = 'e2e-dialog';
  const url = fileUrl(path.join(FIXTURES, 'dialog-search.html'));

  afterAll(() => releaseSession(session));

  it('navigates to the dialog-search page', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
  }, 60000);

  it('goto "type hello into the search field" uses click-to-reveal', () => {
    const r = runCairn(['goto', 'type hello into the search field'], session);
    // click-to-reveal should open the dialog and type — expect success
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('✓');
  }, 45000);
});
