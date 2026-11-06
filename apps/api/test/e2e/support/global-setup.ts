import v8 from 'node:v8';

/**
 * The suites run in band, each test file in its own module registry. Express builds every app's request and
 * response objects on node's shared http prototypes, and V8 keeps the maps of such objects (and through their
 * getters each finished test file's whole registry) for as long as those prototypes live: an ordinary full
 * collection never frees them, only a memory-reducing one near the heap limit. Not retaining maps lets every
 * collection reclaim a finished file, so the heap stays flat instead of climbing to the limit and back.
 * A V8 garbage collection heuristic only; it changes nothing the tests observe.
 */
export default function globalSetup(): void {
  v8.setFlagsFromString('--retain-maps-for-n-gc=0');
}
