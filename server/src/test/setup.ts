import { vi } from 'vitest';

// Unit test-үүд бодит Redis/MySQL шаардахгүй
vi.mock('../lib/redis.js', () => {
  const fake = { get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), publish: vi.fn(), on: vi.fn(), call: vi.fn() };
  return { redis: fake, createBullConnection: () => fake, createSubscriber: () => fake };
});
