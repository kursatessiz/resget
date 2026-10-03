import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SystemHealthService } from './system-health.service';

@Module({
  imports: [AuthModule, RestaurantsModule],
  controllers: [AdminController],
  providers: [AdminService, SystemHealthService],
})
export class AdminModule {}
