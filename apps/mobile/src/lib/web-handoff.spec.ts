import { webPageUrl } from './web-handoff';

jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./config', () => ({ WEB_BASE_URL: 'https://resget.example' }));

describe('webPageUrl', () => {
  it('carries the session through the handoff route when a code was issued', () => {
    expect(webPageUrl('https://resget.example/', '/kebapci', 'A'.repeat(43))).toBe(
      `https://resget.example/api/session/handoff?code=${'A'.repeat(43)}&next=%2Fkebapci`,
    );
  });

  it('opens the page signed out without a code', () => {
    expect(webPageUrl('https://resget.example/', '/kebapci', null)).toBe('https://resget.example/kebapci');
  });
});
