import type { JsonSchema } from '@hypha/core';
import type { ToolSpec } from '@hypha/tools';

export const ARTSCAPE_TOOL_IDS = {
  parseExcel: 'art.portfolio.parse_excel',
  validatePortfolio: 'art.portfolio.validate',
  confirmVersion: 'art.portfolio.confirm_version',
  calculateScenario: 'art.scenario.calculate',
  calculateRisk: 'art.risk.calculate',
  generateCandidate: 'art.candidate.generate',
  confirmCandidate: 'art.candidate.confirm',
  compareVersions: 'art.version.compare',
  buildReportJson: 'art.report.build_json',
  renderReportPdf: 'art.report.render_pdf',
} as const;

const object = (
  properties: Record<string, JsonSchema>,
  required: string[] = Object.keys(properties)
): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const id = { type: 'string', minLength: 1 };
const userId = { type: 'string', minLength: 1 };

function readTool(
  idValue: string,
  description: string,
  inputSchema: JsonSchema,
  outputSchema: JsonSchema
): ToolSpec {
  return {
    id: idValue,
    version: '1.0.0',
    description,
    inputSchema,
    outputSchema,
    sideEffectLevel: 'read',
    permissionScope: ['artscape:read'],
    timeoutPolicy: { timeoutMs: 30_000, onTimeout: 'fail' },
    retryPolicy: { maxAttempts: 2, backoffMs: 100, retryableCodes: ['TOOL_TIMEOUT'] },
    auditPolicy: { enabled: true, includeInput: true, includeOutput: true },
    idempotencyPolicy: { mode: 'optional' },
  };
}

function writeTool(
  idValue: string,
  description: string,
  inputSchema: JsonSchema,
  outputSchema: JsonSchema,
  requiresApproval: boolean
): ToolSpec {
  return {
    id: idValue,
    version: '1.0.0',
    description,
    inputSchema,
    outputSchema,
    sideEffectLevel: 'write',
    permissionScope: ['artscape:write'],
    timeoutPolicy: { timeoutMs: 60_000, onTimeout: 'fail' },
    retryPolicy: { maxAttempts: 1 },
    auditPolicy: { enabled: true, includeInput: true, includeOutput: true },
    humanApprovalPolicy: requiresApproval
      ? {
          required: true,
          reason: 'Portfolio version changes require explicit user confirmation.',
          approverRole: 'portfolio-owner',
        }
      : undefined,
    idempotencyPolicy: { mode: 'required' },
  };
}

export const artScapeToolSpecs: ToolSpec[] = [
  writeTool(
    ARTSCAPE_TOOL_IDS.parseExcel,
    'Parse an uploaded portfolio Excel workbook without persisting a confirmed version.',
    object({ userId, fileName: id, portfolioName: id, fileBase64: id }),
    object({ importId: id, status: id }),
    false
  ),
  readTool(
    ARTSCAPE_TOOL_IDS.validatePortfolio,
    'Validate parsed portfolio positions against strict ArtScape contracts.',
    object({ userId, importId: id }),
    object({ valid: { type: 'boolean' }, issueCount: { type: 'integer', minimum: 0 } })
  ),
  writeTool(
    ARTSCAPE_TOOL_IDS.confirmVersion,
    'Confirm a parsed portfolio as immutable portfolio version V1.',
    object({ userId, importId: id }),
    object({ portfolioId: id, versionId: id }),
    true
  ),
  writeTool(
    ARTSCAPE_TOOL_IDS.calculateScenario,
    'Calculate deterministic three-year bull, neutral, and bear scenario values.',
    object({ userId, portfolioVersionId: id }),
    object({ scenarioRunId: id, calculationHash: id }),
    false
  ),
  readTool(
    ARTSCAPE_TOOL_IDS.calculateRisk,
    'Calculate concentration, liquidity, completeness, and bear-loss risk metrics.',
    object({ userId, scenarioRunId: id }),
    object({ scenarioRunId: id, breachCount: { type: 'integer', minimum: 0 } })
  ),
  writeTool(
    ARTSCAPE_TOOL_IDS.generateCandidate,
    'Generate a deterministic allocation candidate while preserving total nominal value.',
    object({ userId, scenarioRunId: id }),
    object({ proposalId: id, valid: { type: 'boolean' } }),
    false
  ),
  writeTool(
    ARTSCAPE_TOOL_IDS.confirmCandidate,
    'Confirm a candidate as immutable V2 and calculate its comparison with V1.',
    object(
      {
        userId,
        proposalId: id,
        decision: { type: 'string', enum: ['accepted', 'modified', 'rejected'] },
        proposedPositions: { type: 'array', items: { type: 'object' } },
      },
      ['userId', 'proposalId', 'decision']
    ),
    object({ proposalId: id, decision: id }, ['proposalId', 'decision']),
    true
  ),
  readTool(
    ARTSCAPE_TOOL_IDS.compareVersions,
    'Read a deterministic comparison between two immutable portfolio versions.',
    object({ userId, comparisonId: id }),
    object({ comparisonId: id })
  ),
  readTool(
    ARTSCAPE_TOOL_IDS.buildReportJson,
    'Build and validate a frozen JSON audit report.',
    object(
      { userId, portfolioVersionId: id, scenarioRunId: id, comparisonId: id },
      ['userId', 'portfolioVersionId', 'scenarioRunId']
    ),
    object({ snapshotHash: id, report: { type: 'object' } })
  ),
  writeTool(
    ARTSCAPE_TOOL_IDS.renderReportPdf,
    'Render validated JSON report data to audited JSON and PDF artifacts.',
    object(
      {
        userId,
        portfolioVersionId: id,
        scenarioRunId: id,
        comparisonId: id,
        snapshotHash: id,
        report: { type: 'object' },
      },
      ['userId', 'portfolioVersionId', 'scenarioRunId', 'snapshotHash', 'report']
    ),
    object({ reportId: id, jsonArtifactId: id, pdfArtifactId: id }),
    false
  ),
];
