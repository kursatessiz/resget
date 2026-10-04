// Imported before the app module so its environment validation sees it: IndexNow pings are recorded, not sent.
process.env.INDEXNOW_PROVIDER = 'MOCK';
