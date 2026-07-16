import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../src/lib/theme';

describe('resolveTheme — stored × system 四象限', () => {
  it('follows system (dark) when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark');
  });

  it('follows system (light) when nothing is stored', () => {
    expect(resolveTheme(null, false)).toBe('light');
  });

  it('stored choice overrides system: light beats dark system', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('stored choice overrides system: dark beats light system', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('ignores corrupt stored values and falls back to system', () => {
    expect(resolveTheme('neon', true)).toBe('dark');
    expect(resolveTheme('', false)).toBe('light');
  });
});
