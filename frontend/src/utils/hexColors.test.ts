/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

/**
 * E00-S02 rule 13 and acceptance 12: no hex colour literal anywhere under `src/`. Colours come
 * from tokens in `config/theme.ts` (outside `src`) or Ant Design presets.
 */
const sources = import.meta.glob(
  [
    '/src/**/*.{ts,tsx,js,jsx,less,css,json}',
    '!/src/.umi/**',
    '!/src/.umi-production/**',
    '!/src/.umi-test/**',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

describe('no hex colour literals under src/', () => {
  it('scans the source tree', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it('finds none', () => {
    const hits = Object.entries(sources).flatMap(([file, text]) =>
      (text.match(HEX_COLOUR) ?? []).map((match) => `${file}: ${match}`),
    );
    expect(hits).toEqual([]);
  });
});
