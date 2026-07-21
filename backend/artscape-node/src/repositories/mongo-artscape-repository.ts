import mongoose, { type Connection, type Model } from 'mongoose';
import type { ArtScapeState } from '../types';
import {
  emptyArtScapeState,
  normalizeArtScapeState,
  type ArtScapeRepository,
} from './artscape-repository';

interface EntityDocument {
  id: string;
  userId: string;
  data: Record<string, unknown>;
}

const COLLECTIONS: Array<keyof ArtScapeState> = [
  'imports',
  'portfolios',
  'versions',
  'scenarioRuns',
  'candidates',
  'comparisons',
  'reports',
  'jobs',
  'workflowRuns',
  'sessions',
  'messages',
];

const COLLECTION_NAMES: Record<keyof ArtScapeState, string> = {
  imports: 'portfolio_imports',
  portfolios: 'portfolios',
  versions: 'portfolio_versions',
  scenarioRuns: 'scenario_runs',
  candidates: 'candidate_proposals',
  comparisons: 'version_comparisons',
  reports: 'reports',
  jobs: 'jobs',
  workflowRuns: 'workflow_runs',
  sessions: 'agent_sessions',
  messages: 'agent_messages',
};

export class MongoArtScapeRepository implements ArtScapeRepository {
  private tail: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly connection: Connection,
    private readonly models: Record<keyof ArtScapeState, Model<EntityDocument>>
  ) {}

  static async connect(uri: string): Promise<MongoArtScapeRepository> {
    const connection = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS ?? 5000),
    }).asPromise();
    const models = Object.fromEntries(
      COLLECTIONS.map((key) => {
        const schema = new mongoose.Schema<EntityDocument>(
          {
            id: { type: String, required: true },
            userId: { type: String, required: true, index: true },
            data: { type: mongoose.Schema.Types.Mixed, required: true },
          },
          { timestamps: true, minimize: false, collection: COLLECTION_NAMES[key] }
        );
        schema.index({ id: 1 }, { unique: true });
        if (key === 'versions') {
          schema.index(
            { 'data.portfolioId': 1, 'data.versionNo': 1 },
            { unique: true, name: 'portfolio_version_unique' }
          );
        }
        if (key === 'jobs') {
          schema.index(
            { userId: 1, 'data.type': 1, 'data.idempotencyKey': 1 },
            {
              unique: true,
              partialFilterExpression: { 'data.idempotencyKey': { $type: 'string' } },
              name: 'job_idempotency_unique',
            }
          );
        }
        return [key, connection.model<EntityDocument>(`ArtScape_${key}`, schema)];
      })
    ) as Record<keyof ArtScapeState, Model<EntityDocument>>;
    await Promise.all(Object.values(models).map((model) => model.init()));
    return new MongoArtScapeRepository(connection, models);
  }

  async read(): Promise<ArtScapeState> {
    await this.tail;
    return this.readDirect();
  }

  async update<T>(mutator: (state: ArtScapeState) => T | Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      const state = await this.readDirect();
      const result = await mutator(state);
      const session = await this.connection.startSession();
      try {
        await session.withTransaction(async () => {
          for (const key of COLLECTIONS) {
            const model = this.models[key];
            const records = state[key] as Array<{ id: string; userId: string }>;
            const ids = records.map((record) => record.id);
            await model.deleteMany(ids.length ? { id: { $nin: ids } } : {}, { session });
            if (records.length) {
              await model.bulkWrite(
                records.map((record) => ({
                  updateOne: {
                    filter: { id: record.id },
                    update: {
                      $set: {
                        userId: record.userId,
                        data: structuredClone(record) as unknown as Record<string, unknown>,
                      },
                    },
                    upsert: true,
                  },
                })),
                { session }
              );
            }
          }
        });
      } finally {
        await session.endSession();
      }
      return structuredClone(result);
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  private async readDirect(): Promise<ArtScapeState> {
    const entries = await Promise.all(
      COLLECTIONS.map(async (key) => [
        key,
        (await this.models[key].find({}).lean().exec()).map((document) => document.data),
      ] as const)
    );
    return normalizeArtScapeState({
      ...emptyArtScapeState(),
      ...Object.fromEntries(entries),
    } as Partial<ArtScapeState>);
  }
}
