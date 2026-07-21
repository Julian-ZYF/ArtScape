import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryArtScapeRepository } from '../repositories/in-memory-artscape-repository';
import { ArtScapeRuntime } from '../runtime/artscape-runtime';
import { ARTSCAPE_TOOL_IDS } from '../tools';
import { createSampleWorkbookBuffer } from '../testing/fixtures';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe('ArtScape M0-M8 backend acceptance', () => {
  it('runs Excel → V1 → scenarios → candidate → V2 → comparison → report → replay', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'artscape-acceptance-'));
    temporaryDirectories.push(dataDir);
    const repository = new InMemoryArtScapeRepository();
    const runtime = new ArtScapeRuntime(repository, dataDir);
    const userId = 'acceptance-user';
    const workbook = await createSampleWorkbookBuffer();

    const imported = await runtime.invoke<{ importId: string; status: string }>(
      ARTSCAPE_TOOL_IDS.parseExcel,
      {
        userId,
        fileName: 'portfolio.xlsx',
        portfolioName: '验收组合',
        fileBase64: workbook.toString('base64'),
      },
      {
        userId,
        idempotencyKey: 'accept-import-001',
        workflowId: 'workflow.art-portfolio-intake',
      }
    );
    expect(imported.status).toBe('completed');
    expect(imported.data?.status).toBe('awaiting_confirmation');

    const pending = await runtime.invoke(
      ARTSCAPE_TOOL_IDS.confirmVersion,
      { userId, importId: imported.data!.importId },
      {
        userId,
        idempotencyKey: 'accept-confirm-pending',
        workflowId: 'workflow.art-portfolio-intake',
      }
    );
    expect(pending.status).toBe('human_review_required');
    expect((await repository.read()).versions).toHaveLength(0);

    const confirmed = await runtime.invoke<{ portfolioId: string; versionId: string }>(
      ARTSCAPE_TOOL_IDS.confirmVersion,
      { userId, importId: imported.data!.importId },
      {
        userId,
        idempotencyKey: 'accept-confirm-approved',
        approve: true,
        workflowId: 'workflow.art-portfolio-intake',
      }
    );
    expect(confirmed.status).toBe('completed');

    const analysis = await runtime.invoke<{
      scenarioRunId: string;
      calculationHash: string;
    }>(
      ARTSCAPE_TOOL_IDS.calculateScenario,
      { userId, portfolioVersionId: confirmed.data!.versionId },
      {
        userId,
        idempotencyKey: 'accept-scenario-001',
        workflowId: 'workflow.art-scenario-analysis',
      }
    );
    expect(analysis.status).toBe('completed');
    const scenarioRecord = await runtime.scenarios.get(userId, analysis.data!.scenarioRunId);
    expect(scenarioRecord.scenarios).toHaveLength(3);
    expect(scenarioRecord.explanation.fallback).toBe(true);

    const generated = await runtime.invoke<{ proposalId: string; valid: boolean }>(
      ARTSCAPE_TOOL_IDS.generateCandidate,
      { userId, scenarioRunId: analysis.data!.scenarioRunId },
      {
        userId,
        idempotencyKey: 'accept-candidate-001',
        workflowId: 'workflow.art-candidate-comparison',
      }
    );
    expect(generated.data?.valid).toBe(true);

    const decided = await runtime.invoke<{ proposalId: string; decision: string }>(
      ARTSCAPE_TOOL_IDS.confirmCandidate,
      {
        userId,
        proposalId: generated.data!.proposalId,
        decision: 'accepted',
      },
      {
        userId,
        idempotencyKey: 'accept-candidate-confirm',
        approve: true,
        workflowId: 'workflow.art-candidate-comparison',
      }
    );
    expect(decided.status).toBe('completed');
    const afterDecision = await repository.read();
    const proposal = afterDecision.candidates.find(
      (candidate) => candidate.id === generated.data!.proposalId
    )!;
    expect(proposal.confirmedVersionId).toBeTruthy();
    expect(proposal.comparisonId).toBeTruthy();
    expect(afterDecision.versions).toHaveLength(2);
    expect(afterDecision.versions[0]!.totalNominalValue).toBe(
      afterDecision.versions[1]!.totalNominalValue
    );

    const afterRun = afterDecision.scenarioRuns.find(
      (run) => run.portfolioVersionId === proposal.confirmedVersionId
    )!;
    const built = await runtime.invoke<{ report: unknown; snapshotHash: string }>(
      ARTSCAPE_TOOL_IDS.buildReportJson,
      {
        userId,
        portfolioVersionId: proposal.confirmedVersionId,
        scenarioRunId: afterRun.id,
        comparisonId: proposal.comparisonId,
      },
      { userId, workflowId: 'workflow.art-report-export' }
    );
    expect(built.status).toBe('completed');

    const rendered = await runtime.invoke<{
      reportId: string;
      jsonArtifactId: string;
      pdfArtifactId: string;
    }>(
      ARTSCAPE_TOOL_IDS.renderReportPdf,
      {
        userId,
        portfolioVersionId: proposal.confirmedVersionId,
        scenarioRunId: afterRun.id,
        comparisonId: proposal.comparisonId,
        ...built.data,
      },
      {
        userId,
        idempotencyKey: 'accept-report-render',
        workflowId: 'workflow.art-report-export',
      }
    );
    expect(rendered.status).toBe('completed');
    const report = (await repository.read()).reports.find(
      (item) => item.id === rendered.data!.reportId
    )!;
    expect((await readFile(report.pdfArtifact.path)).subarray(0, 4).toString()).toBe('%PDF');
    expect(JSON.parse(await readFile(report.jsonArtifact.path, 'utf8')).schemaVersion).toBe('1.0.0');

    const events = await runtime.events(rendered.runId);
    expect(events.map((event) => event.type)).toContain('tool.call.completed');
    expect(events.map((event) => event.type)).toContain('run.completed');
    const replay = await runtime.replay(rendered.runId);
    expect(replay.finalOutput).toBeTruthy();
    const audit = await runtime.audit(decided.runId);
    expect(audit.toolCallCount).toBeGreaterThan(0);
  }, 15_000);
});
