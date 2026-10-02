import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CourierController } from './courier.controller';
import { CourierRegistry } from './courier.registry';
import { CourierService } from './courier.service';

@Module({
  imports: [AuthModule],
  controllers: [CourierController],
  providers: [CourierRegistry, CourierService],
  exports: [CourierService],
})
export class CourierModule {}
