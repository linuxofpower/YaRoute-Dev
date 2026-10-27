import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { preparePublicRcloneEnvironment } from './storage/public-rclone-isolation';

async function bootstrap() {
  // Quarantine Heroku's legacy operator storage env before Nest constructs
  // any provider, controller or public MCP tool. Pro/normal private boot unchanged.
  preparePublicRcloneEnvironment();
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
}

bootstrap();
