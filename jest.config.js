module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'ts'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  verbose: true,
  globals: {
    'ts-jest': {
      tsConfig: './__tests__/tsconfig.jest.json'
    }
  }
}
