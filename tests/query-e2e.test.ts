/**
 * E2E CLI Tests for Leap 4 (Page Model as Query) — drive the full Cairn
 * CLI (npx tsx src/cli.ts) against the login fixture to verify the query
 * command's match, primary-action, form-fields, and diff query types.
 *
 * Tests against tests/fixtures/login.html:
 *   - query "sign in" → finds the sign in button by ref (match)
 *   - query "primary action" → returns the submit button (primary-action)
 *   - query "form fields" → lists email + password inputs (form-fields)
 *   - query "what changed" → reports no changes (diff, baseline == current)
 *
 * Each test runs the CLI as a child process with a unique --session ID.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
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
function runCairn(args: string[], sessionId?: string, timeoutMs = 60000): CLIResult {
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

// ─── Query command E2E tests ────────────────────────────────────

describe('E2E — query command (Leap 4)', () => {
  const session = 'query-e2e';
  const url = fileUrl(path.join(FIXTURES, 'login.html'));

  afterAll(() => {
    releaseSession(session);
  });

  it('navigates to the login page and establishes a baseline', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Login');
  }, 60000);

    it('query "sign in" finds the submit button by ref (match)', () => {
    const r = runCairn(['query', 'sign in'], session);
    expect(r.exitCode).toBe(0);
    // Should return a compact one-line answer containing the button + ref
    expect(r.stdout).toContain('button');
    expect(r.stdout).toContain('Sign');
    // Should contain a ref like [eN]
    expect(r.stdout).toMatch(/\[e\d+\]/);
  }, 30000);

  it('query "primary action" returns the submit button (primary-action)', () => {
    const r = runCairn(['query', 'primary action'], session);
    expect(r.exitCode).toBe(0);
    // Should return the sign in / submit button as the primary action
    expect(r.stdout).toContain('button');
    expect(r.stdout).toMatch(/\[e\d+\]/);
    // Should contain "Sign" or "Submit" in the output
    expect(r.stdout.toLowerCase()).toMatch(/sign|submit/);
  }, 30000);

  it('query "form fields" lists email and password inputs (form-fields)', () => {
    const r = runCairn(['query', 'form fields'], session);
    expect(r.exitCode).toBe(0);
    // Should list 2 typeable fields (email + password)
    expect(r.stdout).toContain('2 typeable');
    // Should contain both field names
    expect(r.stdout).toContain('Email');
    expect(r.stdout).toContain('Password');
    // Should contain refs for both
    expect(r.stdout).toMatch(/\[e\d+\].*\[e\d+\]/s);
  }, 30000);

  it('query "what changed" reports no changes (diff, baseline == current)', () => {
    // The goto in the first test saved a model snapshot. Since nothing
    // has changed since then, the diff should report "no changes".
    const r = runCairn(['query', 'what changed'], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toLowerCase()).toContain('no changes');
  }, 30000);

  it('query "email" finds the email input field by text (match)', () => {
    const r = runCairn(['query', 'email'], session);
    expect(r.exitCode).toBe(0);
    // Should find the email textbox
    expect(r.stdout).toContain('textbox');
    expect(r.stdout.toLowerCase()).toContain('email');
    expect(r.stdout).toMatch(/\[e\d+\]/);
  }, 30000);
});
