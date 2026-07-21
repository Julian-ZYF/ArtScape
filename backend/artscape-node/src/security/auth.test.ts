import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import { InMemoryArtScapeRepository } from '../repositories/in-memory-artscape-repository';
import { ArtScapeRuntime } from '../runtime/artscape-runtime';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe('API authentication and RBAC', () => {
  it('requires authentication, ignores spoofed userId, and enforces viewer permissions', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'artscape-auth-'));
    directories.push(dataDir);
    const repository = new InMemoryArtScapeRepository();
    await repository.update((state) => state.portfolios.push({
      id: 'portfolio-owned', userId: 'alice', name: 'Alice portfolio',
      createdAt: new Date().toISOString(),
    }));
    const app = await createApp({ runtime: new ArtScapeRuntime(repository, dataDir), persistence: 'memory' });
    await request(app).get('/api/v1/artscape/status').expect(401);
    await request(app).get('/api/v1/artscape/portfolios/portfolio-owned')
      .set('x-user-id', 'alice').query({ userId: 'mallory' }).expect(200);
    await request(app).get('/api/v1/artscape/portfolios/portfolio-owned')
      .set('x-user-id', 'mallory').query({ userId: 'alice' }).expect(404);
    const denied = await request(app).post('/api/v1/artscape/sessions')
      .set('x-user-id', 'alice').set('x-user-roles', 'viewer').send({ title: 'No write' }).expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });

  it('accepts a correctly scoped JWT and rejects tampered tokens', async () => {
    vi.stubEnv('JWT_SECRET', 'a-secure-test-secret-with-more-than-32-characters');
    vi.stubEnv('JWT_ISSUER', 'artscape-test');
    vi.stubEnv('JWT_AUDIENCE', 'artscape-api-test');
    const dataDir = await mkdtemp(path.join(tmpdir(), 'artscape-jwt-'));
    directories.push(dataDir);
    const app = await createApp({ runtime: new ArtScapeRuntime(new InMemoryArtScapeRepository(), dataDir), persistence: 'memory' });
    const token = jwt.sign({ roles: ['portfolio-owner'] }, process.env.JWT_SECRET!, {
      subject: 'jwt-user', issuer: 'artscape-test', audience: 'artscape-api-test', expiresIn: '5m', algorithm: 'HS256',
    });
    await request(app).get('/api/v1/artscape/status').set('authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v1/artscape/status').set('authorization', `${token}tampered`).expect(401);
  });
});
