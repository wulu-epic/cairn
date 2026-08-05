import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from './session.js';
import type { AppConfig } from '../config.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_CONFIG: AppConfig = {
  useSteel: false,
  steelApiUrl: 'http://localhost:3000',
  steelApiKey: null,
  proxyUrl: null,
  userAgent: null,
  headless: true,
  timeout: 0,
};

const SESSION_DIR = '.sessions';

describe('SessionManager storage state', () => {
  let session: SessionManager;
  const testSessionId = 'test-storage-session';

  beforeEach(() => {
    session = new SessionManager(testSessionId, TEST_CONFIG);
    // Clean up any existing test files
    const storageFile = path.join(SESSION_DIR, `${testSessionId}.storage.json`);
    if (fs.existsSync(storageFile)) fs.unlinkSync(storageFile);
  });

  afterEach(() => {
    // Clean up test files
    const storageFile = path.join(SESSION_DIR, `${testSessionId}.storage.json`);
    if (fs.existsSync(storageFile)) fs.unlinkSync(storageFile);
    const stateFile = path.join(SESSION_DIR, `${testSessionId}.json`);
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  });

  // ─── storageStateFile getter ──────────────────────────────

  it('storageStateFile returns .sessions/<id>.storage.json', () => {
    const expected = path.join(SESSION_DIR, `${testSessionId}.storage.json`);
    expect(session.storageStateFile).toBe(expected);
  });

  it('storageStateFile differs from stateFile', () => {
    // stateFile is .sessions/<id>.json, storageStateFile is .sessions/<id>.storage.json
    expect(session.storageStateFile).not.toBe(path.join(SESSION_DIR, `${testSessionId}.json`));
    expect(session.storageStateFile).toContain('.storage.json');
  });

  // ─── hasStorageState ──────────────────────────────────────

  it('hasStorageState returns false when no storage file exists', () => {
    expect(session.hasStorageState()).toBe(false);
  });

  it('hasStorageState returns true after file is created', () => {
    // Simulate saving storage state by creating the file
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }
    fs.writeFileSync(
      session.storageStateFile,
      JSON.stringify({ cookies: [], origins: [] }, null, 2),
    );
    expect(session.hasStorageState()).toBe(true);
  });

  it('hasStorageState returns false after file is deleted', () => {
    // Create then delete
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }
    fs.writeFileSync(
      session.storageStateFile,
      JSON.stringify({ cookies: [], origins: [] }, null, 2),
    );
    expect(session.hasStorageState()).toBe(true);

    fs.unlinkSync(session.storageStateFile);
    expect(session.hasStorageState()).toBe(false);
  });

  // ─── different session IDs ────────────────────────────────

  it('different session IDs produce different storage files', () => {
    const sessionA = new SessionManager('session-a', TEST_CONFIG);
    const sessionB = new SessionManager('session-b', TEST_CONFIG);
    expect(sessionA.storageStateFile).not.toBe(sessionB.storageStateFile);
    expect(sessionA.storageStateFile).toContain('session-a.storage.json');
    expect(sessionB.storageStateFile).toContain('session-b.storage.json');

    // Clean up
    const fileA = path.join(SESSION_DIR, 'session-a.storage.json');
    const fileB = path.join(SESSION_DIR, 'session-b.storage.json');
    if (fs.existsSync(fileA)) fs.unlinkSync(fileA);
    if (fs.existsSync(fileB)) fs.unlinkSync(fileB);
  });
});
