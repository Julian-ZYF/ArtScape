import { describe, expect, it } from 'vitest';
import { InMemoryArtScapeRepository } from '../repositories/in-memory-artscape-repository';
import { JobService } from './job-service';
import { InMemoryJobQueue } from './queue-port';

describe('JobService', () => {
  it('supports the local queue fallback before a processor is registered', async () => {
    const queue = new InMemoryJobQueue();
    const queued = await queue.enqueue('test', { value: 1 });
    expect(queued.id).toBe('memory-job-1');
    await queue.close();
  });

  it('persists success and reuses a successful idempotent result', async () => {
    const service = new JobService(new InMemoryArtScapeRepository());
    let executions = 0;
    const first = await service.run(
      {
        userId: 'user-1',
        type: 'portfolio_import',
        payload: { source: 'test' },
        idempotencyKey: 'job-key-001',
      },
      async () => ({ value: ++executions })
    );
    const reused = await service.run(
      {
        userId: 'user-1',
        type: 'portfolio_import',
        payload: { source: 'test' },
        idempotencyKey: 'job-key-001',
      },
      async () => ({ value: ++executions })
    );
    expect(first.job.status).toBe('succeeded');
    expect(reused.output.value).toBe(1);
    expect(executions).toBe(1);
    expect(await service.get('user-1', first.job.id)).toEqual(first.job);
    expect(await service.list('user-1')).toHaveLength(1);
  });

  it('records worker failures', async () => {
    const repository = new InMemoryArtScapeRepository();
    const service = new JobService(repository);
    await expect(
      service.run(
        {
          userId: 'user-1',
          type: 'report_export',
          payload: {},
          idempotencyKey: 'job-key-failure',
        },
        async () => {
          throw new Error('expected failure');
        }
      )
    ).rejects.toThrow('expected failure');
    expect((await repository.read()).jobs[0]!.status).toBe('failed');
    await expect(service.get('user-1', 'missing')).rejects.toThrow('Job not found');
  });

  it('persists a queued job before a registered worker processes it', async () => {
    const repository = new InMemoryArtScapeRepository();
    const queue = new InMemoryJobQueue();
    const service = new JobService(repository, queue);
    let executions = 0;
    queue.registerProcessor(async (queued) => {
      const data = queued.data as { jobId: string };
      return service.process(data.jobId, async () => ({ accepted: ++executions === 1 }));
    });
    const job = await service.enqueue({
      userId: 'queue-user', type: 'portfolio_import', payload: { source: 'queue' },
      idempotencyKey: 'queue-job-001',
    });
    expect(job.status).toBe('succeeded');
    expect(job.output).toEqual({ accepted: true });
    const duplicate = await service.enqueue({
      userId: 'queue-user', type: 'portfolio_import', payload: { source: 'different' },
      idempotencyKey: 'queue-job-001',
    });
    expect(duplicate.id).toBe(job.id);
    expect(executions).toBe(1);
  });
});
