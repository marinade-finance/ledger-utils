/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 120000,
  detectOpenHandles: true,
  modulePathIgnorePatterns: ['dist/'],
  testPathIgnorePatterns: ['__tests__/.*.skip.ts'],
}
