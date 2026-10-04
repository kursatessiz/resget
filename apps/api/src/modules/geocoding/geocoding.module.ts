import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GEOCODER, GoogleGeocoder, MockGeocoder, NominatimGeocoder } from './geocoders';
import { GeocodingService } from './geocoding.service';

/** Address geocoding; global so orders, the storefront, the account and sign-up share one cache and one rate limiter. */
@Global()
@Module({
  providers: [
    {
      provide: GEOCODER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider =
          config.get<string>('GEOCODER_PROVIDER') ??
          (config.get<string>('NODE_ENV') === 'production' ? 'NONE' : 'MOCK');
        switch (provider) {
          case 'MOCK':
            return new MockGeocoder();
          case 'NOMINATIM':
            return new NominatimGeocoder(
              config.get<string>('NOMINATIM_BASE_URL') ?? 'https://nominatim.openstreetmap.org',
              `Resget/${config.get<string>('APP_RELEASE', 'dev')} (+${config.getOrThrow<string>('PUBLIC_APP_URL')})`,
            );
          case 'GOOGLE':
            return new GoogleGeocoder(config.getOrThrow<string>('GOOGLE_MAPS_API_KEY'));
          default:
            return null;
        }
      },
    },
    GeocodingService,
  ],
  exports: [GeocodingService],
})
export class GeocodingModule {}
