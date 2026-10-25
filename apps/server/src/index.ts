import { createApp } from '#server/app.js';
const app = await createApp({ logger: true });
try {
  await app.listen({ host: app.ctx.config.host, port: app.ctx.config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().then(() => {
      process.exitCode = 0;
    });
  });
