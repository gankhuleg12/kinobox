import { describe, it, expect, vi } from 'vitest';

vi.mock('../settings/settings.service.js', () => ({ settings: { get: vi.fn(), getMany: vi.fn() } }));
const { toBooleanQuery } = await import('./catalog.service.js');

describe('toBooleanQuery', () => {
  it('builds prefix terms', () => {
    expect(toBooleanQuery('night runner')).toBe('+night* +runner*');
  });
  it('strips boolean operators (no MATCH syntax injection)', () => {
    expect(toBooleanQuery('+foo -bar "baz" (qux)* @3')).toBe('+foo* +bar* +baz* +qux*');
  });
  it('drops single-character words', () => {
    expect(toBooleanQuery('a b')).toBe('');
  });
});
