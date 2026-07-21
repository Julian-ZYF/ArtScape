import { describe, expect, it } from 'vitest';
import { samplePositions } from '../testing/fixtures';
import { SCENARIO_DEFINITIONS } from './scenario-definitions';
import { calculatePortfolioScenario, calculatePositionScenario } from './valuation-engine';
import { calculateRiskMetrics } from './risk-engine';

describe('deterministic scenario and risk engines', () => {
  it('uses the exact three-year theoretical and realizable formulas', () => {
    const position = samplePositions()[0]!;
    const neutral = SCENARIO_DEFINITIONS.find((item) => item.code === 'neutral')!;
    const result = calculatePositionScenario(position, neutral);
    expect(result.theoreticalValue).toBe('777.02');
    expect(result.realizableValue).toBe('553.62');
    expect(result.nominalValue).toBe('600.00');
  });

  it('calculates all scenarios and triggers configured risk thresholds', () => {
    const positions = samplePositions();
    const scenarios = SCENARIO_DEFINITIONS.map((definition) =>
      calculatePortfolioScenario(positions, definition)
    );
    const risk = calculateRiskMetrics(positions, scenarios);
    expect(scenarios.map((item) => item.definition.code)).toEqual([
      'bull',
      'neutral',
      'bear',
    ]);
    expect(risk.metrics.maxArtistConcentration).toBe('0.600000');
    expect(risk.metrics.lowLiquidityRatio).toBe('0.600000');
    expect(risk.breaches.map((breach) => breach.code)).toContain('artist_concentration');
    expect(risk.breaches.map((breach) => breach.code)).toContain('low_liquidity');
  });

  it('handles an empty/zero portfolio without division or threshold errors', () => {
    const zero = {
      ...samplePositions()[0]!,
      nominalValue: '0',
      baseValue: '0',
      liquidityLevel: 'high' as const,
    };
    const scenarios = SCENARIO_DEFINITIONS.map((definition) =>
      calculatePortfolioScenario([zero], definition)
    );
    expect(scenarios[0]!.portfolio.returnRate).toBe('0.000000');
    const risk = calculateRiskMetrics([zero], scenarios);
    expect(risk.metrics.maxArtistConcentration).toBe('0.000000');
    expect(risk.breaches).toEqual([]);
  });
});
