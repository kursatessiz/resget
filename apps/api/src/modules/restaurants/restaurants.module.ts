import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantSignupController } from './signup.controller';
import { RestaurantsService } from './restaurants.service';
import { RestaurantProvisioningService } from './provisioning.service';

@Module({
  imports: [AuthModule],
  controllers: [RestaurantSignupController, RestaurantsController],
  providers: [RestaurantsService, RestaurantProvisioningService],
  exports: [RestaurantProvisioningService],
})
export class RestaurantsModule {}
