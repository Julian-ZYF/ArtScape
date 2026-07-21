import { describe, expect, it } from 'vitest';
import { evaluateArtScapeToolPolicy } from './tool-policy';

const context = (sideEffectLevel?: 'none' | 'read' | 'write' | 'external_effect' | 'irreversible') => ({
  runId: 'run-1',
  sideEffectLevel,
});

describe('ArtScape tool policy', () => {
  it('allows governed deterministic reads and audited writes', () => {
    expect(evaluateArtScapeToolPolicy(context('none')).allowed).toBe(true);
    expect(evaluateArtScapeToolPolicy(context('read')).allowed).toBe(true);
    expect(evaluateArtScapeToolPolicy(context('write')).allowed).toBe(true);
  });

  it('denies external, irreversible, and unsupported effects', () => {
    expect(evaluateArtScapeToolPolicy(context('external_effect')).allowed).toBe(false);
    expect(evaluateArtScapeToolPolicy(context('irreversible')).allowed).toBe(false);
    expect(evaluateArtScapeToolPolicy(context()).allowed).toBe(false);
  });
});

