// globalSetup.ts
// Runs ONCE before the entire test suite (not per-file).
// Starts an in-memory MongoDB server and stores the URI in an env var
// so every test file can connect to the same instance.
//
// Using mongodb-memory-server means:
//   - No Docker or running MongoDB needed to run tests
//   - Each test run starts with a clean database
//   - Tests are fully isolated from production data

import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod: MongoMemoryServer;

export async function setup(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  // Make the URI available to all test files via environment variable
  process.env['MONGO_TEST_URI'] = mongod.getUri();
}

export async function teardown(): Promise<void> {
  await mongod.stop();
}
