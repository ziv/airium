import { describe, expect, it } from 'vitest';
import { loadConfig, resolveIonToken } from './config';

describe('resolveIonToken', () => {
  it('returns null when the variable is undefined', () => {
    expect(resolveIonToken(undefined)).toBeNull();
  });

  it('returns null for empty or whitespace-only values', () => {
    expect(resolveIonToken('')).toBeNull();
    expect(resolveIonToken('   ')).toBeNull();
  });

  it('trims and returns a real token', () => {
    expect(resolveIonToken('  abc.def  ')).toBe('abc.def');
  });
});

describe('loadConfig', () => {
  it('produces a token-free config when nothing is set', () => {
    expect(loadConfig({})).toEqual({ ionToken: null });
  });

  it('carries the Ion token through', () => {
    expect(loadConfig({ VITE_CESIUM_ION_TOKEN: 'tok' })).toEqual({ ionToken: 'tok' });
  });
});
