import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { AdminPlatformController, PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { KpiController } from './kpi.controller';
import { KpiService } from './kpi.service';

@Module({
  imports: [AuthModule, AdminModule],
  controllers: [AdminPlatformController, PlatformController, KpiController],
  providers: [PlatformService, KpiService],
  exports: [PlatformService],
})
export class PlatformModule {}
