import { describe, it, expect } from 'vitest';
import { slugify } from './slug.js';

describe('slugify', () => {
  it('transliterates Mongolian Cyrillic', () => {
    expect(slugify('Талын тэнгэрийн хаяа')).toBe('talyn-tengeriin-khayaa');
    expect(slugify('Өвөл Үүр')).toBe('uvul-uur');
  });
  it('strips unsafe characters', () => {
    expect(slugify('  Hello, <World>!! 2025 ')).toBe('hello-world-2025');
  });
});
