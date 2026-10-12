import type { ConfigService } from '@nestjs/config';
import { ImageHostAllowlistSchema, imageUrlAllowed } from '@resget/shared';
import type { ImageUrlPolicy } from '@resget/shared';
import { badRequest } from './api-error';

/** The deployment's image link policy: the API's own upload origin plus IMAGE_HOST_ALLOWLIST (docs/GUVENLIK.md). */
export function imageUrlPolicy(config: ConfigService): ImageUrlPolicy {
  return {
    uploadOrigin: config.getOrThrow<string>('PUBLIC_API_URL'),
    allowedHosts: ImageHostAllowlistSchema.parse(config.get<string>('IMAGE_HOST_ALLOWLIST')),
  };
}

/**
 * Refuses a logo or menu image link diners' browsers must not load: anything but the platform's uploads or an
 * allowlisted https host. The shared schema already refused other schemes and credentials; null clears the image.
 */
export function assertImageUrlAllowed(config: ConfigService, url: string | null | undefined): void {
  if (url === null || url === undefined) return;
  if (!imageUrlAllowed(url, imageUrlPolicy(config))) {
    throw badRequest('IMAGE_URL_NOT_ALLOWED', 'Images come from the platform uploads or an allowlisted https host');
  }
}
