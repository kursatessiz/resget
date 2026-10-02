/**
 * Imported first by main.ts, before anything reads the environment: removes
 * empty variables from process.env so they read as unset everywhere.
 * docker-compose.prod.yml passes every optional key as `KEY: ${KEY:-}`, so an
 * unset key arrives as an empty string.
 */
for (const key of Object.keys(process.env)) {
  if (process.env[key] === '') delete process.env[key];
}

export {};
