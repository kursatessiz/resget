import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RestaurantsController } from './restaurants.controller';

@Module({ imports: [AuthModule], controllers: [RestaurantsController] })
export class RestaurantsModule {}
