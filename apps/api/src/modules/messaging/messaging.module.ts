import { Global, Module } from '@nestjs/common';
import { MockSmsProvider, SMS_PROVIDER } from './sms.provider';

/**
 * Messaging engine seed: one SMS provider behind a token. Credits
 * (MessageWallet) are debited only when a provider accepts a message; the
 * OTP flow is platform traffic and never charges a restaurant.
 */
@Global()
@Module({
  providers: [MockSmsProvider, { provide: SMS_PROVIDER, useExisting: MockSmsProvider }],
  exports: [SMS_PROVIDER],
})
export class MessagingModule {}
