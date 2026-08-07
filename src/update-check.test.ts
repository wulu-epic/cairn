import { describe, it, expect } from 'vitest';
import { isNewerVersion } from './update-check.js';

describe('isNewerVersion', () => {
  it('returns true when latest has a higher patch version', () => {
    expect(isNewerVersion('0.1.1', '0.1.2')).toBe(true);
  });

  it('returns true when latest has a higher minor version', () => {
    expect(isNewerVersion('0.1.5', '0.2.0')).toBe(true);
  });

  it('returns true when latest has a higher major version', () => {
    expect(isNewerVersion('1.5.3', '2.0.0')).toBe(true);
  });

  it('returns false when versions are equal', () => {
    expect(isNewerVersion('0.1.1', '0.1.1')).toBe(false);
  });

  it('returns false when current is newer than latest', () => {
    expect(isNewerVersion('0.2.0', '0.1.1')).toBe(false);
  });

  it('handles missing patch segments gracefully', () => {
    expect(isNewerVersion('0.1', '0.1.1')).toBe(true);
    expect(isNewerVersion('1', '2')).toBe(true);
  });

  it('handles non-numeric segments without crashing', () => {
    expect(isNewerVersion('0.1.1', '0.1.2')).toBe(true);
  });

  it('returns false when latest is lower across multiple segments', () => {
    expect(isNewerVersion('1.2.3', '1.2.2')).toBe(false);
    expect(isNewerVersion('1.2.3', '1.1.9')).toBe(false);
    expect(isNewerVersion('1.2.3', '0.9.9')).toBe(false);
  });
});
