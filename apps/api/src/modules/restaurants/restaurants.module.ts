import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';

@Module({ imports: [AuthModule], controllers: [RestaurantsController], providers: [RestaurantsService] })
export class RestaurantsModule {}
