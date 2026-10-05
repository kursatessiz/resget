import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { RestaurantSettingsDTO } from '@resget/shared';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { RestaurantsService } from '../restaurants/restaurants.service';
import { LOGO_MAX_BYTES, UploadsService } from './uploads.service';
import type { UploadedImage } from './uploads.service';

/** Public: the stored logos. Names are random, so the URL is the only handle and caching can be immutable. */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Get('logos/:restaurantId/:file')
  @Header('cache-control', 'public, max-age=31536000, immutable')
  logo(@Param('restaurantId') restaurantId: string, @Param('file') file: string): Promise<StreamableFile> {
    return this.uploads.openLogo(restaurantId, file);
  }
}

/** The restaurant's logo: one multipart field named `file`, PNG, JPEG or WebP, at most LOGO_MAX_BYTES. */
@Controller('restaurants/:restaurantId/logo')
@RestaurantScoped()
export class LogoController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly restaurants: RestaurantsService,
  ) {}

  @Post()
  @HttpCode(200)
  @RequirePermission('restaurant.settings.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES, files: 1 } }))
  async upload(@Tenant() tenant: TenantContext, @UploadedFile() file?: UploadedImage): Promise<RestaurantSettingsDTO> {
    await this.uploads.storeLogo(tenant.restaurantId, file);
    return this.restaurants.settings(tenant);
  }

  @Delete()
  @RequirePermission('restaurant.settings.manage')
  async remove(@Tenant() tenant: TenantContext): Promise<RestaurantSettingsDTO> {
    await this.uploads.removeLogo(tenant.restaurantId);
    return this.restaurants.settings(tenant);
  }
}
