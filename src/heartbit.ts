import 'reflect-metadata';

async function bootstrap() {
  process.env.NYX_PROCESS_ROLE = process.env.NYX_PROCESS_ROLE || 'heartbit';

  const [{ NestFactory }, { HeartbitRunnerModule }] = await Promise.all([
    import('@nestjs/core'),
    import('./heartbit/heartbit-runner.module'),
  ]);

  const app = await NestFactory.createApplicationContext(HeartbitRunnerModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();
}

bootstrap().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error('HeartBit bootstrap failed:', message);
  process.exitCode = 1;
});
