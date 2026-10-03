import { Global, Module } from '@nestjs/common';
import { MockSmsProvider, SMS_PROVIDER } from './sms.provider';
import { MockWhatsAppProvider, WHATSAPP_PROVIDER } from './whatsapp.provider';
import { MessagingService } from './messaging.service';
import { ProviderBalanceMonitor } from './provider-balance.monitor';

/**
 * Messaging engine (docs/MESAJLASMA.md): one SMS and one WhatsApp provider
 * behind tokens and the service every message goes through. Credits
 * (MessageWallet) are debited only when a provider accepts a message; OTP
 * and staff invites are platform traffic and never charge a restaurant.
 */
@Global()
@Module({
  providers: [
    MockSmsProvider,
    MockWhatsAppProvider,
    { provide: SMS_PROVIDER, useExisting: MockSmsProvider },
    { provide: WHATSAPP_PROVIDER, useExisting: MockWhatsAppProvider },
    MessagingService,
    ProviderBalanceMonitor,
  ],
  exports: [SMS_PROVIDER, WHATSAPP_PROVIDER, MessagingService, ProviderBalanceMonitor],
})
export class MessagingModule {}
