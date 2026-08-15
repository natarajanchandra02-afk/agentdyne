// Real unit-test config for src/__tests__/**. Separate and unrelated to the
// Cloudflare Pages *build* (next-on-pages doesn't run Jest) — this only runs
// via `npm test`, locally or in CI, and never touches the deploy pipeline.
// isolatedModules: true — ts-jest transpiles only, doesn't type-check (that's
// `npm run type-check`'s job); keeps test runs fast and decoupled from
// unrelated in-flight type errors elsewhere in the project.
import type { Config } from "jest"

const config: Config = {
  preset:           "ts-jest",
  testEnvironment:  "node",
  testMatch:        ["<rootDir>/src/__tests__/**/*.test.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { isolatedModules: true, tsconfig: { target: "ES2020" } }],
  },
}

export default config
