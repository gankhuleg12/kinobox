import { describe, it, expect } from 'vitest';
import { summarize } from './deliveries.js';

describe('webhook delivery summary', () => {
  it('lists fields and explains skipped page-own comments', () => {
    const r = summarize(
      {
        object: 'page',
        entry: [
          {
            changes: [
              { field: 'feed', value: { item: 'comment', verb: 'add', from: { id: 'PAGE' } } },
              { field: 'feed', value: { item: 'reaction', verb: 'add' } },
            ],
            messaging: [{ message: { is_echo: true } }],
          },
        ],
      },
      'PAGE',
    );
    expect(r.fields).toEqual(['feed:comment:add', 'feed:reaction:add', 'messages']);
    expect(r.skipped).toContain('Page өөрөө бичсэн comment');
    expect(r.skipped).toContain('echo мессеж');
  });

  it('flags non-page objects', () => {
    expect(summarize({ object: 'instagram', entry: [] }, 'PAGE').skipped).toEqual(['object=instagram']);
  });
});
