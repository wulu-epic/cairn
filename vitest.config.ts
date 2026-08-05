import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Scope test discovery to project source + test dirs only.
    // Without this, vitest's default glob (**/*.test.ts) picks up test
    // files from claude-skills/ and other vendored directories.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],

    // Run test files sequentially (not in parallel). E2E tests launch
    // Chrome via execSync — parallel launches cause session/port conflicts
    // on the same machine. Unit tests are fast enough that sequential
    // file execution has negligible cost (~14ms for 30 unit tests).
    fileParallelism: false,
  },
});
