import type {
  ExplanationResult,
  RiskMetrics,
  ScenarioResult,
  ThresholdBreach,
} from '../types';
import { explanationOutputSchema } from '../schemas/contracts';

export interface ExplanationInput {
  scenarios: ScenarioResult[];
  riskMetrics: RiskMetrics;
  breaches: ThresholdBreach[];
}

export interface ExplanationProvider {
  explain(input: ExplanationInput): Promise<ExplanationResult>;
}

function deterministicExplanation(input: ExplanationInput, provider: string): ExplanationResult {
  const observations: string[] = [];
  if (input.breaches.some((breach) => breach.code === 'artist_concentration')) {
    observations.push('组合存在艺术家集中度风险，候选方案应优先降低最大艺术家权重。');
  }
  if (input.breaches.some((breach) => breach.code === 'low_liquidity')) {
    observations.push('低流动性资产占比较高，可实现价值更容易受到折价影响。');
  }
  if (input.breaches.some((breach) => breach.code === 'bear_loss')) {
    observations.push('熊市场景的组合损失超过规则阈值，需要展示调整候选方案。');
  }
  if (!observations.length) observations.push('当前组合未触发候选方案强制阈值。');
  if (Number(input.riskMetrics.completenessRatio) < 1) {
    observations.push('部分数据不完整，所有结果应结合数据完整度谨慎解释。');
  }
  return {
    provider,
    generatedAt: new Date().toISOString(),
    summary: '数值结果由确定性计算引擎生成；以下内容仅解释风险和情景差异。',
    observations,
    caveats: [
      '本结果不是实时市场估值。',
      '本结果不构成交易、投资或自动调仓指令。',
      'AI 无权修改任何金额、收益率或配置值。',
    ],
    fallback: true,
  };
}

export class DeterministicExplanationProvider implements ExplanationProvider {
  async explain(input: ExplanationInput): Promise<ExplanationResult> {
    return deterministicExplanation(input, 'deterministic-rule-explanation');
  }
}

export class OpenAIExplanationProvider implements ExplanationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
    private readonly providerName = 'openai'
  ) {}

  async explain(input: ExplanationInput): Promise<ExplanationResult> {
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                '你是艺术品组合风险解释器。只解释给定的风险标签，不得输出任何数字、价格、收益率、配置值、交易建议或实时行情。只输出一个 JSON 对象，必须且只能包含 summary（字符串）、observations（字符串数组）、caveats（字符串数组）。',
            },
            {
              role: 'user',
              content: JSON.stringify({
                breachCodes: input.breaches.map((breach) => breach.code),
                maxArtistName: input.riskMetrics.maxArtistName,
                incomplete: Number(input.riskMetrics.completenessRatio) < 1,
              }),
            },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}`);
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error('OpenAI returned no explanation content.');
      const parsed = explanationOutputSchema.parse(JSON.parse(content));
      const allText = [parsed.summary, ...parsed.observations, ...parsed.caveats].join(' ');
      if (/\d/.test(allText)) {
        throw new Error('AI explanation echoed or invented numeric content.');
      }
      return {
        provider: this.providerName,
        generatedAt: new Date().toISOString(),
        ...parsed,
        fallback: false,
      };
    } catch {
      return deterministicExplanation(input, 'deterministic-fallback');
    }
  }
}

export function createExplanationProvider(): ExplanationProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (apiKey && model) {
    return new OpenAIExplanationProvider(
      apiKey,
      model,
      process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      process.env.AI_PROVIDER_NAME ?? 'openai'
    );
  }
  return new DeterministicExplanationProvider();
}
