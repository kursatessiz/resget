import { Global, Module } from '@nestjs/common';
import { AdminRestaurantHealthController, ChurnController } from './churn.controller';
import { ChurnService } from './churn.service';
import { ChurnSweepWatchdog } from './churn.watchdog';
import { RestaurantHealthService } from './restaurant-health.service';

/** Global so order placement and the segments module can reach the churn classes. */
@Global()
@Module({
  controllers: [ChurnController, AdminRestaurantHealthController],
  providers: [ChurnService, RestaurantHealthService, ChurnSweepWatchdog],
  exports: [ChurnService],
})
export class ChurnModule {}
