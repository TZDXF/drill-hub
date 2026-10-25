import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = {
  '#server': fileURLToPath(new URL('apps/server/src', import.meta.url)),
  '#mobile': fileURLToPath(new URL('apps/mobile/src', import.meta.url)),
  '#learning-client': fileURLToPath(new URL('packages/learning-client/src', import.meta.url)),
  '#api-client': fileURLToPath(new URL('packages/api-client/src', import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      'apps/server/vitest.config.ts',
      {
        resolve: { alias },
        test: {
          name: 'mobile',
          environment: 'node',
          include: ['apps/mobile/test/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'learning-client',
          environment: 'node',
          include: ['packages/learning-client/test/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'api-client',
          environment: 'node',
          include: ['packages/api-client/test/**/*.test.ts'],
        },
      },
    ],
  },
});
