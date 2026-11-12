import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'mysql://test:test@localhost:3306/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0000',
      JWT_PLAYBACK_SECRET: 'test-playback-secret-test-playback-secret-00',
      COOKIE_SECRET: 'test-cookie-secret-test-cookie-secret-000000',
      SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    },
  },
});
