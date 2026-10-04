import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockSmsProvider, SMS_PROVIDER } from './sms.provider';
import type { SmsProvider } from './sms.provider';
import { MockWhatsAppProvider, WHATSAPP_PROVIDER } from './whatsapp.provider';
import type { WhatsAppProvider } from './whatsapp.provider';
import { IletiMerkeziSmsProvider } from './providers/ileti-merkezi.provider';
import { MetaWhatsAppProvider } from './providers/meta-whatsapp.provider';
import { NetgsmSmsProvider } from './providers/netgsm.provider';
import { TwilioSmsProvider } from './providers/twilio.provider';
import { MessagingService } from './messaging.service';
import { ProviderBalanceMonitor } from './provider-balance.monitor';

/** The SMS gateway named by SMS_PROVIDER; env.ts has already checked that its credentials are present. */
function smsProviderFor(config: ConfigService, mock: MockSmsProvider): SmsProvider {
  switch (config.get<string>('SMS_PROVIDER')) {
    case 'NETGSM':
      return new NetgsmSmsProvider({
        user: config.getOrThrow<string>('NETGSM_USER'),
        password: config.getOrThrow<string>('NETGSM_PASSWORD'),
        header: config.getOrThrow<string>('NETGSM_HEADER'),
      });
    case 'ILETI_MERKEZI':
      return new IletiMerkeziSmsProvider({
        user: config.getOrThrow<string>('ILETI_MERKEZI_USER'),
        password: config.getOrThrow<string>('ILETI_MERKEZI_PASSWORD'),
        sender: config.getOrThrow<string>('ILETI_MERKEZI_SENDER'),
      });
    case 'TWILIO':
      return new TwilioSmsProvider({
        accountSid: config.getOrThrow<string>('TWILIO_ACCOUNT_SID'),
        authToken: config.getOrThrow<string>('TWILIO_AUTH_TOKEN'),
        from: config.getOrThrow<string>('TWILIO_FROM_NUMBER'),
      });
    default:
      return mock;
  }
}

function whatsAppProviderFor(config: ConfigService, mock: MockWhatsAppProvider): WhatsAppProvider {
  if (config.get<string>('WHATSAPP_PROVIDER') === 'META') {
    return new MetaWhatsAppProvider({
      accessToken: config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN'),
      phoneNumberId: config.getOrThrow<string>('WHATSAPP_PHONE_NUMBER_ID'),
    });
  }
  return mock;
}

/**
 * Messaging engine (docs/MESAJLASMA.md): one SMS and one WhatsApp provider
 * behind tokens and the service every message goes through. The gateway is
 * chosen by SMS_PROVIDER and WHATSAPP_PROVIDER; MOCK is the default outside
 * production. Credits (MessageWallet) are debited only when a provider
 * accepts a message; OTP and staff invites are platform traffic and never
 * charge a restaurant.
 */
@Global()
@Module({
  providers: [
    MockSmsProvider,
    MockWhatsAppProvider,
    { provide: SMS_PROVIDER, inject: [ConfigService, MockSmsProvider], useFactory: smsProviderFor },
    { provide: WHATSAPP_PROVIDER, inject: [ConfigService, MockWhatsAppProvider], useFactory: whatsAppProviderFor },
    MessagingService,
    ProviderBalanceMonitor,
  ],
  exports: [SMS_PROVIDER, WHATSAPP_PROVIDER, MessagingService, ProviderBalanceMonitor],
})
export class MessagingModule {}
