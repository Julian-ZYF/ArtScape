import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeterministicIntentRouter, OpenAIIntentRouter } from './intent-router';

afterEach(() => vi.unstubAllGlobals());

describe('intent routing branches', () => {
  it.each([
    ['请上传 Excel 持仓', 'portfolio_intake'],
    ['运行熊市场景风险分析', 'scenario_analysis'],
    ['生成 V1 与 V2 候选对比', 'candidate_comparison'],
    ['导出 PDF 审计报告', 'report_export'],
    ['你好', 'unknown'],
  ])('routes %s', async (content, expected) => {
    expect((await new DeterministicIntentRouter().route(content)).intent).toBe(expected);
  });

  it('accepts strict provider JSON and falls back on provider failure', async () => {
    const fallback = new DeterministicIntentRouter();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"intent":"report_export","confidence":0.8}' } }] }),
    })));
    const router = new OpenAIIntentRouter('key', 'model', fallback);
    expect((await router.route('任意文本')).provider).toBe('openai-intent-router');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    expect((await router.route('运行情景分析')).provider).toBe('deterministic-intent-router');
  });
});
