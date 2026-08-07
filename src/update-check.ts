/**
 * Update check — non-blocking npm registry version comparison.
 *
 * On each launch, checks if a newer version of cairn-browser is published.
 * Hits the npm registry at most once per day (cached in the OS data dir).
 * Prints a one-line stderr message if an update is available — never blocks
 * the actual command, never pollutes stdout.
 *
 * Opt out: CAIRN_NO_UPDATE_CHECK=1 env var.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDataDir } from './intent/recorder.js';

const CACHE_FILE = path.join(getDataDir(), 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTRY_URL = 'https://registry.npmjs.org/cairn-browser/latest';

interface UpdateCache {
  lastChecked: number;
  latestVersion: string;
}

/**
 * Compare two semver strings (major.minor.patch).
 * Returns true if `latest` is newer than `current`.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) => {
    const parts = v.split('.');
    return [parts[0], parts[1], parts[2]].map((n) => parseInt(n ?? '0', 10) || 0);
  };
  const [c1, c2, c3] = parse(current);
  const [l1, l2, l3] = parse(latest);
  if (l1 !== c1) return l1 > c1;
  if (l2 !== c2) return l2 > c2;
  return l3 > c3;
}

/** Read the cached check result. Returns null if missing or invalid. */
function readCache(): UpdateCache | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as UpdateCache;
    if (typeof parsed.lastChecked === 'number' && typeof parsed.latestVersion === 'string') {
      return parsed;
    }
  } catch {
    // File doesn't exist or is corrupt — that's fine
  }
  return null;
}

/** Write the cache to disk. Silently ignores write errors. */
function writeCache(cache: UpdateCache): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf-8');
  } catch {
    // Non-critical — don't let filesystem errors break the CLI
  }
}

/**
 * Check for an update. Non-blocking: resolves quickly, never throws.
 * Prints to stderr if a newer version is available.
 */
export async function checkForUpdate(currentVersion: string): Promise<void> {
  // Opt-out via env var
  if (process.env.CAIRN_NO_UPDATE_CHECK) return;

  const now = Date.now();
  const cached = readCache();

  // Use cached result if checked within the last 24h
  if (cached && now - cached.lastChecked < CHECK_INTERVAL_MS) {
    if (isNewerVersion(currentVersion, cached.latestVersion)) {
      process.stderr.write(
        `Update available: ${currentVersion} → ${cached.latestVersion}  Run: npm update -g cairn-browser\n`,
      );
    }
    return;
  }

  // Fetch latest version from npm registry
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    const latest = data.version;
    if (!latest) return;

    writeCache({ lastChecked: now, latestVersion: latest });

    if (isNewerVersion(currentVersion, latest)) {
      process.stderr.write(
        `Update available: ${currentVersion} → ${latest}  Run: npm update -g cairn-browser\n`,
      );
    }
  } catch {
    // Network error, timeout, or parse failure — silently skip
  }
}
