/**
 * Runs before any module is imported: the API validates its environment when AppModule is loaded, so limits the
 * suites rely on are set here rather than in createTestApp.
 */
// Every suite signs in from the same address; the per-client sign-in limit itself is a unit of the guard.
process.env.PUBLIC_OTP_RATE_LIMIT ??= '100000';
