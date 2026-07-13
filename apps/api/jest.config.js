const path = require('path');

// Project layout for Jest discovery:
//   apps/api/src/**/*.spec.ts   — original spec location
//   apps/api/test/**/*.spec.ts  — A1/A2 regression tests
// Both are scanned by configuring two roots. We keep rootDir as src
// for transform/snapshot paths and add `roots` so jest finds tests
// in the sibling test/ directory as well.
const SRC_ROOT = path.resolve(__dirname, 'src');
const TEST_ROOT = path.resolve(__dirname, 'test');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testRegex: '\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  rootDir: SRC_ROOT,
  roots: [SRC_ROOT, TEST_ROOT],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: path.resolve(__dirname, 'tsconfig.json'),
    }],
  },
  testTimeout: 30000,
  collectCoverageFrom: [
    'modules/auth/**/*.ts',
    '!modules/auth/**/*.module.ts',
    '!modules/auth/**/*.dto.ts',
  ],
  coverageDirectory: path.resolve(__dirname, 'coverage'),
  // setupFiles (NOT setupFilesAfterEach) — runs BEFORE the test
  // framework and BEFORE any SUT module is imported. This is the
  // only correct point to mutate process.env.DATABASE_URL so that
  // PrismaClient() in the SUT sees the test DB URL.
  setupFiles: ['<rootDir>/../test/setup-env.ts'],
  globalSetup: undefined,
  globalTeardown: undefined,
  // Phase A2: removed forceExit:true. If Jest hangs on exit it
  // surfaces the open-handle, which is the correct signal. The
  // repo provides `npm run test:detect` for ad-hoc diagnosis.
  forceExit: false,
};