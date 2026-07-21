import type { ArtScapeRepository } from '../repositories/artscape-repository';
import type { AgentMessage, AgentSession, AgentIntent } from '../types';
import { requireFound } from '../utils/errors';
import { createId } from '../utils/id';
import type { ArtScapeWorkflowExecutor } from '../workflows/workflow-executor';
import { createIntentRouter, type IntentRouter } from './intent-router';

const TASK_BY_INTENT: Partial<Record<AgentIntent, string>> = {
  portfolio_intake: 'task.art-portfolio-intake',
  scenario_analysis: 'task.art-scenario-analysis',
  candidate_comparison: 'task.art-candidate-comparison',
  report_export: 'task.art-report-export',
};

export class ConversationService {
  constructor(
    private readonly repository: ArtScapeRepository,
    private readonly workflows: ArtScapeWorkflowExecutor,
    private readonly intentRouter: IntentRouter = createIntentRouter()
  ) {}

  async createSession(userId: string, title?: string): Promise<AgentSession> {
    const timestamp = new Date().toISOString();
    const session: AgentSession = {
      id: createId('session'),
      userId,
      title,
      status: 'active',
      createdAt: timestamp,
    };
    return this.repository.update((state) => {
      state.sessions.push(session);
      return session;
    });
  }

  async getSession(userId: string, sessionId: string): Promise<AgentSession> {
    return requireFound(
      (await this.repository.read()).sessions.find(
        (session) => session.id === sessionId && session.userId === userId
      ),
      'Agent session not found.'
    );
  }

  async listMessages(userId: string, sessionId: string): Promise<AgentMessage[]> {
    await this.getSession(userId, sessionId);
    return (await this.repository.read()).messages.filter(
      (message) => message.sessionId === sessionId && message.userId === userId
    );
  }

  async sendMessage(input: {
    userId: string;
    sessionId: string;
    content: string;
    taskInput?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<{ userMessage: AgentMessage; assistantMessage: AgentMessage }> {
    await this.getSession(input.userId, input.sessionId);
    const timestamp = new Date().toISOString();
    const decision = await this.intentRouter.route(input.content);
    const userMessage: AgentMessage = {
      id: createId('message'),
      userId: input.userId,
      sessionId: input.sessionId,
      role: 'user',
      content: input.content,
      intent: decision.intent,
      metadata: { intentProvider: decision.provider, confidence: decision.confidence },
      createdAt: timestamp,
    };
    let responseText = this.clarification(decision.intent);
    let runId: string | undefined;
    const taskType = TASK_BY_INTENT[decision.intent];
    if (taskType && input.taskInput && input.idempotencyKey) {
      const run = await this.workflows.start({
        userId: input.userId,
        sessionId: input.sessionId,
        taskType,
        input: input.taskInput,
        idempotencyKey: input.idempotencyKey,
      });
      runId = run.id;
      responseText =
        run.status === 'waiting_human'
          ? '任务已完成校验，正在等待你的明确确认。'
          : run.status === 'completed'
            ? '任务已经完成，结果由确定性工具生成。'
            : `任务状态：${run.status}。`;
    }
    const assistantMessage: AgentMessage = {
      id: createId('message'),
      userId: input.userId,
      sessionId: input.sessionId,
      role: 'assistant',
      content: responseText,
      intent: decision.intent,
      runId,
      metadata: {
        generatedBy: 'artscape-conversation-orchestrator',
        numericAuthority: 'deterministic-tools-only',
      },
      createdAt: new Date().toISOString(),
    };
    await this.repository.update((state) => {
      state.messages.push(userMessage, assistantMessage);
      const session = requireFound(
        state.sessions.find((candidate) => candidate.id === input.sessionId),
        'Agent session not found.'
      );
      session.activeRunId = runId;
      session.updatedAt = new Date().toISOString();
    });
    return { userMessage, assistantMessage };
  }

  private clarification(intent: AgentIntent): string {
    switch (intent) {
      case 'portfolio_intake':
        return '请提供 Excel 文件、组合名称和幂等键，我会先校验再请求确认。';
      case 'scenario_analysis':
        return '请指定已确认的组合版本，我会运行牛市、中性和熊市情景。';
      case 'candidate_comparison':
        return '请指定已完成的情景分析，我会生成候选方案并等待确认。';
      case 'report_export':
        return '请指定组合版本和对应情景分析，我会生成 JSON 与 PDF 报告。';
      default:
        return '我可以协助导入组合、运行情景分析、比较候选方案或导出报告。';
    }
  }
}

