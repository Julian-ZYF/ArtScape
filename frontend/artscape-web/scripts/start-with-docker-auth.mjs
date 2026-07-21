import { execFileSync, spawn } from 'node:child_process';
import process from 'node:process';

const container = process.env.ARTSCAPE_BACKEND_CONTAINER || 'docker-artscape-backend-1';
const inspect = execFileSync('docker', ['inspect', container], { encoding: 'utf8' });
const descriptor = JSON.parse(inspect)[0];
const variables = descriptor?.Config?.Env;
if (!Array.isArray(variables)) throw new Error(`Cannot inspect environment for ${container}.`);
const jwtEntry = variables.find((item) => typeof item === 'string' && item.startsWith('JWT_SECRET='));
if (!jwtEntry) throw new Error(`JWT_SECRET is not configured in ${container}.`);

const child = spawn('npm', ['run', 'dev:web'], {
  cwd: new URL('../../..', import.meta.url),
  env: { ...process.env, ARTSCAPE_DEMO_JWT_SECRET: jwtEntry.slice('JWT_SECRET='.length) },
  shell: true,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => { process.exitCode = code ?? 1; });
