import type { ScenarioDefinition, ScenarioParameterSet } from '../types';

export const SCENARIO_DEFINITIONS: readonly ScenarioDefinition[] = [
  {
    code: 'bull',
    name: '牛市',
    horizonYears: 3,
    marketReturn: '0.12',
    version: '1.0.0',
  },
  {
    code: 'neutral',
    name: '中性',
    horizonYears: 3,
    marketReturn: '0.05',
    version: '1.0.0',
  },
  {
    code: 'bear',
    name: '熊市',
    horizonYears: 3,
    marketReturn: '-0.18',
    version: '1.0.0',
  },
] as const;

export const SCENARIO_PARAMETER_SET: ScenarioParameterSet = {
  id: 'scenario-parameters.artscape.mvp',
  version: '1.0.0',
  effectiveFrom: '2026-07-21',
  horizonYears: 3,
  currency: 'CNY',
  roundingMode: 'HALF_UP',
  moneyScale: 2,
  ratioScale: 6,
  source: 'ArtScape MVP business contract',
  definitions: [...SCENARIO_DEFINITIONS],
};
