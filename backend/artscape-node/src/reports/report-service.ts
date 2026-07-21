import type { ArtScapeRepository } from '../repositories/artscape-repository';
import type { ReportRecord } from '../types';
import { requireFound } from '../utils/errors';
import { canonicalJson, sha256 } from '../utils/hash';
import { createId } from '../utils/id';
import type { ArtifactService } from '../artifacts/artifact-service';
import { type AuditReportData, PdfReportRenderer } from './pdf-renderer';
import { SCENARIO_PARAMETER_SET } from '../scenarios/scenario-definitions';

export class ReportService {
  constructor(
    private readonly repository: ArtScapeRepository,
    private readonly artifacts: ArtifactService,
    private readonly pdf = new PdfReportRenderer()
  ) {}

  async build(input: {
    userId: string;
    portfolioVersionId: string;
    scenarioRunId: string;
    comparisonId?: string;
  }): Promise<{ report: AuditReportData; snapshotHash: string }> {
    const state = await this.repository.read();
    const version = requireFound(
      state.versions.find(
        (candidate) =>
          candidate.id === input.portfolioVersionId && candidate.userId === input.userId
      ),
      'Portfolio version not found.'
    );
    const portfolio = requireFound(
      state.portfolios.find(
        (candidate) => candidate.id === version.portfolioId && candidate.userId === input.userId
      ),
      'Portfolio not found.'
    );
    const analysis = requireFound(
      state.scenarioRuns.find(
        (candidate) =>
          candidate.id === input.scenarioRunId &&
          candidate.userId === input.userId &&
          candidate.portfolioVersionId === version.id
      ),
      'Scenario run does not belong to the selected portfolio version.'
    );
    const comparison = input.comparisonId
      ? requireFound(
          state.comparisons.find(
            (candidate) =>
              candidate.id === input.comparisonId && candidate.userId === input.userId
          ),
          'Version comparison not found.'
        )
      : undefined;

    const report: AuditReportData = {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      portfolio: {
        id: portfolio.id,
        name: portfolio.name,
        versionId: version.id,
        versionNo: version.versionNo,
        totalNominalValue: version.totalNominalValue,
        positions: version.positions.map((position) => ({
          artworkName: position.artworkName,
          artistName: position.artistName,
          nominalValue: position.nominalValue,
          liquidityLevel: position.liquidityLevel,
        })),
      },
      analysis: {
        id: analysis.id,
        calculationHash: analysis.calculationHash,
        parameterSet: {
          id: SCENARIO_PARAMETER_SET.id,
          version: SCENARIO_PARAMETER_SET.version,
          effectiveFrom: SCENARIO_PARAMETER_SET.effectiveFrom,
          horizonYears: SCENARIO_PARAMETER_SET.horizonYears,
          currency: SCENARIO_PARAMETER_SET.currency,
          roundingMode: SCENARIO_PARAMETER_SET.roundingMode,
        },
        scenarios: analysis.scenarios.map((scenario) => ({
          code: scenario.definition.code,
          theoreticalValue: scenario.portfolio.theoreticalValue,
          realizableValue: scenario.portfolio.realizableValue,
          returnRate: scenario.portfolio.returnRate,
        })),
        riskMetrics: analysis.riskMetrics,
        breaches: analysis.breaches.map((breach) => ({
          code: breach.code,
          message: breach.message,
        })),
        explanation: {
          provider: analysis.explanation.provider,
          summary: analysis.explanation.summary,
          observations: analysis.explanation.observations,
          caveats: analysis.explanation.caveats,
        },
      },
      comparison: comparison ? structuredClone(comparison) : undefined,
      audit: {
        liveMarketDataUsed: false,
        autoTradingEnabled: false,
        calculationAuthority: 'deterministic-tools-only',
        formulaContractVersion: '1.0.0',
        reportRendererVersion: '1.0.1',
      },
    };
    return { report, snapshotHash: sha256(report) };
  }

  async renderAndStore(input: {
    userId: string;
    portfolioVersionId: string;
    scenarioRunId: string;
    comparisonId?: string;
    report: AuditReportData;
    snapshotHash: string;
    runId: string;
  }): Promise<ReportRecord> {
    const actualHash = sha256(input.report);
    if (actualHash !== input.snapshotHash) {
      throw new Error('Report snapshot hash changed between JSON validation and rendering.');
    }
    const json = `${canonicalJson(input.report)}\n`;
    const pdf = await this.pdf.render(input.report);
    const jsonArtifact = await this.artifacts.write({
      kind: 'report_json',
      extension: 'json',
      mimeType: 'application/json',
      content: json,
    });
    const pdfArtifact = await this.artifacts.write({
      kind: 'report_pdf',
      extension: 'pdf',
      mimeType: 'application/pdf',
      content: pdf,
    });
    const timestamp = new Date().toISOString();
    const record: ReportRecord = {
      id: createId('report'),
      userId: input.userId,
      portfolioId: input.report.portfolio.id,
      portfolioVersionId: input.portfolioVersionId,
      scenarioRunId: input.scenarioRunId,
      comparisonId: input.comparisonId,
      status: 'completed',
      snapshotHash: input.snapshotHash,
      jsonArtifact,
      pdfArtifact,
      runId: input.runId,
      createdAt: timestamp,
    };
    return this.repository.update((state) => {
      state.reports.push(record);
      return record;
    });
  }
}
