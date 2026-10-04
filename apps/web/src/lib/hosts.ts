/**
 * Hosts that are the platform itself; everything else that reaches us is a
 * restaurant's custom domain. Pure, so the middleware and server components
 * share it.
 */
export function isPlatformHost(host: string, webDomain: string | undefined = process.env.WEB_DOMAIN): boolean {
  const platform = (webDomain ?? '').toLowerCase();
  return host === platform || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}

/** The host a request came in on, without the port. */
export function hostOf(header: string | null): string {
  return (header ?? '').split(':')[0].toLowerCase();
}
