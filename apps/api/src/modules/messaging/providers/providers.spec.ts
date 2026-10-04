import type { SmsProvider } from '../sms.provider';
import { IletiMerkeziSmsProvider } from './ileti-merkezi.provider';
import { MetaWhatsAppProvider } from './meta-whatsapp.provider';
import { NetgsmSmsProvider } from './netgsm.provider';
import { TwilioSmsProvider } from './twilio.provider';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A fetch that records the request and answers with the given body and status. */
function fake(body: unknown, status = 200): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const TO = '+905321234567';

describe('SMS and WhatsApp provider adapters', () => {
  it('Netgsm: basic auth, digits-only number, accepted codes, job id and summed balance', async () => {
    const ok = fake({ code: '00', jobid: '123456' });
    const netgsm = new NetgsmSmsProvider({ user: 'u', password: 'p', header: 'RESGET', fetchImpl: ok.fetchImpl });
    await expect(netgsm.send(TO, 'merhaba')).resolves.toEqual({ accepted: true, providerRef: '123456' });
    expect(ok.calls[0].url).toBe('https://api.netgsm.com.tr/sms/rest/v2/send');
    expect(ok.calls[0].headers.authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
    const sent = JSON.parse(ok.calls[0].body ?? '{}') as { msgheader: string; messages: { no: string; msg: string }[] };
    expect(sent.msgheader).toBe('RESGET');
    expect(sent.messages[0]).toEqual({ msg: 'merhaba', no: '905321234567' });

    const refused = new NetgsmSmsProvider({
      user: 'u',
      password: 'p',
      header: 'RESGET',
      fetchImpl: fake({ code: '30' }).fetchImpl,
    });
    await expect(refused.send(TO, 'x')).resolves.toEqual({ accepted: false, providerRef: null });

    const balance = new NetgsmSmsProvider({
      user: 'u',
      password: 'p',
      header: 'RESGET',
      fetchImpl: fake({ balance: [{ amount: 1200 }, { amount: '300.5' }] }).fetchImpl,
    });
    await expect(balance.balance()).resolves.toBe(1500);
  });

  it('Ileti Merkezi: JSON envelope with credentials, status 200 accepted, order id, SMS balance', async () => {
    const ok = fake({ response: { status: { code: '200' }, order: { id: 987 } } });
    const provider = new IletiMerkeziSmsProvider({
      user: 'u',
      password: 'p',
      sender: 'RESGET',
      fetchImpl: ok.fetchImpl,
    });
    await expect(provider.send(TO, 'merhaba')).resolves.toEqual({ accepted: true, providerRef: '987' });
    expect(ok.calls[0].url).toBe('https://api.iletimerkezi.com/v1/send-sms/json');
    const sent = JSON.parse(ok.calls[0].body ?? '{}') as {
      request: {
        authentication: { username: string };
        order: { sender: string; message: { receipents: { number: string[] } } };
      };
    };
    expect(sent.request.authentication.username).toBe('u');
    expect(sent.request.order.sender).toBe('RESGET');
    expect(sent.request.order.message.receipents.number).toEqual(['905321234567']);

    const refused = new IletiMerkeziSmsProvider({
      user: 'u',
      password: 'p',
      sender: 'RESGET',
      fetchImpl: fake({ response: { status: { code: '401' } } }).fetchImpl,
    });
    await expect(refused.send(TO, 'x')).resolves.toEqual({ accepted: false, providerRef: null });

    const balance = new IletiMerkeziSmsProvider({
      user: 'u',
      password: 'p',
      sender: 'RESGET',
      fetchImpl: fake({ response: { status: { code: '200' }, balance: { amount: '12.5', sms: '840' } } }).fetchImpl,
    });
    await expect(balance.balance()).resolves.toBe(840);
  });

  it('Twilio: form body with basic auth, queued is accepted, sid is the reference, no balance', async () => {
    const ok = fake({ sid: 'SM123', status: 'queued' }, 201);
    const twilio = new TwilioSmsProvider({
      accountSid: 'AC1',
      authToken: 't',
      from: '+15550001111',
      fetchImpl: ok.fetchImpl,
    });
    await expect(twilio.send(TO, 'hello')).resolves.toEqual({ accepted: true, providerRef: 'SM123' });
    expect(ok.calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(ok.calls[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(ok.calls[0].body).toBe(new URLSearchParams({ To: TO, From: '+15550001111', Body: 'hello' }).toString());
    const asProvider: SmsProvider = twilio;
    expect(asProvider.balance).toBeUndefined();

    const failed = new TwilioSmsProvider({
      accountSid: 'AC1',
      authToken: 't',
      from: '+15550001111',
      fetchImpl: fake({ code: 21211, message: 'invalid number' }, 400).fetchImpl,
    });
    await expect(failed.send(TO, 'x')).resolves.toEqual({ accepted: false, providerRef: null });
  });

  it('Meta WhatsApp: bearer token, graph path, message id, refusal outside the window', async () => {
    const ok = fake({ messages: [{ id: 'wamid.1' }] });
    const meta = new MetaWhatsAppProvider({ accessToken: 'tok', phoneNumberId: '1001', fetchImpl: ok.fetchImpl });
    await expect(meta.send(TO, 'merhaba')).resolves.toEqual({ accepted: true, providerRef: 'wamid.1' });
    expect(ok.calls[0].url).toBe('https://graph.facebook.com/v21.0/1001/messages');
    expect(ok.calls[0].headers.authorization).toBe('Bearer tok');
    const sent = JSON.parse(ok.calls[0].body ?? '{}') as {
      messaging_product: string;
      to: string;
      text: { body: string };
    };
    expect(sent).toMatchObject({ messaging_product: 'whatsapp', to: '905321234567', text: { body: 'merhaba' } });

    const refused = new MetaWhatsAppProvider({
      accessToken: 'tok',
      phoneNumberId: '1001',
      fetchImpl: fake({ error: { code: 131047, message: 'Re-engagement message' } }, 400).fetchImpl,
    });
    await expect(refused.send(TO, 'x')).resolves.toEqual({ accepted: false, providerRef: null });
  });

  it('network trouble surfaces as an error for the engine to log as PROVIDER_ERROR', async () => {
    const down = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    const netgsm = new NetgsmSmsProvider({ user: 'u', password: 'p', header: 'RESGET', fetchImpl: down });
    await expect(netgsm.send(TO, 'x')).rejects.toThrow('socket hang up');
  });
});
