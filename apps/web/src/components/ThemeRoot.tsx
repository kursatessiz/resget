import { resolveTheme, themeColorScheme, themeCssVariables, themePuiMode } from '@resget/shared';
import type { AppearancePreference, TenantThemeInput } from '@resget/shared';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Applies the design system to a subtree: the Perfect UI tokens with the
 * restaurant's primary color as `--pui-theme` and the viewer's light/dark
 * choice. Server component: no client JavaScript is needed for the public
 * menu page to render in the restaurant's color.
 */
export function ThemeRoot({
  tenantTheme,
  colorScheme = 'SYSTEM',
  children,
}: {
  tenantTheme: TenantThemeInput | null;
  colorScheme?: AppearancePreference['colorScheme'];
  children: ReactNode;
}) {
  const resolved = resolveTheme({ tenant: tenantTheme, appearance: { colorScheme }, systemMode: 'light' });
  const vars = themeCssVariables(resolved) as CSSProperties;
  return (
    <div
      data-pui-mode={themePuiMode(colorScheme)}
      style={{
        ...vars,
        colorScheme: themeColorScheme(colorScheme),
        fontFamily: 'var(--font-body)',
        fontSize: 'var(--pui-font-size)',
        backgroundColor: 'var(--pui-bg)',
        color: 'var(--pui-text)',
        minHeight: '100vh',
      }}
    >
      {children}
    </div>
  );
}
