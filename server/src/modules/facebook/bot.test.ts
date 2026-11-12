import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';

vi.mock('../settings/settings.service.js', () => ({ settings: { get: vi.fn(), getMany: vi.fn(), require: vi.fn() } }));

const { extractCodeCandidates, normalizeCode, verifyFacebookSignature, extractJobs } = await import('./bot.service.js');

describe('code extraction', () => {
  it.each([
    ['1', '1'],
    [' 1 ', '1'],
    ['#1', '1'],
    ['1!', '1'],
    ['a12', 'A12'],
    ['12 үзмээр байна', '12'],
  ])('%s → %s', (text, code) => {
    expect(extractCodeCandidates(text)).toContain(code);
  });

  it('ignores long chatter', () => {
    expect(extractCodeCandidates('Сайн байна уу энэ кино хэзээ гарах вэ? '.repeat(3))).toEqual([]);
  });

  it('normalizes codes', () => {
    expect(normalizeCode(' #a 1 ')).toBe('A1');
  });
});

describe('facebook signature', () => {
  const secret = 'app-secret';
  const body = Buffer.from('{"object":"page"}');
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

  it('accepts valid', () => expect(verifyFacebookSignature(secret, body, sig)).toBe(true));
  it('rejects invalid', () => expect(verifyFacebookSignature(secret, Buffer.from('{}'), sig)).toBe(false));
  it('rejects missing', () => expect(verifyFacebookSignature(secret, body, undefined)).toBe(false));
});

describe('extractJobs', () => {
  const pageId = 'PAGE';
  const payload = {
    object: 'page',
    entry: [
      {
        changes: [
          { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c1', post_id: 'p1', message: '1', from: { id: 'u1', name: 'Bat' } } },
          { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c2', post_id: 'p1', message: '1', from: { id: pageId } } },
          { field: 'feed', value: { item: 'comment', verb: 'edited', comment_id: 'c3', message: '1', from: { id: 'u2' } } },
          { field: 'feed', value: { item: 'reaction', verb: 'add', from: { id: 'u3' } } },
        ],
        messaging: [
          { sender: { id: 'u4' }, message: { mid: 'm1', text: '2' } },
          { sender: { id: pageId }, message: { mid: 'm2', text: 'echo', is_echo: true } },
        ],
      },
    ],
  };

  it('picks new user comments and messages only', () => {
    expect(extractJobs(payload, pageId)).toEqual([
      { kind: 'COMMENT', externalId: 'c1', postId: 'p1', senderId: 'u1', senderName: 'Bat', text: '1' },
      { kind: 'MESSAGE', externalId: 'm1', senderId: 'u4', text: '2' },
    ]);
  });

  it('ignores non-page objects', () => {
    expect(extractJobs({ object: 'user', entry: [] }, pageId)).toEqual([]);
  });
});
