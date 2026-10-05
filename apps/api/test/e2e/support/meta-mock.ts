/** Imported before the app is built: Meta runs against the MOCK graph, and webhook deliveries are signed with a test secret. */
process.env.META_PROVIDER = 'MOCK';
process.env.META_APP_SECRET = 'e2e-meta-app-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'e2e-meta-verify-token';
export {};
