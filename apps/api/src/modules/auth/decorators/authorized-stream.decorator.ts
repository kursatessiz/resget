import { UseInterceptors } from '@nestjs/common';
import { StreamAccessInterceptor } from '../stream-access.interceptor';

/**
 * An authenticated event stream (@Sse): it ends when the access token expires and when a periodic re-run of
 * the guards fails, and the tenant context follows the current permissions (docs/SIPARIS_VE_SEVK.md).
 */
export const AuthorizedStream = () => UseInterceptors(StreamAccessInterceptor);
