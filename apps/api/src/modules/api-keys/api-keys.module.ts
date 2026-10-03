import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysController } from './api-keys.controller';

/** The panel side of API access; the key service itself lives in AuthModule because the guards need it. */
@Module({
  imports: [AuthModule],
  controllers: [ApiKeysController],
})
export class ApiKeysModule {}
