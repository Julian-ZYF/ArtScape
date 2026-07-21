import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';

type Json = Record<string, any>;

const baseUrl = (process.env.UAT_BASE_URL ?? 'http://localhost:3100').replace(/\/$/, '');
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET is required for restart verification.');

const token = jwt.sign({ roles: ['portfolio-owner'] }, jwtSecret, {
  subject: 'uat-backend-v1-owner',
  issuer: process.env.JWT_ISSUER ?? 'artscape',
  audience: process.env.JWT_AUDIENCE ?? 'artscape-api',
  expiresIn: '10m',
  algorithm: 'HS256',
});

async function get(route: string, authenticated = true): Promise<{ response: Response; body: any }> {
  const headers = authenticated ? { authorization: `Bearer ${token}` } : undefined;
  const response = await fetch(`${baseUrl}${route}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('json')
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`GET ${route} returned ${response.status}.`);
  return { response, body };
}

function evidence(cases: Json[], id: string): Json {
  const found = cases.find((item) => item.id === id)?.evidence;
  if (!found) throw new Error(`Missing ${id} evidence in UAT report.`);
  return found;
}

async function main(): Promise<void> {
  const reportPath = path.resolve('../../output/uat/backend-v1-uat.json');
  const uat = JSON.parse(await readFile(reportPath, 'utf8')) as Json;
  const portfolioEvidence = evidence(uat.cases, 'UAT-05');
  const reportEvidence = evidence(uat.cases, 'UAT-08');
  const workflowEvidence = evidence(uat.cases, 'UAT-09');

  const ready = await get('/health/ready', false);
  const portfolio = await get(`/api/v1/artscape/portfolios/${portfolioEvidence.portfolioId}`);
  const report = await get(`/api/v1/artscape/reports/${reportEvidence.reportId}`);
  const workflow = await get(`/api/v1/artscape/runs/${workflowEvidence.runId}`);
  const events = await get(`/api/v1/artscape/runs/${workflowEvidence.runId}/events`);
  const jsonArtifact = await get(`/api/v1/artscape/artifacts/${report.body.data.jsonArtifact.id}`);
  const pdfArtifact = await get(`/api/v1/artscape/artifacts/${report.body.data.pdfArtifact.id}`);

  const checks = {
    ready: ready.body.ok === true && ready.body.persistence === 'mongo',
    portfolio: portfolio.body.data.portfolio.id === portfolioEvidence.portfolioId
      && portfolio.body.data.versions.length >= 2,
    report: report.body.data.snapshotHash === reportEvidence.snapshotHash,
    workflow: workflow.body.data.id === workflowEvidence.runId && workflow.body.data.status === 'completed',
    events: Array.isArray(events.body.data) && events.body.data.length >= workflowEvidence.events,
    jsonArtifact: jsonArtifact.body.schemaVersion === '1.0.0',
    pdfArtifact: Buffer.isBuffer(pdfArtifact.body) && pdfArtifact.body.subarray(0, 4).toString() === '%PDF',
  };
  if (Object.values(checks).some((value) => !value)) {
    throw new Error(`Restart persistence verification failed: ${JSON.stringify(checks)}`);
  }

  const output = {
    schemaVersion: '1.0.0',
    verifiedAt: new Date().toISOString(),
    serviceRestarted: true,
    stores: ['MongoDB', 'Redis', 'MinIO'],
    checks,
    ids: {
      portfolioId: portfolioEvidence.portfolioId,
      reportId: reportEvidence.reportId,
      workflowRunId: workflowEvidence.runId,
    },
  };
  await writeFile(path.resolve('../../output/uat/backend-v1-restart.json'), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`PASS Backend V1 restart persistence ${Object.keys(checks).length}/${Object.keys(checks).length}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
