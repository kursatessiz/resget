import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { LogoController, UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [AuthModule, RestaurantsModule],
  controllers: [UploadsController, LogoController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
