import { test as setup } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE, signIn } from './support/session';

/**
 * Signs the demo owner in once and stores the cookies; the panel scenarios
 * reuse that state so the suite requests a single OTP for the owner instead
 * of tripping the per-phone request limit.
 */
setup('the owner signs in once for the panel scenarios', async ({ page }) => {
  await signIn(page, SEED.ownerPhone);
  await page.context().storageState({ path: OWNER_STATE });
});
