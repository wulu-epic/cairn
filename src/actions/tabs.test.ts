import { describe, it, expect } from 'vitest';
import { formatTabs, type TabInfo } from './tabs.js';

// ─── formatTabs ────────────────────────────────────────────────

describe('formatTabs', () => {
  it('formats a list of tabs with active marker', () => {
    const tabs: TabInfo[] = [
      { index: 1, url: 'https://example.com', title: '', active: true },
      { index: 2, url: 'https://google.com', title: '', active: false },
      { index: 3, url: 'https://github.com', title: '', active: false },
    ];
    const output = formatTabs(tabs);
    expect(output).toContain('Tabs (3):');
    expect(output).toContain('→ [1] https://example.com');
    expect(output).toContain('  [2] https://google.com');
    expect(output).toContain('  [3] https://github.com');
  });

  it('includes title when present', () => {
    const tabs: TabInfo[] = [
      { index: 1, url: 'https://example.com', title: 'Example Domain', active: true },
    ];
    const output = formatTabs(tabs);
    expect(output).toContain('Example Domain');
  });

  it('shows "No tabs open" for empty list', () => {
    expect(formatTabs([])).toBe('No tabs open.');
  });

  it('marks only the active tab with arrow', () => {
    const tabs: TabInfo[] = [
      { index: 1, url: 'https://a.com', title: '', active: false },
      { index: 2, url: 'https://b.com', title: '', active: true },
      { index: 3, url: 'https://c.com', title: '', active: false },
    ];
    const output = formatTabs(tabs);
    const lines = output.split('\n').slice(1); // skip "Tabs (3):"
    expect(lines[0]).toMatch(/^\s\s\[/);   // not active → no arrow
    expect(lines[1]).toMatch(/^→\s\[/);    // active → arrow
    expect(lines[2]).toMatch(/^\s\s\[/);   // not active → no arrow
  });

  it('handles single tab', () => {
    const tabs: TabInfo[] = [
      { index: 1, url: 'about:blank', title: '', active: true },
    ];
    const output = formatTabs(tabs);
    expect(output).toContain('Tabs (1):');
    expect(output).toContain('→ [1] about:blank');
  });
});
