import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { DomainsController, PublicDomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { PrismaService } from '../prisma/prisma.service';
import { DOMAIN_VERIFIER, DnsDomainVerifier, MockDomainVerifier, domainChallenge } from './domain-verifier';

@Module({
  imports: [AuthModule],
  controllers: [DomainsController, PublicDomainsController],
  providers: [
    DomainsService,
    {
      provide: DOMAIN_VERIFIER,
      inject: [ConfigService, PrismaService],
      // Tests resolve against the stand-in unless told otherwise; everything else asks real DNS. The stand-in
      // publishes the owner proof of whichever restaurant holds a .verified.test host, as its owner would.
      useFactory: (config: ConfigService, prisma: PrismaService) =>
        (config.get<string>('DOMAIN_VERIFIER') ?? (config.get<string>('NODE_ENV') === 'test' ? 'MOCK' : 'DNS')) ===
        'MOCK'
          ? new MockDomainVerifier(
              new URL(config.getOrThrow<string>('PUBLIC_APP_URL')).hostname.toLowerCase(),
              async (host) => {
                const holder = await prisma.restaurant.findUnique({
                  where: { customDomain: host },
                  select: { id: true },
                });
                return holder ? domainChallenge(config.getOrThrow<string>('JWT_SECRET'), holder.id, host).value : null;
              },
            )
          : new DnsDomainVerifier(),
    },
  ],
  exports: [DomainsService],
})
export class DomainsModule {}
