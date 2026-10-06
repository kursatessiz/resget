import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeyExpiryNotifier } from './api-key-expiry.notifier';

/** The panel side of API access; the key service itself lives in AuthModule because the guards need it. */
@Module({
  imports: [AuthModule],
  controllers: [ApiKeysController],
  providers: [ApiKeyExpiryNotifier],
})
export class ApiKeysModule {}
