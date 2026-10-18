import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'apps/server/vitest.config.ts',
      {
        test: {
          name: 'mobile',
          environment: 'node',
          include: ['apps/mobile/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'learning-client',
          environment: 'node',
          include: ['packages/learning-client/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'api-client',
          environment: 'node',
          include: ['packages/api-client/test/**/*.test.ts'],
        },
      },
    ],
  },
});
