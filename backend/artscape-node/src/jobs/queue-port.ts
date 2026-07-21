import { Queue, Worker, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

export interface QueueJob<T = unknown> {
  id: string;
  name: string;
  data: T;
}

export interface JobQueuePort {
  enqueue<T>(name: string, data: T, options?: { jobId?: string }): Promise<QueueJob<T>>;
  registerProcessor(processor: (job: QueueJob) => Promise<unknown>, concurrency?: number): void;
  close(): Promise<void>;
}

export class InMemoryJobQueue implements JobQueuePort {
  private sequence = 0;
  private processor?: (job: QueueJob) => Promise<unknown>;

  async enqueue<T>(name: string, data: T, options: { jobId?: string } = {}): Promise<QueueJob<T>> {
    const job = { id: options.jobId ?? `memory-job-${++this.sequence}`, name, data };
    if (this.processor) await this.processor(job);
    return job;
  }

  registerProcessor(processor: (job: QueueJob) => Promise<unknown>): void {
    this.processor = processor;
  }

  async close(): Promise<void> {}
}

export class BullMqJobQueue implements JobQueuePort {
  private readonly connection: IORedis;
  private readonly queue: Queue;
  private worker?: Worker;

  constructor(redisUrl: string, queueName = 'artscape-jobs') {
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(queueName, { connection: this.connection });
  }

  async enqueue<T>(name: string, data: T, options: { jobId?: string } = {}): Promise<QueueJob<T>> {
    const jobOptions: JobsOptions = {
      jobId: options.jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 500 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    };
    const job = await this.queue.add(name, data, jobOptions);
    return { id: String(job.id), name, data };
  }

  registerProcessor(
    processor: (job: QueueJob) => Promise<unknown>,
    concurrency = Number(process.env.JOB_WORKER_CONCURRENCY ?? 4)
  ): void {
    if (this.worker) throw new Error('BullMQ processor is already registered.');
    this.worker = new Worker(
      this.queue.name,
      async (job) => processor({ id: String(job.id), name: job.name, data: job.data }),
      { connection: this.connection, concurrency }
    );
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    await this.connection.quit();
  }
}

export function createJobQueue(): JobQueuePort {
  return process.env.REDIS_URL
    ? new BullMqJobQueue(process.env.REDIS_URL)
    : new InMemoryJobQueue();
}
