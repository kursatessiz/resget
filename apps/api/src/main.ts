// Must stay the first import: empty variables from compose read as unset.
import './config/unset-empty-env';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ERROR_CODE_HEADER, REQUEST_ID_HEADER } from '@resget/shared';
import { AppModule } from './app.module';
import { ErrorCodeFilter } from './common/error-code.filter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  // rawBody keeps the exact bytes of webhook requests for signature checks.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Caddy is the only proxy in front of the API; trust exactly one hop.
  app.set('trust proxy', 1);
  app.useGlobalFilters(new ErrorCodeFilter());

  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  const corsOrigin = config.get<string>('CORS_ORIGIN');
  const origins = corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : [];
  app.enableCors({
    origin: origins.length > 0 ? origins : !isProduction,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: origins.length > 0,
    exposedHeaders: [REQUEST_ID_HEADER, ERROR_CODE_HEADER],
  });

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Resget API')
      .setDescription('Restaurant ordering network REST API')
      .setVersion(config.get<string>('APP_RELEASE', 'dev'))
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  app.enableShutdownHooks();
  const port = config.get<number>('PORT', 4000);
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on port ${port}`);
  if (!isProduction) logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
}

void bootstrap();
