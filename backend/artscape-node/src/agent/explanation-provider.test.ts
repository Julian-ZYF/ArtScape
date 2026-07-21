import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeterministicExplanationProvider,
  OpenAIExplanationProvider,
  type ExplanationInput,
} from './explanation-provider';

const input: ExplanationInput = {
  scenarios: [],
  riskMetrics: {
    maxArtistConcentration: '0.5',
    maxArtistName: '艺术家甲',
    lowLiquidityRatio: '0.4',
    completenessRatio: '0.8',
    bearLossRate: '0.35',
  },
  breaches: [
    {
      code: 'artist_concentration',
      actual: '0.5',
      threshold: '0.4',
      severity: 'high',
      message: 'concentration',
    },
    {
      code: 'low_liquidity',
      actual: '0.4',
      threshold: '0.3',
      severity: 'warning',
      message: 'liquidity',
    },
    {
      code: 'bear_loss',
      actual: '0.35',
      threshold: '0.3',
      severity: 'high',
      message: 'bear',
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('explanation providers', () => {
  it('produces a deterministic non-pricing fallback', async () => {
    const result = await new DeterministicExplanationProvider().explain(input);
    expect(result.fallback).toBe(true);
    expect(result.observations).toHaveLength(4);
    expect(result.caveats.some((item) => item.includes('实时市场'))).toBe(true);
  });

  it('accepts schema-valid OpenAI explanation without numeric content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '组合风险需要谨慎解释。',
                  observations: ['集中风险较高。'],
                  caveats: ['不构成交易建议。'],
                }),
              },
            },
          ],
        }),
      }))
    );
    const result = await new OpenAIExplanationProvider('key', 'model').explain(input);
    expect(result.provider).toBe('openai');
    expect(result.fallback).toBe(false);
  });

  it('rejects numeric AI prose and falls back safely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '风险达到百分之四十 40。',
                  observations: ['需要关注。'],
                  caveats: ['不构成建议。'],
                }),
              },
            },
          ],
        }),
      }))
    );
    const result = await new OpenAIExplanationProvider('key', 'model').explain(input);
    expect(result.provider).toBe('deterministic-fallback');
    expect(result.fallback).toBe(true);
  });
});

