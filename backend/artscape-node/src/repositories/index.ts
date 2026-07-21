import path from 'node:path';
import type { ArtScapeRepository } from './artscape-repository';
import { FileArtScapeRepository } from './file-artscape-repository';
import { InMemoryArtScapeRepository } from './in-memory-artscape-repository';
import { MongoArtScapeRepository } from './mongo-artscape-repository';

export interface RepositoryResult {
  repository: ArtScapeRepository;
  mode: 'memory' | 'file' | 'mongo';
  warning?: string;
}

export async function createArtScapeRepository(): Promise<RepositoryResult> {
  if (process.env.NODE_ENV === 'test' || process.env.ARTSCAPE_REPOSITORY === 'memory') {
    return { repository: new InMemoryArtScapeRepository(), mode: 'memory' };
  }

  if (process.env.MONGODB_URI) {
    try {
      return {
        repository: await MongoArtScapeRepository.connect(process.env.MONGODB_URI),
        mode: 'mongo',
      };
    } catch (error) {
      const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
      return {
        repository: new FileArtScapeRepository(path.join(dataDir, 'artscape-state.json')),
        mode: 'file',
        warning: `MongoDB unavailable; using file repository: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
  return {
    repository: new FileArtScapeRepository(path.join(dataDir, 'artscape-state.json')),
    mode: 'file',
  };
}

