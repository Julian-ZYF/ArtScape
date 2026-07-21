import type { ArtifactReference } from '../types';

export interface ArtifactService {
  write(input: {
    kind: ArtifactReference['kind'];
    extension: string;
    mimeType: string;
    content: Buffer | string;
  }): Promise<ArtifactReference>;
  read(reference: ArtifactReference): Promise<Buffer>;
}
