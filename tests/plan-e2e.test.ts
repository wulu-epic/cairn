/**
 * E2E CLI Tests for Leap 1 (NL-to-Plan Compilation) — drive the full Cairn
 * CLI (npx tsx src/cli.ts) against the login fixture to verify the
 * compile → execute → save → run → delete lifecycle.
 *
 * Tests against tests/fixtures/login.html:
 *   - compile a 3-step compound goal and verify all steps succeed
 *   - plans lists the saved plan
 *   - plan <id> shows step details (kinds, invariants)
 *   - run <plan-id> re-executes deterministically
 *   - plan delete <id> removes it
 *
 * Each test runs the CLI as a child process with a unique --session ID.
 * Tests are ordered: the plan ID is extracted from the compile output and
 * reused in subsequent tests (vitest runs describe blocks sequentially).
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

// ─── Plan compile + run lifecycle ──────────────────────────────

describe('E2E — plan compile + run (Leap 1)', () => {
  const session = 'plan-e2e';
  const url = fileUrl(path.join(FIXTURES, 'login.html'));
  // 3-step compound goal: type email, type password, click sign in
  const goal = 'type test@example.com into the email field, then type secret123 into the password field, then click the sign in button';
  let planId = '';

  afterAll(() => {
    // Clean up the plan if it wasn't deleted by a test
    if (planId) {
      try {
        runCairn(['plan', 'delete', planId], session, 10000);
      } catch {
        // ignore
      }
    }
    releaseSession(session);
  });

  it('navigates to the login page', () => {
    const r = runCairn(['goto', url], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Login');
  }, 60000);

  it('compile executes a 3-step compound goal and saves the plan', () => {
    const r = runCairn(['compile', goal], session, 120000);
    expect(r.exitCode).toBe(0);
    // Should report success with all 3 steps
    expect(r.stdout).toContain('✓');
    expect(r.stdout).toContain('3/3');
    // Should save the plan and report the ID
    expect(r.stdout).toContain('saved plan:');
    expect(r.stdout).toContain('replay with: cairn run');
    // Extract the plan ID for subsequent tests
    const match = r.stdout.match(/saved plan: (\S+)/);
    expect(match).not.toBeNull();
    planId = match![1];
    expect(planId.length).toBeGreaterThan(0);
  }, 120000);

  it('plans lists the saved plan', () => {
    const r = runCairn(['plans'], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Saved plans');
    expect(r.stdout).toContain(planId);
  }, 30000);

  it('plan <id> shows step details with kinds and invariants', () => {
    const r = runCairn(['plan', planId], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Plan:');
    expect(r.stdout).toContain(`Steps: 3`);
    // Each step should show its intent kind
    expect(r.stdout).toContain('[type]');
    expect(r.stdout).toContain('[click]');
    // Steps should show their goal sub-clauses
    expect(r.stdout).toContain('email field');
    expect(r.stdout).toContain('password field');
    expect(r.stdout).toContain('sign in');
  }, 30000);

  it('run <plan-id> re-executes the plan deterministically', () => {
    // Navigate back to the login page for a fresh form
    const nav = runCairn(['goto', url], session);
    expect(nav.exitCode).toBe(0);

    // Re-run the saved plan
    const r = runCairn(['run', planId], session, 120000);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('✓');
    expect(r.stdout).toContain('3/3');
  }, 120000);

  it('plan delete <id> removes the plan', () => {
    const r = runCairn(['plan', 'delete', planId], session);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('✓ deleted plan');
    // Verify it's gone from the list
    const list = runCairn(['plans'], session);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).not.toContain(planId);
  }, 30000);
});
