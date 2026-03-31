import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Runs once before all test files — sets up the in-memory MongoDB connection
    globalSetup: './src/tests/globalSetup.ts',
    // Runs before each test file — clears collections between test files
    setupFiles: ['./src/tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Run all test files in the same process so they share the mongoose connection.
    // In Vitest 4, singleFork and pool are top-level options (poolOptions was removed).
    pool: 'forks',
    singleFork: true,
    // Enforce sequential file execution so tests don't race on the shared MongoDB.
    fileParallelism: false,
  },
});
