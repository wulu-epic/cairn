import { describe, it, expect } from 'vitest';
import { parseDialogConfig } from './dialog.js';
import { resolvePath, getDownloadDir } from './files.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ─── parseDialogConfig ─────────────────────────────────────────

describe('parseDialogConfig', () => {
  it('parses "accept" → { action: "accept" }', () => {
    const config = parseDialogConfig('accept');
    expect(config.action).toBe('accept');
    expect(config.promptText).toBeUndefined();
  });

  it('parses "dismiss" → { action: "dismiss" }', () => {
    const config = parseDialogConfig('dismiss');
    expect(config.action).toBe('dismiss');
  });

  it('parses "accept hello world" with prompt text', () => {
    const config = parseDialogConfig('accept hello world');
    expect(config.action).toBe('accept');
    expect(config.promptText).toBe('hello world');
  });

  it('defaults to accept for unknown action', () => {
    const config = parseDialogConfig('foo bar');
    expect(config.action).toBe('accept');
    expect(config.promptText).toBe('bar');
  });

  it('handles empty input (defaults to accept)', () => {
    const config = parseDialogConfig('');
    expect(config.action).toBe('accept');
    expect(config.promptText).toBeUndefined();
  });

  it('handles "DISMISS" (case-insensitive)', () => {
    const config = parseDialogConfig('DISMISS');
    expect(config.action).toBe('dismiss');
  });
});

// ─── resolvePath ───────────────────────────────────────────────

describe('resolvePath', () => {
  it('resolves relative paths to absolute', () => {
    const result = resolvePath('test.txt');
    expect(result).toContain('test.txt');
    // Absolute path check (platform-agnostic): resolves to full path
    expect(result).not.toBe('test.txt');
  });

  it('expands ~ to home directory', () => {
    const result = resolvePath('~/documents/file.txt');
    expect(result).toContain(homedir());
    expect(result).toMatch(/documents[\\/]file\.txt$/);
  });

  it('leaves absolute paths unchanged (resolved)', () => {
    const abs = join(homedir(), 'file.txt');
    const result = resolvePath(abs);
    expect(result).toBe(abs);
  });
});

// ─── getDownloadDir ──────────────────────────────────────────

describe('getDownloadDir', () => {
  it('returns .sessions/downloads without sessionId', () => {
    const dir = getDownloadDir();
    expect(dir).toContain('.sessions');
    expect(dir).toContain('downloads');
  });

  it('includes sessionId in path when provided', () => {
    const dir = getDownloadDir('sess-123');
    expect(dir).toContain('.sessions');
    expect(dir).toContain('sess-123');
    expect(dir).toContain('downloads');
  });

  it('produces nested path sessionId/downloads', () => {
    const dir = getDownloadDir('abc');
    expect(dir).toMatch(/\.sessions[\\/]abc[\\/]downloads/);
  });
});
