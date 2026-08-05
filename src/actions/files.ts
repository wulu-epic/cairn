/**
 * File Upload & Download — handle file input and download events.
 *
 * PRODUCTION.md §3 item 8: "Wire page.on('dialog'), setInputFiles,
 * download events, and storageState persistence."
 *
 * Upload: resolves ref → <input type="file"> → Playwright setInputFiles.
 * Download: clicks a ref'd download link, waits for the download event,
 * saves the file to .sessions/<id>/downloads/.
 */

import type { Page, Download } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';

export interface UploadResult {
  success: boolean;
  message: string;
  ref?: string;
}

export interface DownloadResult {
  success: boolean;
  message: string;
  path?: string;
  filename?: string;
}

/**
 * Upload a file to an <input type="file"> element by ref.
 * The ref resolves to the input element (stamped with data-cairn-ref).
 */
export async function uploadFile(page: Page, ref: string, filepath: string): Promise<UploadResult> {
  // Validate the file path exists
  const resolvedPath = resolvePath(filepath);
  if (!existsSync(resolvedPath)) {
    return {
      success: false,
      message: `file not found: ${resolvedPath}`,
      ref,
    };
  }

  const locator = page.locator(`[data-cairn-ref="${ref}"]`);

  try {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return {
      success: false,
      message: `ref ${ref} not found or not visible. Run "cairn look" to see current refs.`,
      ref,
    };
  }

  // Check if it's a file input
  const isFileInput = await locator.evaluate(
    (el: HTMLElement) => el.tagName.toLowerCase() === 'input' && (el as HTMLInputElement).type === 'file',
  ).catch(() => false);

  if (!isFileInput) {
    // Try finding a child file input (the ref might be on a wrapper/label)
    const childInput = locator.locator('input[type="file"]').first();
    const hasChild = await childInput.count().catch(() => 0);
    if (hasChild === 0) {
      return {
        success: false,
        message: `ref ${ref} is not a file input. Use "cairn look" to find an <input type="file"> element.`,
        ref,
      };
    }
    await childInput.setInputFiles(resolvedPath);
    return {
      success: true,
      message: `uploaded ${basename(resolvedPath)} via child input [ref=${ref}]`,
      ref,
    };
  }

  try {
    await locator.setInputFiles(resolvedPath);
  } catch {
    return {
      success: false,
      message: `failed to set input files on ref ${ref} (element may be read-only or obscured).`,
      ref,
    };
  }

  return {
    success: true,
    message: `uploaded ${basename(resolvedPath)} [ref=${ref}]`,
    ref,
  };
}

/**
 * Click a download link and save the downloaded file.
 * Sets up a download event listener, clicks the ref'd element, waits for
 * the download to complete, and saves the file to the downloads directory.
 *
 * @param sessionId - used to determine the save directory (.sessions/<id>/downloads/)
 */
export async function downloadFile(
  page: Page,
  ref: string,
  sessionId?: string,
): Promise<DownloadResult> {
  const locator = page.locator(`[data-cairn-ref="${ref}"]`);

  try {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return {
      success: false,
      message: `ref ${ref} not found or not visible. Run "cairn look" to see current refs.`,
    };
  }

  // Set up download listener BEFORE clicking
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

  try {
    await locator.click();
  } catch {
    return {
      success: false,
      message: `failed to click ref ${ref} (element may be obscured).`,
    };
  }

  let download: Download;
  try {
    download = await downloadPromise;
  } catch {
    return {
      success: false,
      message: `no download triggered by clicking ref ${ref} (the element may not be a download link, or the download timed out).`,
    };
  }

  // Determine save path
  const suggestedFilename = download.suggestedFilename();
  const downloadDir = getDownloadDir(sessionId);
  if (!existsSync(downloadDir)) {
    mkdirSync(downloadDir, { recursive: true });
  }
  const savePath = join(downloadDir, suggestedFilename);

  // Save the downloaded file
  try {
    const stream = await createReadStream(download);
    // Use the download's saveAs method (Playwright API)
    await download.saveAs(savePath);
  } catch {
    return {
      success: false,
      message: `download started but failed to save file: ${suggestedFilename}`,
    };
  }

  return {
    success: true,
    message: `downloaded ${suggestedFilename} → ${savePath}`,
    path: savePath,
    filename: suggestedFilename,
  };
}

// ─── Helpers ───────────────────────────────────────────────────

/** Resolve a file path, handling ~ for home directory. */
export function resolvePath(filepath: string): string {
  if (filepath.startsWith('~')) {
    return resolve(join(homedir(), filepath.slice(1)));
  }
  return resolve(filepath);
}

/** Get the download directory for a session. */
export function getDownloadDir(sessionId?: string): string {
  const base = sessionId
    ? join(process.cwd(), '.sessions', sessionId, 'downloads')
    : join(process.cwd(), '.sessions', 'downloads');
  return base;
}

// Placeholder for stream creation (Playwright's download.saveAs handles this)
async function createReadStream(_download: Download): Promise<void> {
  // This is a no-op — download.saveAs() handles the actual file writing.
  // Kept for potential future use (streaming downloads).
}
