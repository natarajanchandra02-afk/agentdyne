import type { Config } from "jest"
import nextJest from "next/jest.js"

const createJestConfig = nextJest({ dir: "./" })

const config: Config = {
  displayName:       "agentdyne-platform",
  testEnvironment:   "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: [
    "<rootDir>/src/__tests__/**/*.test.ts",
    "<rootDir>/src/__tests__/**/*.test.tsx",
  ],
  collectCoverageFrom: [
    "src/lib/**/*.ts",
    "src/app/api/**/*.ts",
    "!src/**/*.d.ts",
  ],
  coverageThreshold: {
    global: {
      lines:      95,
      branches:   90,
      functions:  95,
      statements: 95,
    },
  },
  setupFilesAfterFramework: [],
  transformIgnorePatterns: ["/node_modules/(?!(nanoid)/)"],
}

export default createJestConfig(config)
