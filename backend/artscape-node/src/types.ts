export type ScenarioCode = 'bull' | 'neutral' | 'bear';
export type LiquidityLevel = 'high' | 'medium' | 'low';
export type DecisionStatus = 'pending' | 'accepted' | 'modified' | 'rejected';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface EntityBase {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ArtPositionInput {
  artworkName: string;
  artistName: string;
  category: string;
  nominalValue: string;
  baseValue: string;
  liquidityLevel: LiquidityLevel;
  liquidityDiscount: string;
  transactionCostRate: string;
  artistExpectedReturn: string;
  dataCompleteness: string;
  currency: 'CNY';
  dataSource?: string;
  dataDate?: string;
}

export interface ArtPosition extends ArtPositionInput {
  id: string;
  sourceRow: number;
}

export interface ImportIssue {
  row?: number;
  field?: string;
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface PortfolioImport extends EntityBase {
  fileName: string;
  status: 'parsed' | 'needs_correction' | 'awaiting_confirmation' | 'confirmed';
  detectedColumns: string[];
  positions: ArtPosition[];
  issues: ImportIssue[];
  portfolioName: string;
  confirmedVersionId?: string;
  rawArtifactRef?: string;
}

export interface Portfolio extends EntityBase {
  name: string;
  activeVersionId?: string;
}

export interface PortfolioVersion extends EntityBase {
  portfolioId: string;
  versionNo: number;
  parentVersionId?: string;
  status: 'confirmed' | 'superseded';
  source: 'import' | 'candidate';
  sourceRef: string;
  totalNominalValue: string;
  positions: ArtPosition[];
  calculationHash: string;
  confirmedAt: string;
}

export interface ScenarioDefinition {
  code: ScenarioCode;
  name: string;
  horizonYears: 3;
  marketReturn: string;
  version: string;
}

export interface ScenarioParameterSet {
  id: string;
  version: string;
  effectiveFrom: string;
  horizonYears: 3;
  currency: 'CNY';
  roundingMode: 'HALF_UP';
  moneyScale: 2;
  ratioScale: 6;
  source: string;
  definitions: ScenarioDefinition[];
}

export interface PositionScenarioResult {
  positionId: string;
  artworkName: string;
  artistName: string;
  nominalValue: string;
  theoreticalValue: string;
  realizableValue: string;
  gainLoss: string;
  returnRate: string;
}

export interface RiskMetrics {
  maxArtistConcentration: string;
  maxArtistName?: string;
  lowLiquidityRatio: string;
  completenessRatio: string;
  bearLossRate?: string;
}

export interface ThresholdBreach {
  code: 'artist_concentration' | 'low_liquidity' | 'bear_loss';
  actual: string;
  threshold: string;
  severity: 'warning' | 'high';
  message: string;
}

export interface ScenarioResult {
  definition: ScenarioDefinition;
  positions: PositionScenarioResult[];
  portfolio: {
    nominalValue: string;
    theoreticalValue: string;
    realizableValue: string;
    gainLoss: string;
    returnRate: string;
  };
}

export interface ExplanationResult {
  provider: string;
  generatedAt: string;
  summary: string;
  observations: string[];
  caveats: string[];
  fallback: boolean;
}

export interface ScenarioRun extends EntityBase {
  portfolioId: string;
  portfolioVersionId: string;
  status: 'completed' | 'failed';
  scenarios: ScenarioResult[];
  riskMetrics: RiskMetrics;
  breaches: ThresholdBreach[];
  explanation: ExplanationResult;
  calculationHash: string;
  runId: string;
}

export interface AllocationChange {
  positionId: string;
  artworkName: string;
  artistName: string;
  beforeNominalValue: string;
  afterNominalValue: string;
  delta: string;
  reason: string;
}

export interface CandidateValidation {
  valid: boolean;
  totalPreserved: boolean;
  nonNegative: boolean;
  violations: string[];
}

export interface CandidateProposal extends EntityBase {
  portfolioId: string;
  baseVersionId: string;
  scenarioRunId: string;
  status: DecisionStatus;
  proposedPositions: ArtPosition[];
  changes: AllocationChange[];
  validation: CandidateValidation;
  explanation: string;
  confirmedVersionId?: string;
  comparisonId?: string;
  decidedAt?: string;
}

export interface VersionComparison extends EntityBase {
  portfolioId: string;
  beforeVersionId: string;
  afterVersionId: string;
  beforeScenarioRunId: string;
  afterScenarioRunId: string;
  scenarioDeltas: Array<{
    scenario: ScenarioCode;
    beforeRealizableValue: string;
    afterRealizableValue: string;
    delta: string;
  }>;
  riskBefore: RiskMetrics;
  riskAfter: RiskMetrics;
}

export interface ArtifactReference {
  id: string;
  kind: 'raw_import' | 'report_json' | 'report_pdf';
  path: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
}

export interface ReportRecord extends EntityBase {
  portfolioId: string;
  portfolioVersionId: string;
  scenarioRunId: string;
  comparisonId?: string;
  status: 'completed' | 'failed';
  snapshotHash: string;
  jsonArtifact: ArtifactReference;
  pdfArtifact: ArtifactReference;
  runId: string;
}

export interface JobRecord extends EntityBase {
  type: 'portfolio_import' | 'report_export';
  status: JobStatus;
  progress: number;
  input: unknown;
  output?: unknown;
  error?: string;
  idempotencyKey?: string;
}

export interface WorkflowRunRecord extends EntityBase {
  sessionId: string;
  taskType: string;
  workflowId: string;
  status: 'running' | 'waiting_human' | 'completed' | 'failed' | 'cancelled';
  currentState: string;
  statePath: string[];
  input: Record<string, unknown>;
  stateData: Record<string, unknown>;
  fsmSnapshot: unknown;
  pendingReview?: {
    stateId: string;
    reason: string;
    requestedAt: string;
  };
  output?: unknown;
  error?: string;
}

export type AgentIntent =
  | 'portfolio_intake'
  | 'scenario_analysis'
  | 'candidate_comparison'
  | 'report_export'
  | 'unknown';

export interface AgentSession extends EntityBase {
  title?: string;
  status: 'active' | 'archived';
  activeRunId?: string;
}

export interface AgentMessage extends EntityBase {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  intent?: AgentIntent;
  runId?: string;
  metadata?: Record<string, unknown>;
}

export interface ArtScapeState {
  imports: PortfolioImport[];
  portfolios: Portfolio[];
  versions: PortfolioVersion[];
  scenarioRuns: ScenarioRun[];
  candidates: CandidateProposal[];
  comparisons: VersionComparison[];
  reports: ReportRecord[];
  jobs: JobRecord[];
  workflowRuns: WorkflowRunRecord[];
  sessions: AgentSession[];
  messages: AgentMessage[];
}

export interface RunEnvelope<T> {
  runId: string;
  status: 'completed' | 'human_review_required' | 'failed';
  data?: T;
  approval?: {
    invocationId: string;
    reason?: string;
  };
  error?: string;
}
