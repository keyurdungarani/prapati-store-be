import { defineConfig } from "vitest/config";

// The backend is CommonJS; vitest transforms the test files, so they can use
// ESM syntax and import the CJS modules directly.
export default defineConfig({
    test: {
        environment: "node",
        globalSetup: ["./test/globalSetup.mjs"],
        include: ["test/**/*.test.{js,mjs}"],
        // Spinning up a replica set and running transactions is slower than a
        // plain unit test, and Windows is slower again.
        testTimeout: 60_000,
        hookTimeout: 120_000,
        // One worker: every file shares the single in-memory replica set, and
        // the invariant test must not race other files writing to the same
        // collections. (vitest 4 moved these to the top level of `test`.)
        pool: "forks",
        maxForks: 1,
        minForks: 1,
        fileParallelism: false,
    },
});
