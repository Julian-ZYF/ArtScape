import {
  FSMRuntime,
  type FSMSnapshot,
  type FSMStateEnteredRecord,
  type StateTransition,
} from '@hypha/fsm';
import { compileWorkflowToFSM, type WorkflowSpec } from '@hypha/domain';
import { type RunExecutionContext, RunManager } from '@hypha/harness';
import type { ToolCallResult } from '@hypha/tools';
import { artScapeDomainPack } from '../domain-pack';
import type { ArtScapeRepository } from '../repositories/artscape-repository';
import { ARTSCAPE_TOOL_IDS } from '../tools';
import type { WorkflowRunRecord } from '../types';
import { AppError, requireFound } from '../utils/errors';
import { createId } from '../utils/id';

export type WorkflowToolInvoker = (input: {
  toolId: string;
  toolInput: Record<string, unknown>;
  context: RunExecutionContext;
  idempotencyKey: string;
  approveWrite: boolean;
}) => Promise<ToolCallResult>;

export interface StartWorkflowInput {
  userId: string;
  sessionId?: string;
  taskType: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
}

export class ArtScapeWorkflowExecutor {
  constructor(
    private readonly repository: ArtScapeRepository,
    private readonly runManager: RunManager,
    private readonly invokeTool: WorkflowToolInvoker
  ) {}

  async start(input: StartWorkflowInput): Promise<WorkflowRunRecord> {
    const task = requireFound(
      artScapeDomainPack.taskSchemas.find((candidate) => candidate.taskType === input.taskType),
      `Unsupported task type: ${input.taskType}`
    );
    const workflowId = requireFound(task.defaultWorkflowRef, 'Task has no default workflow.');
    const workflow = this.workflow(workflowId);
    const fsm = compileWorkflowToFSM(artScapeDomainPack, { workflowId });
    const runId = createId('run');
    const sessionId = input.sessionId ?? `artscape:${input.userId}`;
    await this.runManager.createSession({
      id: sessionId,
      userId: input.userId,
      domainPackRef: { id: artScapeDomainPack.id, version: artScapeDomainPack.version },
      metadata: { product: 'artscape', workflowId },
    });
    const run = await this.runManager.createRun({
      id: runId,
      sessionId,
      userId: input.userId,
      domainPackRef: { id: artScapeDomainPack.id, version: artScapeDomainPack.version },
      workflowRef: { id: workflowId, version: workflow.version },
      agentRef: { id: 'agent.artscape.portfolio', version: '1.0.0' },
      input: input.input,
    });
    await this.runManager.startRun(run);
    const timestamp = new Date().toISOString();
    const record: WorkflowRunRecord = {
      id: runId,
      userId: input.userId,
      sessionId,
      taskType: input.taskType,
      workflowId,
      status: 'running',
      currentState: fsm.initialState,
      statePath: [fsm.initialState],
      input: structuredClone(input.input),
      stateData: { ...structuredClone(input.input), idempotencyKey: input.idempotencyKey },
      fsmSnapshot: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repository.update((state) => state.workflowRuns.push(record));
    return this.execute(record, workflow, undefined, false);
  }

  async approve(userId: string, runId: string): Promise<WorkflowRunRecord> {
    const record = await this.get(userId, runId);
    if (record.status !== 'waiting_human') {
      throw new AppError('Run is not waiting for human approval.', 409, 'RUN_NOT_WAITING');
    }
    const context = this.context(record);
    await this.runManager.recordHumanReviewApproved(context, {
      stateId: record.pendingReview?.stateId,
    });
    await this.update(runId, (target) => {
      target.status = 'running';
      target.pendingReview = undefined;
    });
    return this.execute(await this.get(userId, runId), this.workflow(record.workflowId), undefined, true);
  }

  async reject(userId: string, runId: string, reason?: string): Promise<WorkflowRunRecord> {
    const record = await this.get(userId, runId);
    if (record.status !== 'waiting_human') {
      throw new AppError('Run is not waiting for human review.', 409, 'RUN_NOT_WAITING');
    }
    const workflow = this.workflow(record.workflowId);
    const runtime = this.restoreRuntime(record, workflow);
    const context = this.context(record);
    await this.runManager.recordHumanReviewRejected(context, { reason });
    await runtime.transition('failed', { userId, stepId: 'human-rejected' });
    await this.runManager.failRun(context, reason ?? 'Human review rejected.');
    return this.update(runId, (target) => {
      target.status = 'failed';
      target.currentState = 'failed';
      target.statePath = runtime.getSnapshot().statePath;
      target.fsmSnapshot = runtime.getSnapshot();
      target.pendingReview = undefined;
      target.error = reason ?? 'Human review rejected.';
    });
  }

  async cancel(userId: string, runId: string, reason?: string): Promise<WorkflowRunRecord> {
    const record = await this.get(userId, runId);
    if (record.status === 'completed' || record.status === 'failed') return record;
    await this.runManager.cancelRun(this.context(record), reason);
    return this.update(runId, (target) => {
      target.status = 'cancelled';
      target.error = reason;
    });
  }

  async retry(userId: string, runId: string): Promise<WorkflowRunRecord> {
    const record = await this.get(userId, runId);
    if (record.status !== 'failed') {
      throw new AppError('Only failed runs can be retried.', 409, 'RUN_NOT_FAILED');
    }
    return this.start({
      userId,
      sessionId: record.sessionId,
      taskType: record.taskType,
      input: record.input,
      idempotencyKey: `${String(record.stateData.idempotencyKey)}:retry:${Date.now()}`,
    });
  }

  async get(userId: string, runId: string): Promise<WorkflowRunRecord> {
    return requireFound(
      (await this.repository.read()).workflowRuns.find(
        (record) => record.id === runId && record.userId === userId
      ),
      'Workflow run not found.'
    );
  }

  private async execute(
    initial: WorkflowRunRecord,
    workflow: WorkflowSpec,
    restoredSnapshot?: FSMSnapshot,
    approveWrite = false
  ): Promise<WorkflowRunRecord> {
    let record = initial;
    const runtime = this.createRuntime(record, workflow, restoredSnapshot ?? (record.fsmSnapshot as FSMSnapshot | undefined));
    if (!record.fsmSnapshot) {
      await runtime.start({ taskType: record.taskType });
      record = await this.persistSnapshot(record.id, runtime.getSnapshot());
    }
    try {
      while (record.status === 'running') {
        const current = runtime.getSnapshot().currentState;
        const state = requireFound(workflow.states.find((candidate) => candidate.id === current), 'Workflow state missing.');
        if (state.tags?.includes('human-review') && !approveWrite) {
          await this.runManager.waitForHumanReview(this.context(record), {
            stateId: current,
            reason: 'An immutable portfolio version requires explicit confirmation.',
          });
          return this.update(record.id, (target) => {
            target.status = 'waiting_human';
            target.pendingReview = {
              stateId: current,
              reason: 'An immutable portfolio version requires explicit confirmation.',
              requestedAt: new Date().toISOString(),
            };
            target.fsmSnapshot = runtime.getSnapshot();
          });
        }

        for (const toolId of state.allowedTools ?? []) {
          const toolInput = await this.toolInput(toolId, record);
          const result = await this.invokeTool({
            toolId,
            toolInput,
            context: this.context(record),
            idempotencyKey: `${String(record.stateData.idempotencyKey)}:${toolId}`,
            approveWrite,
          });
          if (result.status !== 'completed') {
            throw new Error(
              typeof result.error === 'string'
                ? result.error
                : result.error?.message ?? `Tool failed: ${toolId}`
            );
          }
          record = await this.mergeToolOutput(record.id, toolId, result.output);
        }

        if (workflow.terminalStates.includes(current)) break;
        const transition = workflow.transitions.find(
          (candidate) => candidate.from === current && candidate.to !== 'failed'
        );
        if (!transition) throw new Error(`No successful transition from ${current}.`);
        await runtime.transition(transition.to, {
          userId: record.userId,
          stepId: transition.to,
          metadata: { workflowId: record.workflowId },
        });
        record = await this.persistSnapshot(record.id, runtime.getSnapshot());
        approveWrite = approveWrite && transition.to !== 'completed';
        if (transition.to === 'completed') {
          await this.runManager.completeRun(this.context(record), record.stateData);
          return this.update(record.id, (target) => {
            target.status = 'completed';
            target.output = structuredClone(target.stateData);
            target.fsmSnapshot = runtime.getSnapshot();
          });
        }
      }
      return record;
    } catch (error) {
      const current = runtime.getSnapshot().currentState;
      const failure = workflow.transitions.find(
        (candidate) => candidate.from === current && candidate.to === 'failed'
      );
      if (failure) await runtime.transition('failed', { userId: record.userId, stepId: 'failed' });
      await this.runManager.failRun(this.context(record), error);
      return this.update(record.id, (target) => {
        target.status = 'failed';
        target.currentState = runtime.getSnapshot().currentState;
        target.statePath = runtime.getSnapshot().statePath;
        target.fsmSnapshot = runtime.getSnapshot();
        target.error = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private createRuntime(
    record: WorkflowRunRecord,
    workflow: WorkflowSpec,
    snapshot?: FSMSnapshot
  ): FSMRuntime {
    const fsm = compileWorkflowToFSM(artScapeDomainPack, { workflowId: workflow.id });
    return new FSMRuntime(
      fsm,
      record.id,
      {
        onTransition: async (transition: StateTransition) => {
          await this.runManager.recordTransitionAccepted(this.context(record), transition);
        },
        onStateEntered: async (entered: FSMStateEnteredRecord) => {
          await this.runManager.recordStateEntered(this.context(record), entered);
        },
      },
      snapshot
    );
  }

  private restoreRuntime(record: WorkflowRunRecord, workflow: WorkflowSpec): FSMRuntime {
    return this.createRuntime(record, workflow, record.fsmSnapshot as FSMSnapshot);
  }

  private workflow(workflowId: string): WorkflowSpec {
    return requireFound(
      artScapeDomainPack.workflows.find((candidate) => candidate.id === workflowId),
      `Workflow not found: ${workflowId}`
    );
  }

  private context(record: WorkflowRunRecord): RunExecutionContext {
    return {
      runId: record.id,
      sessionId: record.sessionId,
      userId: record.userId,
      agentId: 'agent.artscape.portfolio',
    };
  }

  private async toolInput(toolId: string, record: WorkflowRunRecord): Promise<Record<string, unknown>> {
    const data = record.stateData;
    switch (toolId) {
      case ARTSCAPE_TOOL_IDS.parseExcel:
        return pick(data, ['userId', 'fileName', 'portfolioName', 'fileBase64'], record.userId);
      case ARTSCAPE_TOOL_IDS.validatePortfolio:
      case ARTSCAPE_TOOL_IDS.confirmVersion:
        return { userId: record.userId, importId: data.importId };
      case ARTSCAPE_TOOL_IDS.calculateScenario:
        return {
          userId: record.userId,
          portfolioVersionId: data.portfolioVersionId ?? data.versionId,
        };
      case ARTSCAPE_TOOL_IDS.calculateRisk:
      case ARTSCAPE_TOOL_IDS.generateCandidate:
        return { userId: record.userId, scenarioRunId: data.scenarioRunId };
      case ARTSCAPE_TOOL_IDS.confirmCandidate:
        return { userId: record.userId, proposalId: data.proposalId, decision: 'accepted' };
      case ARTSCAPE_TOOL_IDS.compareVersions:
        return { userId: record.userId, comparisonId: data.comparisonId };
      case ARTSCAPE_TOOL_IDS.buildReportJson:
        return pick(data, ['userId', 'portfolioVersionId', 'scenarioRunId', 'comparisonId'], record.userId);
      case ARTSCAPE_TOOL_IDS.renderReportPdf:
        return pick(
          data,
          ['userId', 'portfolioVersionId', 'scenarioRunId', 'comparisonId', 'snapshotHash', 'report'],
          record.userId
        );
      default:
        throw new Error(`No workflow input mapper for ${toolId}.`);
    }
  }

  private async mergeToolOutput(runId: string, toolId: string, output: unknown): Promise<WorkflowRunRecord> {
    return this.update(runId, (target) => {
      if (output && typeof output === 'object') Object.assign(target.stateData, output);
      if (toolId === ARTSCAPE_TOOL_IDS.confirmCandidate && target.stateData.proposalId) {
        // comparison/version references are loaded below after the repository write has completed.
      }
    }).then(async (record) => {
      if (toolId !== ARTSCAPE_TOOL_IDS.confirmCandidate) return record;
      const state = await this.repository.read();
      const proposal = state.candidates.find((candidate) => candidate.id === record.stateData.proposalId);
      if (!proposal) return record;
      return this.update(runId, (target) => {
        target.stateData.comparisonId = proposal.comparisonId;
        target.stateData.portfolioVersionId = proposal.confirmedVersionId;
      });
    });
  }

  private async persistSnapshot(runId: string, snapshot: FSMSnapshot): Promise<WorkflowRunRecord> {
    return this.update(runId, (target) => {
      target.currentState = snapshot.currentState;
      target.statePath = [...snapshot.statePath];
      target.fsmSnapshot = snapshot;
    });
  }

  private async update(
    runId: string,
    mutate: (record: WorkflowRunRecord) => void
  ): Promise<WorkflowRunRecord> {
    return this.repository.update((state) => {
      const record = requireFound(
        state.workflowRuns.find((candidate) => candidate.id === runId),
        'Workflow run not found.'
      );
      mutate(record);
      record.updatedAt = new Date().toISOString();
      return record;
    });
  }
}

function pick(
  data: Record<string, unknown>,
  keys: string[],
  userId: string
): Record<string, unknown> {
  return Object.fromEntries(
    keys
      .map((key) => [key, key === 'userId' ? userId : data[key]])
      .filter(([, value]) => value !== undefined)
  );
}
