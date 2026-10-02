import type { Metadata, Viewport } from 'next';
// Order matters: globals.css declares the cascade layer order before the kit's own layers appear.
import './globals.css';
import '@chrissgon/perfectui/perfectui.css';
import { DEFAULT_TENANT_THEME } from '@resget/shared';
import { getLocale, getT } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('common.appName'), description: t('landing.subheadline') };
}

export const viewport: Viewport = {
  themeColor: DEFAULT_TENANT_THEME.themePrimary,
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
