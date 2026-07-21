import path from 'node:path';
import { SQLiteEventStore, FileToolRuntimeStore } from '@hypha/adapters-local';
import type { FrameworkEvent } from '@hypha/core';
import { compileWorkflowToFSM } from '@hypha/domain';
import {
  EventFirstRuntime,
  RunManager,
  type RunExecutionContext,
} from '@hypha/harness';
import {
  GovernedToolRunner,
  ToolRegistry,
  type ToolCallResult,
} from '@hypha/tools';
import { artScapeDomainPack } from '../domain-pack';
import type { ArtScapeRepository } from '../repositories/artscape-repository';
import type { RunEnvelope } from '../types';
import { createId } from '../utils/id';
import { LocalArtifactService } from '../artifacts/local-artifact-service';
import { PortfolioImportService } from '../portfolios/portfolio-import-service';
import { createExplanationProvider } from '../agent/explanation-provider';
import { ScenarioService } from '../scenarios/scenario-service';
import { CandidateService } from '../candidates/candidate-service';
import { ReportService } from '../reports/report-service';
import { JobService } from '../jobs/job-service';
import { createArtScapeToolPolicyEngine } from '../tooling/tool-policy';
import { registerArtScapeTools } from '../tooling/tool-runtime';
import { ArtScapeWorkflowExecutor } from '../workflows/workflow-executor';
import { S3ArtifactService } from '../artifacts/s3-artifact-service';
import type { ArtifactService } from '../artifacts/artifact-service';
import { createJobQueue, type JobQueuePort } from '../jobs/queue-port';
import { ConversationService } from '../agent/conversation-service';
import { AppError } from '../utils/errors';
import { ARTSCAPE_TOOL_IDS } from '../tools';

export interface InvokeToolOptions {
  userId: string;
  idempotencyKey?: string;
  approve?: boolean;
  workflowId?: string;
}

export class ArtScapeRuntime {
  readonly imports: PortfolioImportService;
  readonly scenarios: ScenarioService;
  readonly candidates: CandidateService;
  readonly reports: ReportService;
  readonly jobs: JobService;
  readonly workflows: ArtScapeWorkflowExecutor;
  readonly conversations: ConversationService;
  readonly artifacts: ArtifactService;
  readonly queue: JobQueuePort;
  private readonly runManager: RunManager;
  private readonly toolRunner: GovernedToolRunner;
  private readonly toolStore: FileToolRuntimeStore;

  constructor(
    readonly repository: ArtScapeRepository,
    dataDir = path.resolve(process.env.DATA_DIR ?? './data')
  ) {
    const eventStore = new SQLiteEventStore({
      filename: path.join(dataDir, 'events.sqlite'),
      mode: process.env.ARTSCAPE_EVENT_STORE_MODE === 'sqlite' ? 'sqlite' : 'json',
    });
    this.runManager = new RunManager({
      runtime: new EventFirstRuntime(eventStore),
    });
    this.toolStore = new FileToolRuntimeStore({
      filename: path.join(dataDir, 'tool-runtime.json'),
    });
    this.imports = new PortfolioImportService(repository);
    this.scenarios = new ScenarioService(repository, createExplanationProvider());
    this.candidates = new CandidateService(repository, this.scenarios);
    this.artifacts = process.env.S3_BUCKET
      ? new S3ArtifactService(process.env.S3_BUCKET, process.env.S3_PREFIX ?? 'artscape')
      : new LocalArtifactService(path.join(dataDir, 'artifacts'));
    this.reports = new ReportService(repository, this.artifacts);
    this.queue = createJobQueue();
    this.jobs = new JobService(repository, this.queue);
    const registry = new ToolRegistry();
    registerArtScapeTools(registry, {
      imports: this.imports,
      scenarios: this.scenarios,
      candidates: this.candidates,
      reports: this.reports,
    });
    this.toolRunner = new GovernedToolRunner(
      registry,
      eventStore,
      createArtScapeToolPolicyEngine(),
      {
        approvalStore: this.toolStore,
        invocationStore: this.toolStore,
      }
    );
    this.workflows = new ArtScapeWorkflowExecutor(
      repository,
      this.runManager,
      ({ toolId, toolInput, context, idempotencyKey, approveWrite }) =>
        this.invokeWithinRun(toolId, toolInput, context, idempotencyKey, approveWrite)
    );
    this.conversations = new ConversationService(repository, this.workflows);
    this.queue.registerProcessor(async (job) => {
      const data = job.data as {
        jobId: string;
        userId: string;
        type: 'portfolio_import' | 'report_export';
        payload: Record<string, unknown>;
        idempotencyKey: string;
      };
      return this.jobs.process(data.jobId, () => this.processQueuedJob(data));
    });

    for (const workflow of artScapeDomainPack.workflows) {
      compileWorkflowToFSM(artScapeDomainPack, { workflowId: workflow.id });
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  private async processQueuedJob(data: {
    userId: string;
    type: 'portfolio_import' | 'report_export';
    payload: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<unknown> {
    if (data.type === 'portfolio_import') {
      return this.invoke(ARTSCAPE_TOOL_IDS.parseExcel, { ...data.payload, userId: data.userId }, {
        userId: data.userId,
        idempotencyKey: data.idempotencyKey,
        workflowId: 'workflow.art-portfolio-intake',
      });
    }
    const reportInput = { ...data.payload, userId: data.userId };
    const built = await this.invoke<{ report: unknown; snapshotHash: string }>(
      ARTSCAPE_TOOL_IDS.buildReportJson,
      reportInput,
      { userId: data.userId, workflowId: 'workflow.art-report-export' }
    );
    if (built.status !== 'completed' || !built.data) {
      throw new Error(built.error ?? 'Report JSON build failed.');
    }
    return this.invoke(
      ARTSCAPE_TOOL_IDS.renderReportPdf,
      { ...reportInput, ...built.data },
      {
        userId: data.userId,
        idempotencyKey: `${data.idempotencyKey}:render`,
        workflowId: 'workflow.art-report-export',
      }
    );
  }

  async invoke<T>(
    toolId: string,
    input: Record<string, unknown>,
    options: InvokeToolOptions
  ): Promise<RunEnvelope<T>> {
    const runId = createId('run');
    const sessionId = `artscape:${options.userId}`;
    const workflowRef = options.workflowId
      ? { id: options.workflowId, version: artScapeDomainPack.version }
      : undefined;
    await this.runManager.createSession({
      id: sessionId,
      userId: options.userId,
      domainPackRef: { id: artScapeDomainPack.id, version: artScapeDomainPack.version },
      metadata: { product: 'artscape' },
    });
    const run = await this.runManager.createRun({
      id: runId,
      sessionId,
      userId: options.userId,
      domainPackRef: { id: artScapeDomainPack.id, version: artScapeDomainPack.version },
      workflowRef,
      agentRef: { id: 'agent.artscape.portfolio', version: '1.0.0' },
      input,
    });
    const context: RunExecutionContext = {
      runId,
      sessionId,
      userId: options.userId,
      agentId: 'agent.artscape.portfolio',
    };
    await this.runManager.startRun(run);

    try {
      let result = await this.toolRunner.run({
        toolId,
        input,
        context: {
          runId,
          sessionId,
          userId: options.userId,
          stepId: toolId,
          idempotencyKey: options.idempotencyKey,
          principal: {
            id: options.userId,
            type: 'user',
            userId: options.userId,
            roles: ['portfolio-owner'],
            permissionScopes: ['artscape:read', 'artscape:write', 'artscape:export'],
          },
          executionScope: { allowedToolIds: [toolId] },
        },
      });

      if (result.status === 'human_review_required') {
        await this.runManager.waitForHumanReview(context, {
          toolId,
          invocationId: result.invocationId,
          reason: result.approvalRequest?.reason,
        });
        if (!options.approve || !result.invocationId) {
          return {
            runId,
            status: 'human_review_required',
            approval: {
              invocationId: result.invocationId ?? '',
              reason: result.approvalRequest?.reason,
            },
          };
        }
        await this.toolStore.approve(result.invocationId, options.userId);
        await this.runManager.recordHumanReviewApproved(context, {
          toolId,
          invocationId: result.invocationId,
        });
        result = await this.toolRunner.run({
          toolId,
          input,
          context: {
            runId,
            sessionId,
            userId: options.userId,
            stepId: toolId,
            invocationId: result.invocationId,
            idempotencyKey: options.idempotencyKey,
            principal: {
              id: options.userId,
              type: 'user',
              userId: options.userId,
              roles: ['portfolio-owner'],
              permissionScopes: ['artscape:read', 'artscape:write', 'artscape:export'],
            },
            executionScope: { allowedToolIds: [toolId] },
          },
        });
      }
      return await this.finish<T>(context, result);
    } catch (error) {
      await this.runManager.failRun(context, error);
      return {
        runId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async events(runId: string): Promise<FrameworkEvent[]> {
    return this.runManager.listEvents(runId);
  }

  async assertRunOwner(userId: string, runId: string): Promise<void> {
    const workflow = (await this.repository.read()).workflowRuns.find((item) => item.id === runId);
    if (workflow) {
      if (workflow.userId !== userId) throw new AppError('Workflow run not found.', 404, 'NOT_FOUND');
      return;
    }
    const events = await this.events(runId);
    const owner = events.map((event) => {
      const value = event as unknown as Record<string, unknown>;
      const metadata = value.metadata as Record<string, unknown> | undefined;
      const payload = value.payload as Record<string, unknown> | undefined;
      return metadata?.userId ?? value.userId ?? payload?.userId;
    }).find((value) => typeof value === 'string');
    if (owner !== userId) throw new AppError('Workflow run not found.', 404, 'NOT_FOUND');
  }

  async audit(runId: string) {
    return this.runManager.projectAudit(runId);
  }

  async replay(runId: string) {
    return this.runManager.projectReplay(runId);
  }

  async regression(runId: string) {
    return this.runManager.projectRegression(runId);
  }

  async recoverTools(): Promise<ToolCallResult[]> {
    return this.toolRunner.recoverPendingInvocations();
  }

  private async invokeWithinRun(
    toolId: string,
    input: Record<string, unknown>,
    context: RunExecutionContext,
    idempotencyKey: string,
    approveWrite: boolean
  ): Promise<ToolCallResult> {
    const request = (invocationId?: string) => ({
      toolId,
      input,
      context: {
        runId: context.runId,
        sessionId: context.sessionId,
        userId: context.userId,
        stepId: toolId,
        invocationId,
        idempotencyKey,
        principal: {
          id: context.userId,
          type: 'user' as const,
          userId: context.userId,
          roles: ['portfolio-owner'],
          permissionScopes: ['artscape:read', 'artscape:write', 'artscape:export'],
        },
        executionScope: { allowedToolIds: [toolId] },
      },
    });
    let result = await this.toolRunner.run(request());
    if (result.status === 'human_review_required' && approveWrite && result.invocationId) {
      await this.toolStore.approve(result.invocationId, context.userId);
      result = await this.toolRunner.run(request(result.invocationId));
    }
    return result;
  }

  private async finish<T>(
    context: RunExecutionContext,
    result: ToolCallResult
  ): Promise<RunEnvelope<T>> {
    if (result.status === 'completed') {
      await this.runManager.completeRun(context, result.output);
      return { runId: context.runId, status: 'completed', data: result.output as T };
    }
    await this.runManager.failRun(context, result.error ?? result.status);
    return {
      runId: context.runId,
      status: 'failed',
      error:
        typeof result.error === 'string'
          ? result.error
          : result.error?.message ?? `Tool ended with ${result.status}`,
    };
  }
}
