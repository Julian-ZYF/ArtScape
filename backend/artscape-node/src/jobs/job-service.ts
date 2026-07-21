import type { ArtScapeRepository } from '../repositories/artscape-repository';
import type { JobRecord } from '../types';
import { requireFound } from '../utils/errors';
import { createId } from '../utils/id';
import type { JobQueuePort } from './queue-port';
import { InMemoryJobQueue } from './queue-port';

export class JobService {
  constructor(
    private readonly repository: ArtScapeRepository,
    private readonly queue: JobQueuePort = new InMemoryJobQueue()
  ) {}

  async enqueue(input: {
    userId: string;
    type: JobRecord['type'];
    payload: unknown;
    idempotencyKey: string;
  }): Promise<JobRecord> {
    const existing = (await this.repository.read()).jobs.find(
      (job) => job.userId === input.userId && job.type === input.type && job.idempotencyKey === input.idempotencyKey
    );
    if (existing) return existing;
    const job: JobRecord = {
      id: createId('job'), userId: input.userId, type: input.type, status: 'queued', progress: 0,
      input: input.payload, idempotencyKey: input.idempotencyKey, createdAt: new Date().toISOString(),
    };
    await this.repository.update((state) => state.jobs.push(job));
    await this.queue.enqueue(input.type, { ...input, jobId: job.id }, { jobId: job.id });
    return this.get(input.userId, job.id);
  }

  async run<T>(
    input: {
      userId: string;
      type: JobRecord['type'];
      payload: unknown;
      idempotencyKey: string;
    },
    worker: () => Promise<T>
  ): Promise<{ job: JobRecord; output: T }> {
    const current = await this.repository.read();
    const existing = current.jobs.find(
      (job) =>
        job.userId === input.userId &&
        job.type === input.type &&
        job.idempotencyKey === input.idempotencyKey &&
        job.status === 'succeeded'
    );
    if (existing) return { job: existing, output: existing.output as T };

    const timestamp = new Date().toISOString();
    const job: JobRecord = {
      id: createId('job'),
      userId: input.userId,
      type: input.type,
      status: 'queued',
      progress: 0,
      input: input.payload,
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
    };
    await this.repository.update((state) => state.jobs.push(job));
    const output = await this.process(job.id, worker);
    return { job: await this.get(input.userId, job.id), output };
  }

  async process<T>(jobId: string, worker: () => Promise<T>): Promise<T> {
    await this.update(jobId, { status: 'running', progress: 10 });
    try {
      const output = await worker();
      await this.update(jobId, {
        status: 'succeeded',
        progress: 100,
        output,
      });
      return output;
    } catch (error) {
      await this.update(jobId, {
        status: 'failed',
        progress: 100,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async list(userId: string): Promise<JobRecord[]> {
    return (await this.repository.read()).jobs.filter((job) => job.userId === userId);
  }

  async get(userId: string, jobId: string): Promise<JobRecord> {
    return requireFound(
      (await this.repository.read()).jobs.find(
        (job) => job.id === jobId && job.userId === userId
      ),
      'Job not found.'
    );
  }

  private async update(
    jobId: string,
    patch: Partial<JobRecord>
  ): Promise<JobRecord> {
    return this.repository.update((state) => {
      const target = requireFound(
        state.jobs.find((job) => job.id === jobId),
        'Job not found.'
      );
      Object.assign(target, patch, { updatedAt: new Date().toISOString() });
      return target;
    });
  }
}
