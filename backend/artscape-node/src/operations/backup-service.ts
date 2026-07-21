import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../utils/hash';

export interface BackupManifest {
  version: '1.0.0';
  createdAt: string;
  source: string;
  files: Array<{ path: string; sizeBytes: number; sha256: string }>;
}

export class BackupService {
  async create(sourceDirectory: string, backupRoot: string, now = new Date()): Promise<string> {
    const source = path.resolve(sourceDirectory);
    const root = path.resolve(backupRoot);
    const destination = path.join(root, now.toISOString().replace(/[:.]/g, '-'));
    await mkdir(destination, { recursive: true });
    await cp(source, path.join(destination, 'payload'), { recursive: true, errorOnExist: true, force: false });
    const files = await this.inventory(path.join(destination, 'payload'));
    const manifest: BackupManifest = { version: '1.0.0', createdAt: now.toISOString(), source, files };
    await writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return destination;
  }

  async verify(backupDirectory: string): Promise<BackupManifest> {
    const directory = path.resolve(backupDirectory);
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as BackupManifest;
    const actual = await this.inventory(path.join(directory, 'payload'));
    if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('Backup checksum verification failed.');
    return manifest;
  }

  async restore(backupDirectory: string, emptyTargetDirectory: string): Promise<void> {
    await this.verify(backupDirectory);
    const target = path.resolve(emptyTargetDirectory);
    await mkdir(target, { recursive: true });
    if ((await readdir(target)).length) throw new Error('Restore target must be empty.');
    await cp(path.join(path.resolve(backupDirectory), 'payload'), target, { recursive: true, errorOnExist: true, force: false });
  }

  private async inventory(root: string): Promise<BackupManifest['files']> {
    const visit = async (directory: string): Promise<BackupManifest['files']> => {
      const output: BackupManifest['files'] = [];
      for (const entry of await readdir(directory)) {
        const absolute = path.join(directory, entry);
        const details = await stat(absolute);
        if (details.isDirectory()) output.push(...await visit(absolute));
        else {
          const content = await readFile(absolute);
          output.push({ path: path.relative(root, absolute).replace(/\\/g, '/'), sizeBytes: content.length, sha256: sha256(content) });
        }
      }
      return output;
    };
    return (await visit(root)).sort((left, right) => left.path.localeCompare(right.path));
  }
}
