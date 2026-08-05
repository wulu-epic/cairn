/**
 * Dialog Handling — auto-accept or auto-dismiss JS dialogs.
 *
 * PRODUCTION.md §3 item 8: "Wire page.on('dialog'), setInputFiles,
 * download events, and storageState persistence."
 *
 * JavaScript dialogs (alert, confirm, prompt, beforeunload) block the
 * page and can hang an agent's command. This module sets up an auto-handler
 * on page.on('dialog') that accepts or dismisses based on configuration.
 *
 * The handler is set once per session. The agent can reconfigure it at any
 * time with a new `cairn dialog <accept|dismiss> [text]` command.
 */

import type { Page, Dialog } from 'playwright';

export type DialogAction = 'accept' | 'dismiss';

export interface DialogConfig {
  action: DialogAction;      // accept or dismiss
  promptText?: string;       // text to enter in prompt() dialogs
}

export interface DialogResult {
  success: boolean;
  message: string;
}

// Track the current dialog config per page (module-level, since Playwright
// doesn't expose the handler once set). This lets us report the current state.
const pageDialogConfigs = new WeakMap<Page, DialogConfig>();

/**
 * Install (or replace) the dialog auto-handler on the page.
 * Subsequent JS dialogs will be auto-accepted or auto-dismissed.
 */
export function setDialogHandler(page: Page, config: DialogConfig): DialogResult {
  // Remove previous handler by removing all listeners on 'dialog'
  // Playwright doesn't have removeAllListeners for specific events directly,
  // but page.on('dialog') replaces the default behavior.
  page.on('dialog', async (dialog: Dialog) => {
    const cfg = pageDialogConfigs.get(page) ?? { action: 'accept' };
    try {
      if (dialog.type() === 'prompt' && cfg.promptText !== undefined) {
        await dialog.accept(cfg.promptText);
      } else if (cfg.action === 'accept') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    } catch {
      // Dialog may have been auto-dismissed already (race condition)
    }
  });

  pageDialogConfigs.set(page, config);

  const action = config.action;
  const promptInfo = config.promptText ? ` (prompt text: "${config.promptText}")` : '';
  return {
    success: true,
    message: `dialog auto-handler set to ${action}${promptInfo}`,
  };
}

/** Get the current dialog config for a page (if set). */
export function getDialogConfig(page: Page): DialogConfig | null {
  return pageDialogConfigs.get(page) ?? null;
}

/**
 * Decide how to handle a dialog based on a user/agent input string.
 * Pure function — testable without a browser.
 *
 * "accept" → { action: 'accept' }
 * "dismiss" → { action: 'dismiss' }
 * "accept hello" → { action: 'accept', promptText: 'hello' }
 * "dismiss" → { action: 'dismiss' }
 */
export function parseDialogConfig(input: string): DialogConfig {
  const parts = input.trim().split(/\s+/);
  const action = parts[0]?.toLowerCase() === 'dismiss' ? 'dismiss' : 'accept';
  const promptText = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
  return { action, promptText };
}
