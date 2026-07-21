import { describe, expect, it } from 'vitest';
import { samplePositions } from '../testing/fixtures';
import { SCENARIO_DEFINITIONS } from './scenario-definitions';
import { calculateRiskMetrics } from './risk-engine';
import { calculatePortfolioScenario } from './valuation-engine';

describe('P7 performance baseline', () => {
  it('calculates three scenarios and risk metrics for 100 positions within 2 seconds', () => {
    const seed = samplePositions()[0]!;
    const positions = Array.from({ length: 100 }, (_, index) => ({
      ...seed, id: `position-${index}`, sourceRow: index + 2,
      artworkName: `作品-${index}`, artistName: `艺术家-${index % 20}`,
      nominalValue: '100000.00', baseValue: '100000.00',
    }));
    const start = performance.now();
    const scenarios = SCENARIO_DEFINITIONS.map((definition) => calculatePortfolioScenario(positions, definition));
    const risk = calculateRiskMetrics(positions, scenarios);
    const elapsed = performance.now() - start;
    expect(scenarios).toHaveLength(3);
    expect(risk.metrics.maxArtistConcentration).toBe('0.050000');
    expect(elapsed).toBeLessThan(2_000);
  });
});
