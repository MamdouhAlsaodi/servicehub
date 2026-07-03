const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testRegex: '\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  rootDir: path.resolve(__dirname, 'src'),
  transform: {
    '^.+\\.ts$': ['ts-jest', { 
      tsconfig: path.resolve(__dirname, 'tsconfig.json') 
    }],
  },
  testTimeout: 30000,
  collectCoverageFrom: [
    'modules/auth/**/*.ts',
    '!modules/auth/**/*.module.ts',
    '!modules/auth/**/*.dto.ts',
  ],
  coverageDirectory: path.resolve(__dirname, 'coverage'),
  globalSetup: undefined,
  globalTeardown: undefined,
  forceExit: true,
};
