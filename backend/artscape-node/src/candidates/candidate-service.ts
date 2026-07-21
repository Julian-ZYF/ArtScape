import Decimal from 'decimal.js';
import type { ArtScapeRepository } from '../repositories/artscape-repository';
import type {
  ArtPosition,
  CandidateProposal,
  DecisionStatus,
  PortfolioVersion,
  VersionComparison,
} from '../types';
import { AppError, requireFound } from '../utils/errors';
import { sha256 } from '../utils/hash';
import { createId } from '../utils/id';
import type { ScenarioService } from '../scenarios/scenario-service';
import { generateCandidateAllocation, validateCandidate } from './candidate-rule-engine';

export class CandidateService {
  constructor(
    private readonly repository: ArtScapeRepository,
    private readonly scenarioService: ScenarioService
  ) {}

  async generate(userId: string, scenarioRunId: string): Promise<CandidateProposal> {
    const state = await this.repository.read();
    const scenarioRun = requireFound(
      state.scenarioRuns.find(
        (candidate) => candidate.id === scenarioRunId && candidate.userId === userId
      ),
      'Scenario run not found.'
    );
    const version = requireFound(
      state.versions.find((candidate) => candidate.id === scenarioRun.portfolioVersionId),
      'Portfolio version not found.'
    );
    const candidate = generateCandidateAllocation(version.positions, scenarioRun.riskMetrics);
    const timestamp = new Date().toISOString();
    const proposal: CandidateProposal = {
      id: createId('proposal'),
      userId,
      portfolioId: version.portfolioId,
      baseVersionId: version.id,
      scenarioRunId,
      status: 'pending',
      proposedPositions: candidate.positions,
      changes: candidate.changes,
      validation: candidate.validation,
      explanation: scenarioRun.breaches.length
        ? '候选方案根据已触发的集中度、流动性或熊市损失规则生成。'
        : '当前未触发强制阈值，候选方案保持原配置。',
      createdAt: timestamp,
    };
    return this.repository.update((draft) => {
      draft.candidates.push(proposal);
      return proposal;
    });
  }

  async decide(input: {
    userId: string;
    proposalId: string;
    decision: Exclude<DecisionStatus, 'pending'>;
    proposedPositions?: ArtPosition[];
    runId: string;
  }): Promise<CandidateProposal> {
    const state = await this.repository.read();
    const proposal = requireFound(
      state.candidates.find(
        (candidate) => candidate.id === input.proposalId && candidate.userId === input.userId
      ),
      'Candidate proposal not found.'
    );
    if (proposal.status !== 'pending') return proposal;

    if (input.decision === 'rejected') {
      return this.repository.update((draft) => {
        const target = requireFound(
          draft.candidates.find((candidate) => candidate.id === input.proposalId),
          'Candidate proposal not found.'
        );
        target.status = 'rejected';
        target.decidedAt = new Date().toISOString();
        return target;
      });
    }

    const baseVersion = requireFound(
      state.versions.find((version) => version.id === proposal.baseVersionId),
      'Base portfolio version not found.'
    );
    const positions = input.proposedPositions ?? proposal.proposedPositions;
    const validation = validateCandidate(baseVersion.positions, positions);
    if (!validation.valid) {
      throw new AppError(
        'Candidate violates immutable allocation constraints.',
        409,
        'CANDIDATE_INVALID',
        validation.violations
      );
    }

    const timestamp = new Date().toISOString();
    const nextVersionNo =
      Math.max(
        0,
        ...state.versions
          .filter((version) => version.portfolioId === baseVersion.portfolioId)
          .map((version) => version.versionNo)
      ) + 1;
    const version: PortfolioVersion = {
      id: createId('version'),
      userId: input.userId,
      portfolioId: baseVersion.portfolioId,
      versionNo: nextVersionNo,
      parentVersionId: baseVersion.id,
      status: 'confirmed',
      source: 'candidate',
      sourceRef: proposal.id,
      totalNominalValue: Decimal.sum(...positions.map((position) => position.nominalValue)).toFixed(2),
      positions: structuredClone(positions),
      calculationHash: sha256({
        parentVersionHash: baseVersion.calculationHash,
        positions,
        versionNo: nextVersionNo,
      }),
      confirmedAt: timestamp,
      createdAt: timestamp,
    };
    await this.repository.update((draft) => {
      draft.versions.push(version);
      const portfolio = requireFound(
        draft.portfolios.find((item) => item.id === version.portfolioId),
        'Portfolio not found.'
      );
      portfolio.activeVersionId = version.id;
      portfolio.updatedAt = timestamp;
    });

    const afterRun = await this.scenarioService.calculate(input.userId, version.id, input.runId);
    const beforeRun = requireFound(
      (await this.repository.read()).scenarioRuns.find(
        (candidate) => candidate.id === proposal.scenarioRunId
      ),
      'Base scenario run not found.'
    );
    const comparison: VersionComparison = {
      id: createId('comparison'),
      userId: input.userId,
      portfolioId: version.portfolioId,
      beforeVersionId: baseVersion.id,
      afterVersionId: version.id,
      beforeScenarioRunId: beforeRun.id,
      afterScenarioRunId: afterRun.id,
      scenarioDeltas: beforeRun.scenarios.map((before) => {
        const after = requireFound(
          afterRun.scenarios.find(
            (candidate) => candidate.definition.code === before.definition.code
          ),
          'Recalculated scenario is missing.'
        );
        return {
          scenario: before.definition.code,
          beforeRealizableValue: before.portfolio.realizableValue,
          afterRealizableValue: after.portfolio.realizableValue,
          delta: new Decimal(after.portfolio.realizableValue)
            .minus(before.portfolio.realizableValue)
            .toFixed(2),
        };
      }),
      riskBefore: beforeRun.riskMetrics,
      riskAfter: afterRun.riskMetrics,
      createdAt: timestamp,
    };

    return this.repository.update((draft) => {
      draft.comparisons.push(comparison);
      const target = requireFound(
        draft.candidates.find((candidate) => candidate.id === input.proposalId),
        'Candidate proposal not found.'
      );
      target.status = input.decision;
      target.proposedPositions = structuredClone(positions);
      target.validation = validation;
      target.confirmedVersionId = version.id;
      target.comparisonId = comparison.id;
      target.decidedAt = timestamp;
      target.updatedAt = timestamp;
      return target;
    });
  }

  async getComparison(userId: string, comparisonId: string): Promise<VersionComparison> {
    const state = await this.repository.read();
    return requireFound(
      state.comparisons.find(
        (comparison) => comparison.id === comparisonId && comparison.userId === userId
      ),
      'Version comparison not found.'
    );
  }
}

