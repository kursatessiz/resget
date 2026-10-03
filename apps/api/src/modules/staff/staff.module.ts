import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitesController, StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({ imports: [AuthModule], controllers: [StaffController, InvitesController], providers: [StaffService] })
export class StaffModule {}
