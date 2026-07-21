import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileArtScapeRepository } from '../repositories/file-artscape-repository';
import { InMemoryArtScapeRepository } from '../repositories/in-memory-artscape-repository';
import { ArtScapeRuntime } from '../runtime/artscape-runtime';
import { createSampleWorkbookBuffer } from '../testing/fixtures';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true }))));

const intake = async (runtime: ArtScapeRuntime) => runtime.workflows.start({
  userId: 'workflow-user',
  taskType: 'task.art-portfolio-intake',
  input: {
    fileName: 'portfolio.xlsx',
    portfolioName: 'FSM 恢复组合',
    fileBase64: (await createSampleWorkbookBuffer()).toString('base64'),
  },
  idempotencyKey: 'workflow-import-001',
});

describe('same-Run workflow executor', () => {
  it('pauses for review, resumes the same Run, and records every state', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'artscape-fsm-'));
    directories.push(dataDir);
    const runtime = new ArtScapeRuntime(new InMemoryArtScapeRepository(), dataDir);
    const waiting = await intake(runtime);
    expect(waiting.status).toBe('waiting_human');
    expect(waiting.currentState).toBe('awaiting_human_confirmation');
    expect((await runtime.repository.read()).versions).toHaveLength(0);

    const completed = await runtime.workflows.approve('workflow-user', waiting.id);
    expect(completed.id).toBe(waiting.id);
    expect(completed.status).toBe('completed');
    expect(completed.statePath).toEqual([
      'received', 'parsing', 'validating', 'awaiting_human_confirmation', 'persisting_v1', 'completed',
    ]);
    expect((await runtime.repository.read()).versions[0]?.versionNo).toBe(1);
    const eventTypes = (await runtime.events(waiting.id)).map((event) => event.type);
    expect(eventTypes).toContain('run.waiting_human');
    expect(eventTypes).toContain('human.review.approved');
  });

  it('restores a persisted FSM snapshot after process recreation', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'artscape-recovery-'));
    directories.push(dataDir);
    const stateFile = path.join(dataDir, 'state.json');
    const first = new ArtScapeRuntime(new FileArtScapeRepository(stateFile), dataDir);
    const waiting = await intake(first);
    expect(waiting.status).toBe('waiting_human');
    await first.close();

    const recovered = new ArtScapeRuntime(new FileArtScapeRepository(stateFile), dataDir);
    const completed = await recovered.workflows.approve('workflow-user', waiting.id);
    expect(completed.id).toBe(waiting.id);
    expect(completed.status).toBe('completed');
    expect((await recovered.repository.read()).versions).toHaveLength(1);
    await recovered.close();
  });

  it('records a human rejection without persisting a version', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'artscape-reject-'));
    directories.push(dataDir);
    const runtime = new ArtScapeRuntime(new InMemoryArtScapeRepository(), dataDir);
    const waiting = await intake(runtime);
    const rejected = await runtime.workflows.reject('workflow-user', waiting.id, '数据需要修正');
    expect(rejected.status).toBe('failed');
    expect(rejected.error).toBe('数据需要修正');
    expect((await runtime.repository.read()).versions).toHaveLength(0);
  });

  it('supports cancellation and creates an auditable retry for failed Runs', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'artscape-control-'));
    directories.push(dataDir);
    const runtime = new ArtScapeRuntime(new InMemoryArtScapeRepository(), dataDir);
    const waiting = await intake(runtime);
    const cancelled = await runtime.workflows.cancel('workflow-user', waiting.id, '用户取消');
    expect(cancelled.status).toBe('cancelled');

    const failed = await runtime.workflows.start({
      userId: 'workflow-user', taskType: 'task.art-scenario-analysis',
      input: { portfolioVersionId: 'missing-version' }, idempotencyKey: 'missing-version-001',
    });
    expect(failed.status).toBe('failed');
    const retried = await runtime.workflows.retry('workflow-user', failed.id);
    expect(retried.id).not.toBe(failed.id);
    expect(retried.status).toBe('failed');
  });
});
