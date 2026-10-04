import { Controller, Get, UseGuards } from '@nestjs/common';
import { KpiQuerySchema } from '@resget/shared';
import type { KpiQuery, PlatformKpiDTO } from '@resget/shared';
import { ZodQuery } from '../../common/zod-body.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { KpiService } from './kpi.service';

/** The platform funnels and KPI board (docs/HUNILER.md); platform marketing access and the kpi_dashboard module. */
@Controller('platform/kpi')
@UseGuards(JwtAuthGuard)
export class KpiController {
  constructor(private readonly kpi: KpiService) {}

  @Get()
  board(@CurrentUser() user: AuthUser, @ZodQuery(KpiQuerySchema) query: KpiQuery): Promise<PlatformKpiDTO> {
    return this.kpi.board(user, query.days);
  }
}
