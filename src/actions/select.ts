/**
 * Select Action — select an option in a dropdown by stable ref.
 *
 * Resolves ref → live element via data-cairn-ref attribute → Playwright selectOption.
 * Works on native <select> elements. The value can be the option's value,
 * label (visible text), or index.
 *
 * DESIGN.md §4.5: the agent never outputs coordinates. Select is a one-line
 * Playwright call behind a ref.
 */

import type { Page } from 'playwright';

export interface SelectResult {
  success: boolean;
  message: string;
  ref: string;
}

export async function selectByRef(page: Page, ref: string, value: string): Promise<SelectResult> {
  const locator = page.locator(`[data-cairn-ref="${ref}"]`);

  try {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return {
      success: false,
      message: `ref ${ref} not found or not visible. Run "cairn look" to see current refs, or "cairn look --visual" for a marked screenshot.`,
      ref,
    };
  }

  // Check if it's a native <select> — selectOption only works on those
  const tag = await locator.evaluate((el: HTMLElement) => el.tagName.toLowerCase()).catch(() => '');

  if (tag !== 'select') {
    // Could be a custom dropdown (div-based combobox). Try finding a child <select>.
    const childSelect = locator.locator('select').first();
    const hasChild = await childSelect.count().catch(() => 0);
    if (hasChild > 0) {
      return selectNative(page, ref, value, childSelect);
    }
    return {
      success: false,
      message: `ref ${ref} is a ${tag || 'unknown'}, not a <select> dropdown. For custom dropdowns, use "cairn click ${ref}" to open it, then "cairn click <option-ref>" to select.`,
      ref,
    };
  }

  return selectNative(page, ref, value, locator);
}

/** Select an option on a native <select> element, trying value/label/index. */
async function selectNative(
  _page: Page,
  ref: string,
  value: string,
  selectLocator: ReturnType<import('playwright').Page['locator']>,
): Promise<SelectResult> {
  const info = await selectLocator.evaluate((el: HTMLSelectElement) => ({
    name: el.getAttribute('aria-label') || el.getAttribute('title') || '',
    optionCount: el.options.length,
    options: Array.from(el.options).slice(0, 10).map((o) => ({
      value: o.value,
      label: o.textContent?.trim() || '',
    })),
  })).catch(() => ({ name: '', optionCount: 0, options: [] as { value: string; label: string }[] }));

  // Try selecting by value first, then by label, then by index
  let selected = false;
  let matchType = '';

  // 1. By value (exact match)
  try {
    await selectLocator.selectOption({ value });
    selected = true;
    matchType = 'value';
  } catch {
    // Not a value match — try label
  }

  // 2. By label (visible text)
  if (!selected) {
    try {
      await selectLocator.selectOption({ label: value });
      selected = true;
      matchType = 'label';
    } catch {
      // Not a label match — try index
    }
  }

  // 3. By index (if value is a number)
  if (!selected && /^\d+$/.test(value)) {
    const idx = parseInt(value, 10);
    if (idx < info.optionCount) {
      try {
        await selectLocator.selectOption({ index: idx });
        selected = true;
        matchType = `index ${idx}`;
      } catch {
        // Index match failed
      }
    }
  }

  if (!selected) {
    const available = info.options.length > 0
      ? `\nAvailable options: ${info.options.map((o) => `"${o.value}"` + (o.label && o.label !== o.value ? ` ("${o.label}")` : '')).join(', ')}`
      : `\n(${info.optionCount} options available)`;
    return {
      success: false,
      message: `could not select "${value}" in [${ref}]${info.name ? ` "${info.name}"` : ''} — no matching option by value, label, or index.${available}`,
      ref,
    };
  }

  // Read back the selected value for confirmation
  const selectedValue = await selectLocator.evaluate((el: HTMLSelectElement) => {
    const opt = el.options[el.selectedIndex];
    return opt ? { value: opt.value, label: opt.textContent?.trim() || '' } : null;
  }).catch(() => null);

  const selectedDesc = selectedValue
    ? selectedValue.value === value
      ? `"${value}"`
      : `"${selectedValue.label || selectedValue.value}" (matched by ${matchType})`
    : `"${value}" (by ${matchType})`;

  return {
    success: true,
    message: `selected ${selectedDesc} in [${ref}]${info.name ? ` ${info.name}` : ''}`,
    ref,
  };
}
