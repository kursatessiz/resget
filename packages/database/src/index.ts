/**
 * Re-exports the generated client. There is deliberately no shared client instance here: constructing a
 * PrismaClient loads its query engine, and an engine that was never connected is never released, so a
 * module-level instance cost every importer an idle engine and, under Jest (one module registry per test
 * file), kept each finished test file's whole module graph alive. The API owns its client (PrismaService);
 * scripts and tests construct their own and disconnect it.
 */
export * from '@prisma/client';
