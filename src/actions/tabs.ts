/**
 * Tab Management — list, switch, close, and open browser tabs.
 *
 * PRODUCTION.md §3 item 6: "Tabs + iframes. Add tab commands
 * (list/switch/close/new). Popups and embedded forms are common."
 *
 * Uses Playwright's BrowserContext API:
 *   - context.pages() → all open tabs
 *   - page.bringToFront() → activate a tab
 *   - page.close() → close a tab
 *   - context.newPage() → open a new tab
 *
 * Tab indices are 1-based for user/agent friendliness (matching how
 * they're displayed in `cairn tab list`).
 */

import type { Page } from 'playwright';

export interface TabInfo {
  index: number;      // 1-based index
  url: string;
  title: string;
  active: boolean;    // true if this is the currently focused tab
}

export interface TabResult {
  success: boolean;
  message: string;
  tab?: TabInfo;
}

// ─── List tabs ──────────────────────────────────────────────────

/** List all open tabs with their URLs, titles, and active status. */
export async function listTabs(page: Page): Promise<TabInfo[]> {
  const context = page.context();
  const pages = context.pages();
  const currentUrl = page.url();

  return pages.map((p, i) => ({
    index: i + 1,
    url: p.url(),
    title: '', // title may not be available synchronously; fill below
    active: p === page || p.url() === currentUrl,
  }));
}

/** Format tabs for display (used by CLI and for testing). */
export function formatTabs(tabs: TabInfo[]): string {
  if (tabs.length === 0) {
    return 'No tabs open.';
  }
  const lines = tabs.map((t) => {
    const marker = t.active ? '→' : ' ';
    const title = t.title ? ` | ${t.title}` : '';
    return `${marker} [${t.index}] ${t.url}${title}`;
  });
  return `Tabs (${tabs.length}):\n${lines.join('\n')}`;
}

// ─── Switch tab ─────────────────────────────────────────────────

/**
 * Switch to a tab by 1-based index or URL substring.
 * Returns the TabInfo of the newly active tab.
 */
export async function switchTab(page: Page, target: string): Promise<TabResult> {
  const context = page.context();
  const pages = context.pages();

  // Try numeric index first (1-based)
  const numIdx = parseInt(target, 10);
  if (!isNaN(numIdx) && numIdx >= 1 && numIdx <= pages.length) {
    const targetPage = pages[numIdx - 1];
    await targetPage.bringToFront();
    const info: TabInfo = {
      index: numIdx,
      url: targetPage.url(),
      title: '',
      active: true,
    };
    return {
      success: true,
      message: `switched to tab ${numIdx}: ${targetPage.url()}`,
      tab: info,
    };
  }

  // Try URL substring match
  const lowerTarget = target.toLowerCase();
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].url().toLowerCase().includes(lowerTarget)) {
      await pages[i].bringToFront();
      const info: TabInfo = {
        index: i + 1,
        url: pages[i].url(),
        title: '',
        active: true,
      };
      return {
        success: true,
        message: `switched to tab ${i + 1}: ${pages[i].url()}`,
        tab: info,
      };
    }
  }

  return {
    success: false,
    message: `no tab matching "${target}" found. Run "cairn tab list" to see open tabs.`,
  };
}

// ─── Close tab ──────────────────────────────────────────────────

/**
 * Close a tab by 1-based index, or close the current tab if no target given.
 * If closing the current tab, switches to the first remaining tab.
 */
export async function closeTab(page: Page, target?: string): Promise<TabResult> {
  const context = page.context();
  const pages = context.pages();

  let targetPage: Page | null = null;
  let closedIndex = -1;

  if (target) {
    // Try numeric index
    const numIdx = parseInt(target, 10);
    if (!isNaN(numIdx) && numIdx >= 1 && numIdx <= pages.length) {
      targetPage = pages[numIdx - 1];
      closedIndex = numIdx;
    } else {
      // Try URL substring
      const lowerTarget = target.toLowerCase();
      for (let i = 0; i < pages.length; i++) {
        if (pages[i].url().toLowerCase().includes(lowerTarget)) {
          targetPage = pages[i];
          closedIndex = i + 1;
          break;
        }
      }
    }
  } else {
    // Close current tab
    targetPage = page;
    closedIndex = pages.indexOf(page) + 1;
  }

  if (!targetPage || closedIndex < 1) {
    return {
      success: false,
      message: target
        ? `no tab matching "${target}" found.`
        : 'no current tab to close.',
    };
  }

  // Don't close the last tab — browsers keep at least one open
  if (pages.length <= 1) {
    return {
      success: false,
      message: 'cannot close the last remaining tab (the browser requires at least one).',
    };
  }

  const closedUrl = targetPage.url();
  await targetPage.close();

  // If we closed the active tab, switch to the first remaining
  if (targetPage === page) {
    const remaining = context.pages();
    if (remaining.length > 0) {
      await remaining[0].bringToFront();
    }
  }

  return {
    success: true,
    message: `closed tab ${closedIndex}: ${closedUrl}`,
  };
}

// ─── New tab ────────────────────────────────────────────────────

/** Open a new tab, optionally navigating to a URL. */
export async function newTab(page: Page, url?: string): Promise<TabResult> {
  const context = page.context();
  const newPage = await context.newPage();

  if (url) {
    // Validate URL — prepend https:// if no scheme
    const fullUrl = url.startsWith('http://') || url.startsWith('https://')
      ? url
      : `https://${url}`;
    await newPage.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {
      // Navigation may fail (timeout, network error) — tab still open
    });
  }

  await newPage.bringToFront();

  const info: TabInfo = {
    index: context.pages().length, // 1-based: this is the new last tab
    url: newPage.url(),
    title: '',
    active: true,
  };

  return {
    success: true,
    message: url
      ? `opened new tab ${info.index}: ${newPage.url()}`
      : `opened new tab ${info.index} (about:blank)`,
    tab: info,
  };
}
