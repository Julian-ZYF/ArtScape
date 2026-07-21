import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { samplePositions } from '../testing/fixtures';
import { SCENARIO_DEFINITIONS, SCENARIO_PARAMETER_SET } from './scenario-definitions';
import { calculateRiskMetrics } from './risk-engine';
import { calculatePortfolioScenario } from './valuation-engine';

describe('P1 golden calculation contract', () => {
  it('matches the reviewed cross-language fixture exactly', async () => {
    const golden = JSON.parse(await readFile(path.resolve('../../fixtures/golden/portfolio-10.golden.json'), 'utf8'));
    const scenarios = SCENARIO_DEFINITIONS.map((definition) => calculatePortfolioScenario(samplePositions(), definition));
    const risk = calculateRiskMetrics(samplePositions(), scenarios);
    expect(`${SCENARIO_PARAMETER_SET.id}@${SCENARIO_PARAMETER_SET.version}`).toBe(golden.parameterSet);
    expect(scenarios.map((scenario) => ({ code: scenario.definition.code, ...scenario.portfolio }))).toEqual(golden.expected.scenarios);
    expect(risk.metrics).toEqual(golden.expected.riskMetrics);
    expect(risk.breaches.map((breach) => breach.code)).toEqual(golden.expected.breachCodes);
  });
});
