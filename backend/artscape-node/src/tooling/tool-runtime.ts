import { ToolRegistry, type ToolCallContext } from '@hypha/tools';
import type { PortfolioImportService } from '../portfolios/portfolio-import-service';
import type { ScenarioService } from '../scenarios/scenario-service';
import type { CandidateService } from '../candidates/candidate-service';
import type { ReportService } from '../reports/report-service';
import { ARTSCAPE_TOOL_IDS, artScapeToolSpecs } from '../tools';
import type { ArtPosition } from '../types';
import type { AuditReportData } from '../reports/pdf-renderer';

export interface ArtScapeToolServices {
  imports: PortfolioImportService;
  scenarios: ScenarioService;
  candidates: CandidateService;
  reports: ReportService;
}

export function registerArtScapeTools(
  registry: ToolRegistry,
  services: ArtScapeToolServices
): void {
  const spec = (toolId: string) => artScapeToolSpecs.find((candidate) => candidate.id === toolId)!;

  registry.register(spec(ARTSCAPE_TOOL_IDS.parseExcel), async (raw) => {
    const input = raw as {
      userId: string;
      fileName: string;
      portfolioName: string;
      fileBase64: string;
    };
    const record = await services.imports.importWorkbook({
      userId: input.userId,
      fileName: input.fileName,
      portfolioName: input.portfolioName,
      buffer: Buffer.from(input.fileBase64, 'base64'),
    });
    return { importId: record.id, status: record.status };
  });

  registry.register(spec(ARTSCAPE_TOOL_IDS.validatePortfolio), async (raw) => {
    const input = raw as { userId: string; importId: string };
    const result = await services.imports.validateImport(input.userId, input.importId);
    return { valid: result.valid, issueCount: result.issueCount };
  });

  registry.register(spec(ARTSCAPE_TOOL_IDS.confirmVersion), async (raw) => {
    const input = raw as { userId: string; importId: string };
    return services.imports.confirmImport(input.userId, input.importId);
  });

  registry.register(
    spec(ARTSCAPE_TOOL_IDS.calculateScenario),
    async (raw, context: ToolCallContext) => {
      const input = raw as { userId: string; portfolioVersionId: string };
      const result = await services.scenarios.calculate(
        input.userId,
        input.portfolioVersionId,
        context.runId
      );
      return { scenarioRunId: result.id, calculationHash: result.calculationHash };
    }
  );

  registry.register(spec(ARTSCAPE_TOOL_IDS.calculateRisk), async (raw) => {
    const input = raw as { userId: string; scenarioRunId: string };
    const run = await services.scenarios.get(input.userId, input.scenarioRunId);
    return { scenarioRunId: run.id, breachCount: run.breaches.length };
  });

  registry.register(spec(ARTSCAPE_TOOL_IDS.generateCandidate), async (raw) => {
    const input = raw as { userId: string; scenarioRunId: string };
    const proposal = await services.candidates.generate(input.userId, input.scenarioRunId);
    return { proposalId: proposal.id, valid: proposal.validation.valid };
  });

  registry.register(
    spec(ARTSCAPE_TOOL_IDS.confirmCandidate),
    async (raw, context: ToolCallContext) => {
      const input = raw as {
        userId: string;
        proposalId: string;
        decision: 'accepted' | 'modified' | 'rejected';
        proposedPositions?: ArtPosition[];
      };
      const proposal = await services.candidates.decide({
        ...input,
        runId: context.runId,
      });
      return { proposalId: proposal.id, decision: proposal.status };
    }
  );

  registry.register(spec(ARTSCAPE_TOOL_IDS.compareVersions), async (raw) => {
    const input = raw as { userId: string; comparisonId: string };
    const comparison = await services.candidates.getComparison(input.userId, input.comparisonId);
    return { comparisonId: comparison.id };
  });

  registry.register(spec(ARTSCAPE_TOOL_IDS.buildReportJson), async (raw) => {
    const input = raw as {
      userId: string;
      portfolioVersionId: string;
      scenarioRunId: string;
      comparisonId?: string;
    };
    return services.reports.build(input);
  });

  registry.register(
    spec(ARTSCAPE_TOOL_IDS.renderReportPdf),
    async (raw, context: ToolCallContext) => {
      const input = raw as {
        userId: string;
        portfolioVersionId: string;
        scenarioRunId: string;
        comparisonId?: string;
        report: AuditReportData;
        snapshotHash: string;
      };
      const record = await services.reports.renderAndStore({
        ...input,
        runId: context.runId,
      });
      return {
        reportId: record.id,
        jsonArtifactId: record.jsonArtifact.id,
        pdfArtifactId: record.pdfArtifact.id,
      };
    }
  );
}

