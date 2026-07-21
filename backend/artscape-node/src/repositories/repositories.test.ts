import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileArtScapeRepository } from './file-artscape-repository';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('file repository', () => {
  it('starts empty and atomically persists updates', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'artscape-repository-'));
    directories.push(directory);
    const filename = path.join(directory, 'state.json');
    const repository = new FileArtScapeRepository(filename);
    expect((await repository.read()).portfolios).toEqual([]);
    await repository.update((state) => {
      state.portfolios.push({
        id: 'portfolio-1',
        userId: 'user-1',
        name: '组合',
        createdAt: new Date().toISOString(),
      });
      return 'saved';
    });
    expect((await repository.read()).portfolios[0]!.name).toBe('组合');
    expect(JSON.parse(await readFile(filename, 'utf8')).portfolios).toHaveLength(1);
  });

  it('does not hide malformed persisted state', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'artscape-repository-bad-'));
    directories.push(directory);
    const filename = path.join(directory, 'state.json');
    await writeFile(filename, '{bad json', 'utf8');
    await expect(new FileArtScapeRepository(filename).read()).rejects.toThrow();
  });
});

