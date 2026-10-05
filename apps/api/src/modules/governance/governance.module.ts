import { Module } from '@nestjs/common';
import { AuditViewerService } from './audit-viewer.service';
import { GovernanceController } from './governance.controller';

/** Console side of send approvals: limits per tenant and the audit viewer (docs/ONAYLAR.md). */
@Module({ controllers: [GovernanceController], providers: [AuditViewerService] })
export class GovernanceModule {}
