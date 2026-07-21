import { createApp } from './app';
import { getArtScapeRuntimeService } from './services/ArtScapeRuntime';
import { logger } from './observability/logger';

async function main(): Promise<void> {
  const service = await getArtScapeRuntimeService();
  await service.runtime.recoverTools();
  const app = await createApp(service);
  const port = Number(process.env.PORT ?? 3100);
  const server = app.listen(port, () => {
    logger.info({ port, persistence: service.persistence }, 'ArtScape backend listening');
    if (service.warning) logger.warn({ warning: service.warning }, 'Runtime persistence warning');
  });

  const shutdown = async () => {
    server.close();
    await service.runtime.repository.close?.();
    await service.runtime.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.fatal({ err: error }, 'ArtScape backend failed to start');
  process.exitCode = 1;
});
