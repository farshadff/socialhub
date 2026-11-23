import { describe, expect, it } from 'vitest';
import type { BrandProfile } from '@/services/socialhub/accounts';
import { hex } from '@/utils/testing';
import {
  contrastRatio,
  formValuesFrom,
  listProblem,
  missingForComplete,
  normalizeList,
  toBrandUpdate,
} from './brandLogic';

const brand = (overrides: Partial<BrandProfile> = {}): BrandProfile => ({
  account: 1,
  logo_light: null,
  logo_dark: null,
  colors: {
    primary: hex('111111'),
    secondary: hex('666666'),
    accent: hex('1677FF'),
    background: hex('FFFFFF'),
    text: hex('111111'),
  },
  fonts: { heading: 'vazirmatn', body: 'vazirmatn' },
  tone_of_voice: '',
  audience_summary: '',
  content_pillars: [],
  default_hashtags: [],
  banned_terms: [],
  cta_examples: [],
  handle_display: '@greenhome.ir',
  ai_disclosure: 'generated_only',
  complete: false,
  warnings: [],
  updated_at: '2026-11-23T09:01:12Z',
  ...overrides,
});

describe('brand logic', () => {
  it('computes WCAG contrast like the API (test notes: 21:1 and 4.48:1)', () => {
    expect(contrastRatio(hex('000000'), hex('FFFFFF'))).toBeCloseTo(21, 5);
    expect(contrastRatio(hex('777777'), hex('FFFFFF'))).toBeCloseTo(4.48, 2);
    expect(contrastRatio('nope', hex('FFFFFF'))).toBeNull();
  });

  it('strips # from hashtags and drops repeats ignoring case (acceptance 9)', () => {
    expect(
      normalizeList(['#خانه_سبز', 'خانه_سبز', ' #Coffee ', 'coffee'], true),
    ).toEqual(['خانه_سبز', 'Coffee']);
    expect(normalizeList([' Tips ', '', 'Tips', 'tips'])).toEqual([
      'Tips',
      'tips',
    ]);
  });

  it('checks list limits', () => {
    const limits = { max: 2, maxItemLength: 5 };
    expect(listProblem(['a', 'b'], limits)).toBeNull();
    expect(listProblem(['a', 'b', 'c'], limits)).toBe('Up to 2 items.');
    expect(listProblem(['toolong'], limits)).toBe(
      'Each item can have up to 5 characters.',
    );
    expect(
      listProblem(['two words'], {
        max: 30,
        maxItemLength: 100,
        hashtag: true,
      }),
    ).toBe("Hashtags can't contain spaces or #.");
  });

  it('lists what the profile needs to be complete', () => {
    expect(missingForComplete(brand())).toEqual([
      'Add a logo for light backgrounds',
      'Describe the tone of voice',
    ]);
    expect(
      missingForComplete(
        brand({ logo_light: '/media/logo.png', tone_of_voice: 'Warm.' }),
      ),
    ).toEqual([]);
  });

  it('sends every editable field with colours in upper case', () => {
    const values = formValuesFrom(brand());
    values.colors.accent = hex('f2a541');
    const body = toBrandUpdate(values);
    expect(body.colors.accent).toBe(hex('F2A541'));
    expect(Object.keys(body).sort()).toEqual(
      [
        'ai_disclosure',
        'audience_summary',
        'banned_terms',
        'colors',
        'content_pillars',
        'cta_examples',
        'default_hashtags',
        'fonts',
        'handle_display',
        'tone_of_voice',
      ].sort(),
    );
  });
});
