import type { ArtScapeRepository } from '../repositories/artscape-repository';
import type { ScenarioRun } from '../types';
import { requireFound } from '../utils/errors';
import { sha256 } from '../utils/hash';
import { createId } from '../utils/id';
import type { ExplanationProvider } from '../agent/explanation-provider';
import { SCENARIO_DEFINITIONS, SCENARIO_PARAMETER_SET } from './scenario-definitions';
import { calculateRiskMetrics } from './risk-engine';
import { calculatePortfolioScenario } from './valuation-engine';

export class ScenarioService {
  constructor(
    private readonly repository: ArtScapeRepository,
    private readonly explanationProvider: ExplanationProvider
  ) {}

  async calculate(
    userId: string,
    portfolioVersionId: string,
    runId: string
  ): Promise<ScenarioRun> {
    const state = await this.repository.read();
    const version = requireFound(
      state.versions.find(
        (candidate) => candidate.id === portfolioVersionId && candidate.userId === userId
      ),
      'Portfolio version not found.'
    );
    const scenarios = SCENARIO_DEFINITIONS.map((definition) =>
      calculatePortfolioScenario(version.positions, definition)
    );
    const risk = calculateRiskMetrics(version.positions, scenarios);
    const explanation = await this.explanationProvider.explain({
      scenarios,
      riskMetrics: risk.metrics,
      breaches: risk.breaches,
    });
    const timestamp = new Date().toISOString();
    const calculationHash = sha256({
      portfolioVersionHash: version.calculationHash,
      definitions: SCENARIO_DEFINITIONS,
      parameterSet: SCENARIO_PARAMETER_SET,
      scenarios,
      risk,
    });
    const record: ScenarioRun = {
      id: createId('scenario'),
      userId,
      portfolioId: version.portfolioId,
      portfolioVersionId,
      status: 'completed',
      scenarios,
      riskMetrics: risk.metrics,
      breaches: risk.breaches,
      explanation,
      calculationHash,
      runId,
      createdAt: timestamp,
    };
    return this.repository.update((draft) => {
      draft.scenarioRuns.push(record);
      return record;
    });
  }

  async get(userId: string, scenarioRunId: string): Promise<ScenarioRun> {
    const state = await this.repository.read();
    return requireFound(
      state.scenarioRuns.find(
        (candidate) => candidate.id === scenarioRunId && candidate.userId === userId
      ),
      'Scenario run not found.'
    );
  }
}
