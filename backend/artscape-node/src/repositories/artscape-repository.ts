import type { ArtScapeState } from '../types';

export const emptyArtScapeState = (): ArtScapeState => ({
  imports: [],
  portfolios: [],
  versions: [],
  scenarioRuns: [],
  candidates: [],
  comparisons: [],
  reports: [],
  jobs: [],
  workflowRuns: [],
  sessions: [],
  messages: [],
});

export function normalizeArtScapeState(state: Partial<ArtScapeState>): ArtScapeState {
  const empty = emptyArtScapeState();
  return Object.fromEntries(
    Object.keys(empty).map((key) => [key, state[key as keyof ArtScapeState] ?? []])
  ) as unknown as ArtScapeState;
}

export interface ArtScapeRepository {
  read(): Promise<ArtScapeState>;
  update<T>(mutator: (state: ArtScapeState) => T | Promise<T>): Promise<T>;
  close?(): Promise<void>;
}
