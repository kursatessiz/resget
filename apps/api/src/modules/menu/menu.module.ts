import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MenuController } from './menu.controller';
import { PublicMenuController } from './public-menu.controller';
import { MenuService } from './menu.service';

@Module({ imports: [AuthModule], controllers: [MenuController, PublicMenuController], providers: [MenuService] })
export class MenuModule {}
