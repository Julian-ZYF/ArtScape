import { readFile, writeFile } from 'node:fs/promises';

const baseUrl = process.env.ARTSCAPE_WEB_URL || 'http://localhost:5173';
const samplePath = new URL('../public/samples/backend-v1-portfolio-10.xlsx', import.meta.url);

const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function api(route, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${baseUrl}${route}`, { ...init, headers, signal: AbortSignal.timeout(45_000) });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('json') ? await response.json() : new Uint8Array(await response.arrayBuffer());
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${route}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function waitJob(jobId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const { data } = await api(`/api/v1/artscape/jobs/${jobId}`);
    if (data.status === 'succeeded') return data;
    if (data.status === 'failed') throw new Error(data.error || `Job ${jobId} failed.`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Job ${jobId} timed out.`);
}

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function main() {
  const health = await api('/health/ready');
  const status = await api('/api/v1/artscape/status');
  ensure(health.ok === true && status.data.version === '1.0.0', 'Backend readiness/version failed.');

  const form = new FormData();
  form.set('portfolioName', `前端完整链路 ${suffix}`);
  form.set('idempotencyKey', `web-smoke-import-${suffix}`);
  form.set('file', new Blob([await readFile(samplePath)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'backend-v1-portfolio-10.xlsx');
  const submitted = await api('/api/v1/artscape/imports', { method: 'POST', body: form });
  const importJob = await waitJob(submitted.data.job.id);
  const importId = importJob.output.data.importId;
  const imported = await api(`/api/v1/artscape/imports/${importId}`);
  ensure(imported.data.positions.length === 10, 'Frontend import did not return 10 positions.');

  const confirmed = await api(`/api/v1/artscape/imports/${importId}/confirm`, {
    method: 'POST', body: JSON.stringify({ approved: true, idempotencyKey: `web-smoke-confirm-${suffix}` }),
  });
  const portfolioId = confirmed.data.portfolio.id;
  const versionId = confirmed.data.version.id;

  const calculated = await api(`/api/v1/artscape/portfolios/${portfolioId}/scenario-runs`, {
    method: 'POST', body: JSON.stringify({ portfolioVersionId: versionId, idempotencyKey: `web-smoke-scenario-${suffix}` }),
  });
  const analysis = calculated.data.analysis;
  ensure(analysis.scenarios.length === 3, 'Frontend scenario run did not return three scenarios.');

  const candidate = await api(`/api/v1/artscape/scenario-runs/${analysis.id}/candidate-proposals`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey: `web-smoke-candidate-${suffix}` }),
  });
  const accepted = await api(`/api/v1/artscape/candidate-proposals/${candidate.data.proposal.id}/decisions`, {
    method: 'POST', body: JSON.stringify({ decision: 'accepted', idempotencyKey: `web-smoke-decision-${suffix}` }),
  });
  ensure(accepted.data.comparison.scenarioDeltas.length === 3, 'Frontend comparison did not return three deltas.');

  const reportSubmission = await api('/api/v1/artscape/reports', {
    method: 'POST',
    body: JSON.stringify({
      portfolioVersionId: accepted.data.proposal.confirmedVersionId,
      scenarioRunId: accepted.data.comparison.afterScenarioRunId,
      comparisonId: accepted.data.comparison.id,
      idempotencyKey: `web-smoke-report-${suffix}`,
    }),
  });
  const reportJob = await waitJob(reportSubmission.data.job.id);
  const report = await api(`/api/v1/artscape/reports/${reportJob.output.data.reportId}`);
  const pdf = await api(`/api/v1/artscape/artifacts/${report.data.pdfArtifact.id}`);
  ensure(String.fromCharCode(...pdf.slice(0, 4)) === '%PDF', 'Frontend PDF download is invalid.');
  if (process.env.ARTSCAPE_SMOKE_PDF_OUTPUT) {
    await writeFile(process.env.ARTSCAPE_SMOKE_PDF_OUTPUT, pdf);
  }
  const events = await api(`/api/v1/artscape/runs/${report.data.runId}/events`);
  const audit = await api(`/api/v1/artscape/runs/${report.data.runId}/audit`);

  process.stdout.write(`${JSON.stringify({
    frontend: baseUrl,
    backendVersion: status.data.version,
    importedRows: imported.data.positions.length,
    scenarios: analysis.scenarios.map((item) => item.definition.code),
    aiProvider: analysis.explanation.provider,
    proposalChanges: candidate.data.proposal.changes.length,
    comparisonDeltas: accepted.data.comparison.scenarioDeltas.length,
    reportId: report.data.id,
    pdfBytes: pdf.length,
    auditEvents: events.data.length,
    auditReady: Boolean(audit.data),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
