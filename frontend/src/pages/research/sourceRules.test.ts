import { describe, expect, it } from 'vitest';
import {
  defaultSourceLabel,
  normalizeSourceValue,
  validateSourceValue,
} from './sourceRules';

describe('source value rules (E02-S01 rule 4)', () => {
  it('trims and collapses whitespace in search queries', () => {
    expect(
      normalizeSourceValue('web_search', '  specialty   coffee\ttrends '),
    ).toBe('specialty coffee trends');
  });

  it('keeps Persian queries intact apart from whitespace', () => {
    expect(normalizeSourceValue('web_search', ' ترند  قهوه دمی ')).toBe(
      'ترند قهوه دمی',
    );
    expect(validateSourceValue('web_search', 'ترند قهوه دمی')).toBeNull();
  });

  it('lowercases scheme and host of feed URLs but not the path', () => {
    expect(normalizeSourceValue('rss', ' HTTPS://Sprudge.com/Feed/ ')).toBe(
      'https://sprudge.com/Feed/',
    );
  });

  it('enforces query length 3–200', () => {
    expect(validateSourceValue('web_search', 'ab')).toMatch(/at least 3/);
    expect(validateSourceValue('web_search', 'a'.repeat(201))).toMatch(
      /at most 200/,
    );
    expect(validateSourceValue('web_search', 'abc')).toBeNull();
  });

  it.each([
    ['ftp://example.com/feed'],
    ['example.com/feed'],
    ['http://127.0.0.1/feed'],
    ['http://localhost/feed'],
    ['http://[::1]/feed'],
  ])('rejects the feed address %s', (value) => {
    expect(validateSourceValue('rss', value)).not.toBeNull();
  });

  it('accepts a public feed address and rejects one over 500 characters', () => {
    expect(validateSourceValue('rss', 'https://sprudge.com/feed/')).toBeNull();
    expect(
      validateSourceValue('rss', `https://example.com/${'a'.repeat(500)}`),
    ).toMatch(/at most 500/);
  });

  it('defaults the label to the query or the feed host', () => {
    expect(defaultSourceLabel('rss', 'HTTPS://Sprudge.com/feed/')).toBe(
      'sprudge.com',
    );
    expect(defaultSourceLabel('web_search', ' coffee  trends ')).toBe(
      'coffee trends',
    );
  });
});
