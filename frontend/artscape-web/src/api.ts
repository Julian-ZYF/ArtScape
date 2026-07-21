import type {
  CandidateProposal,
  JobRecord,
  Portfolio,
  PortfolioImport,
  PortfolioVersion,
  ReportRecord,
  ScenarioRun,
  VersionComparison,
} from '../../../backend/artscape-node/src/types';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
  message?: string;
}

const apiBase = '/api/v1/artscape';

function headers(init?: HeadersInit): Headers {
  const next = new Headers(init);
  const token = sessionStorage.getItem('artscape.jwt');
  if (token) next.set('authorization', `Bearer ${token}`);
  return next;
}

async function request<T>(route: string, init: RequestInit = {}): Promise<T> {
  const requestHeaders = headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    requestHeaders.set('content-type', 'application/json');
  }
  const response = await fetch(`${apiBase}${route}`, { ...init, headers: requestHeaders });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('json')
    ? (await response.json()) as ApiEnvelope<T> & ApiErrorEnvelope
    : undefined;
  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return (body as ApiEnvelope<T>).data;
}

export async function getServiceStatus(): Promise<{
  service: string;
  version: string;
  persistence: string;
  domainPack: { id: string; version: string };
}> {
  return request('/status');
}

export async function checkHealth(): Promise<boolean> {
  const response = await fetch('/health/ready');
  if (!response.ok) return false;
  const body = (await response.json()) as { ok?: boolean };
  return body.ok === true;
}

export async function importPortfolio(file: File, portfolioName: string): Promise<PortfolioImport> {
  const form = new FormData();
  form.set('portfolioName', portfolioName);
  form.set('idempotencyKey', `web-import-${crypto.randomUUID()}`);
  form.set('file', file);
  const submitted = await request<{
    job?: JobRecord;
    import?: PortfolioImport;
  }>('/imports', { method: 'POST', body: form });
  if (submitted.import) return submitted.import;
  if (!submitted.job) throw new Error('后端未返回导入任务。');
  const completed = await waitForJob(submitted.job.id);
  const output = completed.output as { data?: { importId?: string }; status?: string } | undefined;
  const importId = output?.data?.importId;
  if (!importId) throw new Error('导入任务完成，但没有返回 importId。');
  return request<PortfolioImport>(`/imports/${importId}`);
}

export async function confirmImport(importId: string): Promise<{
  runId: string;
  portfolio: Portfolio;
  version: PortfolioVersion;
}> {
  return request(`/imports/${importId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ approved: true, idempotencyKey: `web-confirm-${crypto.randomUUID()}` }),
  });
}

export async function calculateScenario(portfolioId: string, portfolioVersionId: string): Promise<{
  runId: string;
  analysis: ScenarioRun;
}> {
  return request(`/portfolios/${portfolioId}/scenario-runs`, {
    method: 'POST',
    body: JSON.stringify({
      portfolioVersionId,
      idempotencyKey: `web-scenario-${crypto.randomUUID()}`,
    }),
  });
}

export async function generateCandidate(scenarioRunId: string): Promise<{
  runId: string;
  proposal: CandidateProposal;
}> {
  return request(`/scenario-runs/${scenarioRunId}/candidate-proposals`, {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey: `web-candidate-${crypto.randomUUID()}` }),
  });
}

export async function acceptCandidate(proposalId: string): Promise<{
  runId: string;
  proposal: CandidateProposal;
  comparison: VersionComparison;
}> {
  return request(`/candidate-proposals/${proposalId}/decisions`, {
    method: 'POST',
    body: JSON.stringify({
      decision: 'accepted',
      idempotencyKey: `web-decision-${crypto.randomUUID()}`,
    }),
  });
}

export async function getScenario(scenarioRunId: string): Promise<ScenarioRun> {
  return request(`/scenario-runs/${scenarioRunId}`);
}

export async function createReport(input: {
  portfolioVersionId: string;
  scenarioRunId: string;
  comparisonId?: string;
}): Promise<ReportRecord> {
  const submitted = await request<{ job?: JobRecord; report?: ReportRecord }>('/reports', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      idempotencyKey: `web-report-${crypto.randomUUID()}`,
    }),
  });
  if (submitted.report) return submitted.report;
  if (!submitted.job) throw new Error('后端未返回报告任务。');
  const completed = await waitForJob(submitted.job.id);
  const output = completed.output as { data?: { reportId?: string }; status?: string } | undefined;
  const reportId = output?.data?.reportId;
  if (!reportId) throw new Error('报告任务完成，但没有返回 reportId。');
  return request<ReportRecord>(`/reports/${reportId}`);
}

export async function getAudit(runId: string): Promise<unknown> {
  return request(`/runs/${runId}/audit`);
}

export async function getEvents(runId: string): Promise<Array<Record<string, unknown>>> {
  return request(`/runs/${runId}/events`);
}

export async function downloadArtifact(artifactId: string, fileName: string): Promise<void> {
  const response = await fetch(`${apiBase}/artifacts/${artifactId}`, { headers: headers() });
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function waitForJob(jobId: string): Promise<JobRecord> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const job = await request<JobRecord>(`/jobs/${jobId}`);
    if (job.status === 'succeeded') return job;
    if (job.status === 'failed') throw new Error(job.error ?? '异步任务执行失败。');
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error('等待后端任务超时，请稍后重试。');
}
