import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const lock = JSON.parse(readFileSync(path.join(root, 'hypha.lock.json'), 'utf8'));
const hyphaPath = path.join(root, 'Hypha');

function git(...args) {
  return execFileSync('git', ['-C', hyphaPath, ...args], { encoding: 'utf8' }).trim();
}

const actualCommit = git('rev-parse', 'HEAD');
const actualBranch = git('branch', '--show-current');
const dirty = git('status', '--porcelain');

if (actualCommit !== lock.commit) {
  throw new Error(`Hypha commit mismatch: expected ${lock.commit}, got ${actualCommit}`);
}
if (actualBranch !== lock.branch) {
  throw new Error(`Hypha branch mismatch: expected ${lock.branch}, got ${actualBranch}`);
}
if (dirty) {
  throw new Error('Hypha checkout must remain clean.');
}

console.log(`Hypha lock verified: ${actualBranch}@${actualCommit}`);

