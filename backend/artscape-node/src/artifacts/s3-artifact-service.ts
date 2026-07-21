import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ArtifactReference } from '../types';
import { sha256 } from '../utils/hash';
import { createId } from '../utils/id';
import type { ArtifactService } from './artifact-service';

export class S3ArtifactService implements ArtifactService {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly prefix = 'artscape',
    endpoint = process.env.S3_ENDPOINT
  ) {
    this.client = new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint,
      forcePathStyle: Boolean(endpoint),
    });
  }

  async write(input: {
    kind: ArtifactReference['kind'];
    extension: string;
    mimeType: string;
    content: Buffer | string;
  }): Promise<ArtifactReference> {
    const id = createId('artifact');
    const content = Buffer.isBuffer(input.content)
      ? input.content
      : Buffer.from(input.content, 'utf8');
    const digest = sha256(content);
    const key = `${this.prefix}/${input.kind}/${id}.${input.extension.replace(/[^a-z0-9]/gi, '')}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: input.mimeType,
        Metadata: { sha256: digest },
      })
    );
    return {
      id,
      kind: input.kind,
      path: `s3://${this.bucket}/${key}`,
      mimeType: input.mimeType,
      sha256: digest,
      sizeBytes: content.length,
    };
  }

  async read(reference: ArtifactReference): Promise<Buffer> {
    const prefix = `s3://${this.bucket}/`;
    if (!reference.path.startsWith(prefix)) throw new Error('Artifact bucket mismatch.');
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: reference.path.slice(prefix.length),
    }));
    if (!response.Body) throw new Error('Artifact content is empty.');
    return Buffer.from(await response.Body.transformToByteArray());
  }
}
