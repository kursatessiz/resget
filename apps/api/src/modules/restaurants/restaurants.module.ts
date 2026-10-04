import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RestaurantsController } from './restaurants.controller';
import { DeliveryZoneController } from './delivery-zone.controller';
import { DeliveryZoneService } from './delivery-zone.service';
import { RestaurantSignupController } from './signup.controller';
import { RestaurantsService } from './restaurants.service';
import { RestaurantProvisioningService } from './provisioning.service';

@Module({
  imports: [AuthModule],
  controllers: [RestaurantSignupController, RestaurantsController, DeliveryZoneController],
  providers: [RestaurantsService, RestaurantProvisioningService, DeliveryZoneService],
  exports: [RestaurantProvisioningService, RestaurantsService, DeliveryZoneService],
})
export class RestaurantsModule {}
