import type { JsonSchema, OutputContractSpec, PolicySpec } from '@hypha/core';
import {
  type DomainPackSpec,
  type TaskSchemaSpec,
  type WorkflowSpec,
  validateDomainPackSpec,
} from '@hypha/domain';
import { ARTSCAPE_POLICY_IDS } from './tooling/tool-policy';
import { ARTSCAPE_TOOL_IDS, artScapeToolSpecs } from './tools';

const VERSION = '1.0.0';
const strictObject = (
  properties: Record<string, JsonSchema>,
  required: string[] = Object.keys(properties)
): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const id = { type: 'string', minLength: 1 };

const outputContracts: OutputContractSpec[] = [
  {
    id: 'output.art-portfolio-intake.v1',
    version: VERSION,
    schema: strictObject({
      importId: id,
      status: { type: 'string' },
      detectedColumns: { type: 'array', items: { type: 'string' } },
      issues: { type: 'array', items: { type: 'object' } },
      positions: { type: 'array', items: { type: 'object' } },
      confirmationRequired: { type: 'boolean' },
    }),
  },
  {
    id: 'output.art-scenario-analysis.v1',
    version: VERSION,
    schema: strictObject({
      scenarioRunId: id,
      portfolioVersionId: id,
      scenarios: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object' } },
      riskMetrics: { type: 'object' },
      breaches: { type: 'array', items: { type: 'object' } },
      explanation: { type: 'object' },
      calculationHash: id,
    }),
  },
  {
    id: 'output.art-candidate-comparison.v1',
    version: VERSION,
    schema: strictObject({
      proposalId: id,
      status: { type: 'string' },
      validation: { type: 'object' },
      changes: { type: 'array', items: { type: 'object' } },
      comparisonId: id,
    }, ['proposalId', 'status', 'validation', 'changes']),
  },
  {
    id: 'output.art-report-export.v1',
    version: VERSION,
    schema: strictObject({
      reportId: id,
      snapshotHash: id,
      jsonArtifact: { type: 'object' },
      pdfArtifact: { type: 'object' },
    }),
  },
];

const taskSchemas: TaskSchemaSpec[] = [
  {
    id: 'task-schema.art-portfolio-intake',
    version: VERSION,
    taskType: 'task.art-portfolio-intake',
    inputSchema: strictObject({ userId: id, fileName: id, portfolioName: id }),
    outputContractRef: 'output.art-portfolio-intake.v1',
    defaultWorkflowRef: 'workflow.art-portfolio-intake',
    riskProfile: { defaultRiskLevel: 'medium' },
  },
  {
    id: 'task-schema.art-scenario-analysis',
    version: VERSION,
    taskType: 'task.art-scenario-analysis',
    inputSchema: strictObject({ userId: id, portfolioVersionId: id }),
    outputContractRef: 'output.art-scenario-analysis.v1',
    defaultWorkflowRef: 'workflow.art-scenario-analysis',
    riskProfile: { defaultRiskLevel: 'medium' },
  },
  {
    id: 'task-schema.art-candidate-comparison',
    version: VERSION,
    taskType: 'task.art-candidate-comparison',
    inputSchema: strictObject({ userId: id, scenarioRunId: id }),
    outputContractRef: 'output.art-candidate-comparison.v1',
    defaultWorkflowRef: 'workflow.art-candidate-comparison',
    riskProfile: { defaultRiskLevel: 'high' },
  },
  {
    id: 'task-schema.art-report-export',
    version: VERSION,
    taskType: 'task.art-report-export',
    inputSchema: strictObject({ userId: id, portfolioVersionId: id, scenarioRunId: id }),
    outputContractRef: 'output.art-report-export.v1',
    defaultWorkflowRef: 'workflow.art-report-export',
    riskProfile: { defaultRiskLevel: 'medium' },
  },
];

function workflow(
  idValue: string,
  states: Array<{
    id: string;
    goal: string;
    tools?: string[];
    review?: boolean;
  }>
): WorkflowSpec {
  return {
    id: idValue,
    version: VERSION,
    initialState: states[0]!.id,
    terminalStates: ['completed', 'failed'],
    states: [
      ...states.map((state) => ({
        id: state.id,
        goal: state.goal,
        allowedTools: state.tools,
        permissionScopes: state.tools?.length ? ['artscape:read', 'artscape:write'] : undefined,
        policyRefs: [ARTSCAPE_POLICY_IDS.governed],
        tags: state.review ? ['human-review'] : undefined,
        humanReviewRef: state.review ? 'review.artscape.portfolio-owner' : undefined,
        timeoutMs: 60_000,
      })),
      { id: 'completed', goal: 'Produce contract-valid output.' },
      { id: 'failed', goal: 'Preserve an auditable failure result.' },
    ],
    transitions: [
      ...states.slice(1).map((state, index) => ({
        from: states[index]!.id,
        to: state.id,
      })),
      { from: states.at(-1)!.id, to: 'completed' },
      ...states.map((state) => ({ from: state.id, to: 'failed' })),
    ],
  };
}

const workflows: WorkflowSpec[] = [
  workflow('workflow.art-portfolio-intake', [
    { id: 'received', goal: 'Receive the uploaded workbook.' },
    { id: 'parsing', goal: 'Parse spreadsheet rows.', tools: [ARTSCAPE_TOOL_IDS.parseExcel] },
    {
      id: 'validating',
      goal: 'Validate every position.',
      tools: [ARTSCAPE_TOOL_IDS.validatePortfolio],
    },
    { id: 'awaiting_human_confirmation', goal: 'Wait for explicit confirmation.', review: true },
    {
      id: 'persisting_v1',
      goal: 'Persist immutable V1.',
      tools: [ARTSCAPE_TOOL_IDS.confirmVersion],
    },
  ]),
  workflow('workflow.art-scenario-analysis', [
    { id: 'loading_portfolio', goal: 'Load an immutable version.' },
    {
      id: 'calculating_scenarios',
      goal: 'Calculate all three scenarios.',
      tools: [ARTSCAPE_TOOL_IDS.calculateScenario],
    },
    {
      id: 'calculating_risks',
      goal: 'Calculate deterministic risks.',
      tools: [ARTSCAPE_TOOL_IDS.calculateRisk],
    },
    { id: 'generating_explanation', goal: 'Generate constrained explanation.' },
  ]),
  workflow('workflow.art-candidate-comparison', [
    { id: 'evaluating_thresholds', goal: 'Evaluate deterministic thresholds.' },
    {
      id: 'generating_candidate',
      goal: 'Generate a value-preserving candidate.',
      tools: [ARTSCAPE_TOOL_IDS.generateCandidate],
    },
    { id: 'validating_constraints', goal: 'Validate candidate constraints.' },
    { id: 'awaiting_human_confirmation', goal: 'Wait for explicit confirmation.', review: true },
    {
      id: 'persisting_v2',
      goal: 'Persist immutable V2.',
      tools: [ARTSCAPE_TOOL_IDS.confirmCandidate],
    },
    {
      id: 'comparing_versions',
      goal: 'Compare V1 and V2.',
      tools: [ARTSCAPE_TOOL_IDS.compareVersions],
    },
  ]),
  workflow('workflow.art-report-export', [
    { id: 'freezing_snapshot', goal: 'Freeze referenced version and calculations.' },
    {
      id: 'building_json',
      goal: 'Build contract-valid JSON.',
      tools: [ARTSCAPE_TOOL_IDS.buildReportJson],
    },
    { id: 'validating_output', goal: 'Validate report output contract.' },
    {
      id: 'rendering_and_storing',
      goal: 'Render and store JSON/PDF artifacts.',
      tools: [ARTSCAPE_TOOL_IDS.renderReportPdf],
    },
  ]),
];

const governedPolicy: PolicySpec = {
  id: ARTSCAPE_POLICY_IDS.governed,
  version: VERSION,
  defaultEffect: 'deny',
  rules: [
    {
      id: 'allow-none-read',
      version: VERSION,
      effect: 'allow',
      sideEffectLevels: ['none', 'read'],
    },
    {
      id: 'allow-audited-write',
      version: VERSION,
      effect: 'allow',
      sideEffectLevels: ['write'],
    },
    {
      id: 'deny-external',
      version: VERSION,
      effect: 'deny',
      sideEffectLevels: ['external_effect', 'irreversible'],
    },
  ],
};

export const artScapeDomainPack: DomainPackSpec = validateDomainPackSpec({
  id: 'domain.artscape.portfolio-sandbox',
  version: VERSION,
  name: 'ArtScape Portfolio Sandbox',
  taskSchemas,
  outputContracts,
  workflows,
  defaultWorkflow: 'workflow.art-portfolio-intake',
  tools: artScapeToolSpecs,
  policies: [governedPolicy],
  businessRules: [
    {
      id: 'rule.artscape.no-ai-pricing',
      version: VERSION,
      scope: 'domain',
      effect: 'constraint',
      expression: 'AI may explain but never create or modify portfolio prices.',
      severity: 'critical',
    },
    {
      id: 'rule.artscape.version-immutability',
      version: VERSION,
      scope: 'output',
      effect: 'postcondition',
      expression: 'Confirmed versions are immutable and V2 preserves total nominal value.',
      severity: 'critical',
    },
  ],
  evaluationProfiles: [
    {
      id: 'eval.artscape.output-contract',
      version: VERSION,
      type: 'output_contract',
      deterministic: true,
    },
    {
      id: 'eval.artscape.tool-trace',
      version: VERSION,
      type: 'tool_trace',
      deterministic: true,
    },
    {
      id: 'eval.artscape.replay',
      version: VERSION,
      type: 'regression',
      deterministic: true,
    },
  ],
  regressionCases: [
    {
      id: 'regression.artscape.mvp',
      version: VERSION,
      fixtureRefs: [{ id: 'fixture.artscape.ten-item-portfolio', version: VERSION }],
      requiredChecks: [
        'event_types',
        'state_path',
        'tool_calls',
        'policy_decisions',
        'output_contract',
      ],
    },
  ],
  metadata: {
    stage: 'MVP',
    liveMarketData: false,
    autoTrading: false,
    calculationAuthority: 'deterministic-tools-only',
  },
});
