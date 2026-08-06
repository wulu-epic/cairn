import { describe, it, expect } from 'vitest';
import { formatOcclusion } from './click.js';
import type { OcclusionInfo } from './click.js';

/** Build a minimal OcclusionInfo with sensible defaults. */
function makeOcc(overrides: Partial<OcclusionInfo> = {}): OcclusionInfo {
  return {
    occluderTag: 'header',
    occluderClasses: [],
    ...overrides,
  };
}

// ─── formatOcclusion ───────────────────────────────────────────

describe('formatOcclusion', () => {
  it('shows occluder tag in angle brackets', () => {
    const out = formatOcclusion('e15', makeOcc({ occluderTag: 'header' }));
    expect(out).toContain('<header>');
    expect(out).toContain('ref e15');
  });

  it('includes classes as dot-notation', () => {
    const out = formatOcclusion('e15', makeOcc({ occluderClasses: ['site-header', 'sticky'] }));
    expect(out).toContain('<header.site-header.sticky>');
  });

  it('omits class dot when no classes', () => {
    const out = formatOcclusion('e15', makeOcc({ occluderClasses: [] }));
    expect(out).toContain('<header>');
    expect(out).not.toContain('<header.');
  });

  it('includes occluder ref when present', () => {
    const out = formatOcclusion('e15', makeOcc({ occluderRef: 'e3' }));
    expect(out).toContain('(ref e3)');
  });

  it('omits ref when absent', () => {
    const out = formatOcclusion('e15', makeOcc({ occluderRef: undefined }));
    expect(out).not.toContain('(ref');
  });

  it('includes occluder role when present', () => {
    const out = formatOcclusion('e15', makeOcc({ occluderRole: 'banner' }));
    expect(out).toContain('[banner]');
  });

  it('omits role when absent', () => {
    const out = formatOcclusion('e15', makeOcc({ occluderRole: undefined }));
    expect(out).not.toContain('[banner]');
  });

  it('includes guidance to close/dismiss', () => {
    const out = formatOcclusion('e15', makeOcc());
    expect(out).toContain('close/dismiss');
  });

  it('formats a full diagnostic with all fields', () => {
    const out = formatOcclusion('e9', makeOcc({
      occluderTag: 'div',
      occluderClasses: ['modal-backdrop', 'fade'],
      occluderRef: 'e2',
      occluderRole: 'dialog',
    }));
    expect(out).toContain('ref e9 is occluded by');
    expect(out).toContain('<div.modal-backdrop.fade>');
    expect(out).toContain('[dialog]');
    expect(out).toContain('(ref e2)');
  });
});
