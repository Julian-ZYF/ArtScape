import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArtScapeState } from '../types';
import {
  emptyArtScapeState,
  normalizeArtScapeState,
  type ArtScapeRepository,
} from './artscape-repository';

export class FileArtScapeRepository implements ArtScapeRepository {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly filename: string) {}

  async read(): Promise<ArtScapeState> {
    await this.tail;
    return this.readUnsafe();
  }

  async update<T>(mutator: (state: ArtScapeState) => T | Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      const state = await this.readUnsafe();
      const result = await mutator(state);
      await this.writeUnsafe(state);
      return structuredClone(result);
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  private async readUnsafe(): Promise<ArtScapeState> {
    try {
      return normalizeArtScapeState(
        JSON.parse(await readFile(this.filename, 'utf8')) as Partial<ArtScapeState>
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyArtScapeState();
      throw error;
    }
  }

  private async writeUnsafe(state: ArtScapeState): Promise<void> {
    await mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporary, this.filename);
  }
}
