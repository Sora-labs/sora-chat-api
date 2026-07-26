module.exports = {
  moduleNameMapper: {
    '^@/src/(.*)$': '<rootDir>/src/$1',
    '^@@packages/(.*)$': '<rootDir>/../packages/$1', // Adjust nesting as needed for your monorepo
  },
};