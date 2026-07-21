import type { ArtScapeState } from '../types';
import { emptyArtScapeState, type ArtScapeRepository } from './artscape-repository';

export class InMemoryArtScapeRepository implements ArtScapeRepository {
  private state: ArtScapeState;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(initialState: ArtScapeState = emptyArtScapeState()) {
    this.state = structuredClone(initialState);
  }

  async read(): Promise<ArtScapeState> {
    await this.tail;
    return structuredClone(this.state);
  }

  async update<T>(mutator: (state: ArtScapeState) => T | Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      this.state = draft;
      return structuredClone(result);
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}

