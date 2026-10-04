import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPlatformController, PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminPlatformController, PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
