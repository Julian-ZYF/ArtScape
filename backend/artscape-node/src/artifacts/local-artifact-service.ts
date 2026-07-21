import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArtifactReference } from '../types';
import { sha256 } from '../utils/hash';
import { createId } from '../utils/id';
import type { ArtifactService } from './artifact-service';

export class LocalArtifactService implements ArtifactService {
  constructor(private readonly rootPath: string) {}

  async write(input: {
    kind: ArtifactReference['kind'];
    extension: string;
    mimeType: string;
    content: Buffer | string;
  }): Promise<ArtifactReference> {
    const id = createId('artifact');
    const directory = path.resolve(this.rootPath);
    await mkdir(directory, { recursive: true });
    const filename = `${id}.${input.extension.replace(/[^a-z0-9]/gi, '')}`;
    const absolutePath = path.join(directory, filename);
    const content = Buffer.isBuffer(input.content)
      ? input.content
      : Buffer.from(input.content, 'utf8');
    await writeFile(absolutePath, content);
    return {
      id,
      kind: input.kind,
      path: absolutePath,
      mimeType: input.mimeType,
      sha256: sha256(content),
      sizeBytes: content.length,
    };
  }

  async read(reference: ArtifactReference): Promise<Buffer> {
    const absolutePath = path.resolve(reference.path);
    const root = path.resolve(this.rootPath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
      throw new Error('Artifact path is outside the configured storage root.');
    }
    return readFile(absolutePath);
  }
}
