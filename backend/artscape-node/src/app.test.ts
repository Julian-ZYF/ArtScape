import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { InMemoryArtScapeRepository } from './repositories/in-memory-artscape-repository';
import { ArtScapeRuntime } from './runtime/artscape-runtime';
import { createSampleWorkbookBuffer } from './testing/fixtures';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe('ArtScape API smoke', () => {
  it('exposes status and accepts an Excel import through governed runtime', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'artscape-api-'));
    temporaryDirectories.push(dataDir);
    const runtime = new ArtScapeRuntime(new InMemoryArtScapeRepository(), dataDir);
    const app = await createApp({ runtime, persistence: 'memory' });
    const api = request.agent(app).set('x-user-id', 'api-user');
    await api.get('/health').expect(200).expect(({ body }) => {
      expect(body.ok).toBe(true);
    });
    await api.get('/api/v1/artscape/status').expect(200).expect(({ body }) => {
      expect(body.data.autoTrading).toBe(false);
    });

    const response = await api
      .post('/api/v1/artscape/imports')
      .field('userId', 'api-user')
      .field('portfolioName', 'API 验收组合')
      .field('idempotencyKey', 'api-import-001')
      .attach('file', await createSampleWorkbookBuffer(), 'portfolio.xlsx')
      .expect(201);
    expect(response.body.data.import.positions).toHaveLength(3);
    expect(response.body.data.import.status).toBe('awaiting_confirmation');

    const confirmed = await api
      .post(`/api/v1/artscape/imports/${response.body.data.import.id}/confirm`)
      .send({
        userId: 'api-user',
        approved: true,
        idempotencyKey: 'api-confirm-001',
      })
      .expect(200);
    const portfolioId = confirmed.body.data.portfolio.id as string;
    const versionId = confirmed.body.data.version.id as string;

    await api
      .get(`/api/v1/artscape/portfolios/${portfolioId}`)
      .query({ userId: 'api-user' })
      .expect(200);

    const analysis = await api
      .post(`/api/v1/artscape/portfolios/${portfolioId}/scenario-runs`)
      .send({
        userId: 'api-user',
        portfolioVersionId: versionId,
        idempotencyKey: 'api-scenario-001',
      })
      .expect(201);
    const scenarioRunId = analysis.body.data.analysis.id as string;
    await api
      .get(`/api/v1/artscape/scenario-runs/${scenarioRunId}`)
      .query({ userId: 'api-user' })
      .expect(200);

    const generated = await api
      .post(`/api/v1/artscape/scenario-runs/${scenarioRunId}/candidate-proposals`)
      .send({
        userId: 'api-user',
        idempotencyKey: 'api-candidate-001',
      })
      .expect(201);
    const proposalId = generated.body.data.proposal.id as string;
    await api
      .get(`/api/v1/artscape/candidate-proposals/${proposalId}`)
      .query({ userId: 'api-user' })
      .expect(200);

    const decided = await api
      .post(`/api/v1/artscape/candidate-proposals/${proposalId}/decisions`)
      .send({
        userId: 'api-user',
        decision: 'accepted',
        idempotencyKey: 'api-decision-001',
      });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    const proposal = decided.body.data.proposal;
    const comparison = decided.body.data.comparison;
    await api
      .get(`/api/v1/artscape/comparisons/${comparison.id}`)
      .query({ userId: 'api-user' })
      .expect(200);

    const reportResponse = await api
      .post('/api/v1/artscape/reports')
      .send({
        userId: 'api-user',
        portfolioVersionId: proposal.confirmedVersionId,
        scenarioRunId: comparison.afterScenarioRunId,
        comparisonId: comparison.id,
        idempotencyKey: 'api-report-001',
      });
    expect(reportResponse.status, JSON.stringify(reportResponse.body)).toBe(201);
    const report = reportResponse.body.data.report;
    await api
      .get(`/api/v1/artscape/reports/${report.id}`)
      .query({ userId: 'api-user' })
      .expect(200);
    await api
      .get(`/api/v1/artscape/artifacts/${report.pdfArtifact.id}`)
      .query({ userId: 'api-user' })
      .expect('content-type', /pdf/)
      .expect(200);
    await api
      .get('/api/v1/artscape/jobs')
      .query({ userId: 'api-user' })
      .expect(200);
    await api
      .get(`/api/v1/artscape/jobs/${reportResponse.body.data.job.id}`)
      .query({ userId: 'api-user' })
      .expect(200);
    await api
      .get(`/api/v1/artscape/runs/${reportResponse.body.data.runId}/events`)
      .expect(200);
    await api
      .get(`/api/v1/artscape/runs/${reportResponse.body.data.runId}/replay`)
      .expect(200);
    await api.get('/missing').expect(404);
  });
});
