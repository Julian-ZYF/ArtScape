import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupService } from './backup-service';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true }))));

describe('backup and restore rehearsal', () => {
  it('checksums and restores state plus artifacts into an empty target', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'artscape-backup-'));
    directories.push(root);
    const source = path.join(root, 'data');
    const target = path.join(root, 'restore');
    await writeFile(path.join(root, 'seed.tmp'), 'seed');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.join(source, 'artifacts'), { recursive: true }));
    await writeFile(path.join(source, 'state.json'), '{"ok":true}\n');
    await writeFile(path.join(source, 'artifacts', 'report.pdf'), Buffer.from('%PDF-sample'));
    const service = new BackupService();
    const backup = await service.create(source, path.join(root, 'backups'), new Date('2026-07-21T00:00:00Z'));
    expect((await service.verify(backup)).files).toHaveLength(2);
    await service.restore(backup, target);
    expect(await readFile(path.join(target, 'state.json'), 'utf8')).toBe('{"ok":true}\n');
  });
});
