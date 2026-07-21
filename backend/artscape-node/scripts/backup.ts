import path from 'node:path';
import { BackupService } from '../src/operations/backup-service';

const source = path.resolve(process.argv[2] ?? process.env.DATA_DIR ?? './data');
const destination = path.resolve(process.argv[3] ?? './backups');
async function main(): Promise<void> {
  const backup = await new BackupService().create(source, destination);
  await new BackupService().verify(backup);
  process.stdout.write(`${backup}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
