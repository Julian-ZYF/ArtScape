import { createArtScapeRepository, type RepositoryResult } from '../repositories';
import { ArtScapeRuntime } from '../runtime/artscape-runtime';

export interface ArtScapeRuntimeService {
  runtime: ArtScapeRuntime;
  persistence: RepositoryResult['mode'];
  warning?: string;
}

let singleton: Promise<ArtScapeRuntimeService> | undefined;

export function getArtScapeRuntimeService(): Promise<ArtScapeRuntimeService> {
  singleton ??= createArtScapeRepository().then((result) => ({
    runtime: new ArtScapeRuntime(result.repository),
    persistence: result.mode,
    warning: result.warning,
  }));
  return singleton;
}

export function setArtScapeRuntimeServiceForTest(
  service: ArtScapeRuntimeService | undefined
): void {
  singleton = service ? Promise.resolve(service) : undefined;
}

