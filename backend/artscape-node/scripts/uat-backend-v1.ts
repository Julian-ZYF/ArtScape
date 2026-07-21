import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import jwt from 'jsonwebtoken';

type Json = Record<string, any>;
interface CaseResult { id: string; name: string; status: 'passed' | 'failed'; durationMs: number; evidence: Json; error?: string }

const baseUrl = (process.env.UAT_BASE_URL ?? 'http://localhost:3100').replace(/\/$/, '');
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET is required for UAT.');
const owner = 'uat-backend-v1-owner';
const token = jwt.sign({ roles: ['portfolio-owner'] }, jwtSecret, {
  subject: owner,
  issuer: process.env.JWT_ISSUER ?? 'artscape',
  audience: process.env.JWT_AUDIENCE ?? 'artscape-api',
  expiresIn: '30m',
  algorithm: 'HS256',
});
const viewerToken = jwt.sign({ roles: ['viewer'] }, jwtSecret, {
  subject: 'uat-viewer', issuer: process.env.JWT_ISSUER ?? 'artscape',
  audience: process.env.JWT_AUDIENCE ?? 'artscape-api', expiresIn: '30m', algorithm: 'HS256',
});

const results: CaseResult[] = [];
const ids: Json = {};

const expect = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};

async function api(route: string, init: RequestInit = {}, expected?: number, bearer = token): Promise<{ response: Response; body: any }> {
  const headers = new Headers(init.headers);
  if (bearer) headers.set('authorization', `Bearer ${bearer}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${baseUrl}${route}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  if (expected !== undefined && response.status !== expected) {
    throw new Error(`${init.method ?? 'GET'} ${route}: expected ${expected}, got ${response.status}: ${Buffer.isBuffer(body) ? '<binary>' : JSON.stringify(body)}`);
  }
  return { response, body };
}

async function runCase(id: string, name: string, action: () => Promise<Json>): Promise<void> {
  const started = performance.now();
  try {
    const evidence = await action();
    results.push({ id, name, status: 'passed', durationMs: Math.round(performance.now() - started), evidence });
    process.stdout.write(`PASS ${id} ${name}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ id, name, status: 'failed', durationMs: Math.round(performance.now() - started), evidence: {}, error: message });
    process.stderr.write(`FAIL ${id} ${name}: ${message}\n`);
    throw error;
  }
}

async function workbook(): Promise<Buffer> {
  const fixtures = JSON.parse(await readFile(path.resolve('../../fixtures/uat/backend-v1-portfolio-10.json'), 'utf8')) as Json[];
  expect(fixtures.length === 10, 'UAT fixture must contain exactly 10 positions.');
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Backend V1 UAT');
  sheet.addRow(['作品名称', '艺术家', '品类', '名义价值', '基础价值', '流动性', '流动性折价', '交易成本率', '艺术家预期收益率', '币种', '数据来源', '数据日期']);
  for (const item of fixtures) sheet.addRow([
    item.artworkName, item.artistName, item.category, Number(item.nominalValue), Number(item.baseValue),
    item.liquidityLevel, Number(item.liquidityDiscount), Number(item.transactionCostRate),
    Number(item.artistExpectedReturn), item.currency, item.dataSource, item.dataDate,
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function waitJob(jobId: string): Promise<Json> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const { body } = await api(`/api/v1/artscape/jobs/${jobId}`, {}, 200);
    if (body.data.status === 'succeeded') return body.data;
    if (body.data.status === 'failed') throw new Error(`Job ${jobId} failed: ${body.data.error}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Job ${jobId} timed out.`);
}

async function main(): Promise<void> {
  const xlsx = await workbook();
  const outputDir = path.resolve('../../output/uat');
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'backend-v1-portfolio-10.xlsx'), xlsx);

  await runCase('UAT-01', '部署、健康、版本和 OpenAPI', async () => {
    const live = await api('/health/live', {}, 200, '');
    const ready = await api('/health/ready', {}, 200, '');
    const status = await api('/api/v1/artscape/status', {}, 200);
    const spec = await api('/api/v1/artscape/openapi.json', {}, 200);
    expect(live.body.version === '1.0.0', 'Live endpoint is not Backend V1.');
    expect(ready.body.ok === true, 'Readiness failed.');
    expect(status.body.data.persistence === 'mongo', 'Mongo persistence is not active.');
    expect(spec.body.info.version === '1.0.0', 'OpenAPI is not V1.');
    return { version: live.body.version, persistence: status.body.data.persistence, openapi: spec.body.info.version };
  });

  await runCase('UAT-02', 'JWT、RBAC 和身份防伪', async () => {
    await api('/api/v1/artscape/status', {}, 401, '');
    await api('/api/v1/artscape/status', {}, 200, viewerToken);
    const denied = await api('/api/v1/artscape/sessions', { method: 'POST', body: JSON.stringify({ title: 'forbidden' }) }, 403, viewerToken);
    const session = await api('/api/v1/artscape/sessions', { method: 'POST', body: JSON.stringify({ title: 'Backend V1 UAT', userId: 'spoofed' }) }, 400);
    expect(session.body.error.code === 'VALIDATION_ERROR', 'Strict request validation did not reject spoofed body field.');
    return { unauthenticated: 401, viewerWrite: denied.response.status, spoofedUserField: session.response.status };
  });

  await runCase('UAT-03', 'Session、Message 与真实 DeepSeek 意图路由', async () => {
    const created = await api('/api/v1/artscape/sessions', { method: 'POST', body: JSON.stringify({ title: '真实 DeepSeek 会话' }) }, 201);
    ids.sessionId = created.body.data.id;
    const sent = await api(`/api/v1/artscape/sessions/${ids.sessionId}/messages`, {
      method: 'POST', body: JSON.stringify({ content: '请为已确认的艺术品组合运行熊市场景风险分析' }),
    }, 201);
    const provider = sent.body.data.userMessage.metadata.intentProvider;
    expect(provider === 'deepseek-intent-router', `Expected DeepSeek intent provider, got ${provider}`);
    const messages = await api(`/api/v1/artscape/sessions/${ids.sessionId}/messages`, {}, 200);
    expect(messages.body.data.length === 2, 'Session message persistence failed.');
    return { sessionId: ids.sessionId, intent: sent.body.data.userMessage.intent, provider, messages: 2 };
  });

  await runCase('UAT-04', '10 条 XLSX、BullMQ 异步导入与幂等', async () => {
    const form = new FormData();
    form.set('portfolioName', 'Backend V1 十件艺术品组合');
    form.set('idempotencyKey', 'uat-v1-import-0001');
    form.set('file', new Blob([xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'backend-v1-portfolio-10.xlsx');
    const submitted = await api('/api/v1/artscape/imports', { method: 'POST', body: form }, 202);
    ids.importJobId = submitted.body.data.job.id;
    const job = await waitJob(ids.importJobId);
    expect(job.output.status === 'completed', 'Governed import Run did not complete.');
    ids.importId = job.output.data.importId;
    const imported = await api(`/api/v1/artscape/imports/${ids.importId}`, {}, 200);
    expect(imported.body.data.positions.length === 10, 'Import did not contain 10 positions.');
    const duplicateForm = new FormData();
    duplicateForm.set('portfolioName', 'Backend V1 十件艺术品组合');
    duplicateForm.set('idempotencyKey', 'uat-v1-import-0001');
    duplicateForm.set('file', new Blob([xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'backend-v1-portfolio-10.xlsx');
    const duplicate = await api('/api/v1/artscape/imports', { method: 'POST', body: duplicateForm }, 202);
    expect(duplicate.body.data.job.id === ids.importJobId, 'Async idempotency did not reuse the Job.');
    return { rows: 10, jobId: ids.importJobId, importId: ids.importId, idempotent: true };
  });

  await runCase('UAT-05', '人工确认不可变 V1 与 Owner 隔离', async () => {
    const confirmed = await api(`/api/v1/artscape/imports/${ids.importId}/confirm`, {
      method: 'POST', body: JSON.stringify({ approved: true, idempotencyKey: 'uat-v1-confirm-0001' }),
    }, 200);
    ids.portfolioId = confirmed.body.data.portfolio.id;
    ids.versionId = confirmed.body.data.version.id;
    expect(confirmed.body.data.version.versionNo === 1, 'Confirmed version is not V1.');
    const foreign = jwt.sign({ roles: ['portfolio-owner'] }, jwtSecret, { subject: 'foreign-user', issuer: process.env.JWT_ISSUER ?? 'artscape', audience: process.env.JWT_AUDIENCE ?? 'artscape-api', expiresIn: '5m' });
    await api(`/api/v1/artscape/portfolios/${ids.portfolioId}`, {}, 404, foreign);
    return { portfolioId: ids.portfolioId, versionId: ids.versionId, versionNo: 1, isolated: true };
  });

  await runCase('UAT-06', '三情景、风险规则与真实 DeepSeek 解释', async () => {
    const calculated = await api(`/api/v1/artscape/portfolios/${ids.portfolioId}/scenario-runs`, {
      method: 'POST', body: JSON.stringify({ portfolioVersionId: ids.versionId, idempotencyKey: 'uat-v1-scenario-0001' }),
    }, 201);
    const analysis = calculated.body.data.analysis;
    ids.scenarioRunId = analysis.id;
    expect(analysis.scenarios.length === 3, 'Scenario count is not three.');
    expect(analysis.explanation.provider === 'deepseek', `Expected DeepSeek explanation, got ${analysis.explanation.provider}`);
    expect(analysis.explanation.fallback === false, 'DeepSeek explanation fell back.');
    return { scenarioRunId: ids.scenarioRunId, scenarios: analysis.scenarios.map((item: Json) => item.definition.code), provider: analysis.explanation.provider, fallback: false, calculationHash: analysis.calculationHash };
  });

  await runCase('UAT-07', '候选方案、人工决策、不可变 V2 与版本对比', async () => {
    const generated = await api(`/api/v1/artscape/scenario-runs/${ids.scenarioRunId}/candidate-proposals`, {
      method: 'POST', body: JSON.stringify({ idempotencyKey: 'uat-v1-candidate-0001' }),
    }, 201);
    ids.proposalId = generated.body.data.proposal.id;
    const decided = await api(`/api/v1/artscape/candidate-proposals/${ids.proposalId}/decisions`, {
      method: 'POST', body: JSON.stringify({ decision: 'accepted', idempotencyKey: 'uat-v1-decision-0001' }),
    }, 200);
    ids.version2Id = decided.body.data.proposal.confirmedVersionId;
    ids.comparisonId = decided.body.data.comparison.id;
    ids.afterScenarioRunId = decided.body.data.comparison.afterScenarioRunId;
    expect(decided.body.data.proposal.validation.totalPreserved === true, 'Candidate did not preserve total value.');
    const comparison = await api(`/api/v1/artscape/comparisons/${ids.comparisonId}`, {}, 200);
    return { proposalId: ids.proposalId, version2Id: ids.version2Id, comparisonId: ids.comparisonId, deltas: comparison.body.data.scenarioDeltas.length };
  });

  await runCase('UAT-08', 'BullMQ 报告任务、MinIO JSON/PDF 与快照哈希', async () => {
    const submitted = await api('/api/v1/artscape/reports', {
      method: 'POST', body: JSON.stringify({ portfolioVersionId: ids.version2Id, scenarioRunId: ids.afterScenarioRunId, comparisonId: ids.comparisonId, idempotencyKey: 'uat-v1-report-0001' }),
    }, 202);
    ids.reportJobId = submitted.body.data.job.id;
    const job = await waitJob(ids.reportJobId);
    expect(job.output.status === 'completed', 'Report governed Run did not complete.');
    ids.reportId = job.output.data.reportId;
    ids.reportRunId = job.output.runId;
    const report = await api(`/api/v1/artscape/reports/${ids.reportId}`, {}, 200);
    const jsonArtifact = await api(`/api/v1/artscape/artifacts/${report.body.data.jsonArtifact.id}`, {}, 200);
    const pdfArtifact = await api(`/api/v1/artscape/artifacts/${report.body.data.pdfArtifact.id}`, {}, 200);
    expect(Buffer.isBuffer(pdfArtifact.body) && pdfArtifact.body.subarray(0, 4).toString() === '%PDF', 'Stored PDF is invalid.');
    const storedJson = Buffer.isBuffer(jsonArtifact.body)
      ? JSON.parse(jsonArtifact.body.toString())
      : jsonArtifact.body;
    expect(storedJson?.schemaVersion === '1.0.0', 'Stored JSON report is invalid.');
    return { reportId: ids.reportId, reportJobId: ids.reportJobId, snapshotHash: report.body.data.snapshotHash, pdfBytes: pdfArtifact.body.length, jsonBytes: Buffer.byteLength(JSON.stringify(storedJson)) };
  });

  await runCase('UAT-09', '同 Run FSM 暂停/恢复、拒绝、取消、事件与回放', async () => {
    const taskInput = { fileName: 'fsm-10.xlsx', portfolioName: 'FSM UAT 组合', fileBase64: xlsx.toString('base64') };
    const started = await api('/api/v1/artscape/tasks', { method: 'POST', body: JSON.stringify({ taskType: 'task.art-portfolio-intake', input: taskInput, idempotencyKey: 'uat-v1-fsm-0001' }) }, 201);
    ids.workflowRunId = started.body.data.id;
    expect(started.body.data.status === 'waiting_human', 'FSM did not pause for human review.');
    const approved = await api(`/api/v1/artscape/runs/${ids.workflowRunId}/approve`, { method: 'POST', body: '{}' }, 200);
    expect(approved.body.data.id === ids.workflowRunId && approved.body.data.status === 'completed', 'FSM did not resume the same Run.');
    const events = await api(`/api/v1/artscape/runs/${ids.workflowRunId}/events`, {}, 200);
    const audit = await api(`/api/v1/artscape/runs/${ids.workflowRunId}/audit`, {}, 200);
    const replay = await api(`/api/v1/artscape/runs/${ids.workflowRunId}/replay`, {}, 200);
    const regression = await api(`/api/v1/artscape/runs/${ids.workflowRunId}/regression`, {}, 200);
    expect(events.body.data.some((event: Json) => event.type === 'human.review.approved'), 'Approval event missing.');
    return { runId: ids.workflowRunId, states: approved.body.data.statePath, events: events.body.data.length, audit: Boolean(audit.body.data), replay: Boolean(replay.body.data), regression: Boolean(regression.body.data) };
  });

  await runCase('UAT-10', '运维指标、Job 查询、上传防护和发布总检', async () => {
    const metrics = await api('/metrics', {}, 200, '');
    expect(Buffer.isBuffer(metrics.body) && metrics.body.toString().includes('artscape_http_requests_total'), 'Prometheus metrics missing.');
    const jobs = await api('/api/v1/artscape/jobs', {}, 200);
    expect(jobs.body.data.some((job: Json) => job.id === ids.importJobId), 'Import Job missing.');
    expect(jobs.body.data.some((job: Json) => job.id === ids.reportJobId), 'Report Job missing.');
    const invalid = new FormData();
    invalid.set('portfolioName', '非法文件'); invalid.set('idempotencyKey', 'uat-invalid-0001');
    invalid.set('file', new Blob(['not-an-xlsx'], { type: 'application/octet-stream' }), 'malware.xlsx');
    const rejected = await api('/api/v1/artscape/imports', { method: 'POST', body: invalid }, 415);
    return { metrics: true, jobs: jobs.body.data.length, invalidUpload: rejected.body.error.code, backendVersion: '1.0.0' };
  });

  const finishedAt = new Date().toISOString();
  const report = {
    schemaVersion: '1.0.0', release: 'ArtScape Backend V1.0.0', baseUrl,
    finishedAt, provider: 'DeepSeek', model: process.env.OPENAI_MODEL ?? 'deepseek-chat',
    secretPersisted: false, samples: 10, cases: results,
    summary: { passed: results.filter((item) => item.status === 'passed').length, failed: results.filter((item) => item.status === 'failed').length },
  };
  await writeFile(path.join(outputDir, 'backend-v1-uat.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(outputDir, 'backend-v1-uat.md'), [
    '# ArtScape Backend V1 UAT', '', `- 完成时间：${finishedAt}`, '- 输入：10 件艺术品',
    `- DeepSeek 模型：${report.model}`, `- 结果：${report.summary.passed}/${results.length} 通过`, '',
    '| ID | 场景 | 结果 | 耗时(ms) |', '|---|---|---:|---:|',
    ...results.map((item) => `| ${item.id} | ${item.name} | ${item.status} | ${item.durationMs} |`), '',
    '详细证据见 `backend-v1-uat.json`。API 密钥未写入任何输出。', '',
  ].join('\n'));
  expect(report.summary.failed === 0 && report.summary.passed === 10, 'UAT did not pass all ten cases.');
}

main().catch(async (error) => {
  const outputDir = path.resolve('../../output/uat');
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'backend-v1-uat.failed.json'), `${JSON.stringify({ failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error), cases: results }, null, 2)}\n`);
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
