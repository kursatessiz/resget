import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PushController } from './push.controller';
import { ExpoPushProvider, MockPushProvider, PUSH_PROVIDER } from './push.provider';
import { PushService } from './push.service';

/**
 * Push side of the messaging engine (docs/MESAJLASMA.md): the device
 * registry and one provider behind a token. Global so order and dispatch
 * flows can notify without importing the module everywhere.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [PushController],
  providers: [
    MockPushProvider,
    ExpoPushProvider,
    {
      provide: PUSH_PROVIDER,
      inject: [ConfigService, MockPushProvider, ExpoPushProvider],
      useFactory: (config: ConfigService, mock: MockPushProvider, expo: ExpoPushProvider) =>
        config.get<string>('PUSH_PROVIDER') === 'EXPO' ? expo : mock,
    },
    PushService,
  ],
  exports: [PushService],
})
export class PushModule {}
