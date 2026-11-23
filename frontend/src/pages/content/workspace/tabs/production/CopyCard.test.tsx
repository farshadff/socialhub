import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import {
  getBrand,
  type Production,
  saveCopy,
} from '@/services/socialhub/production';
import CopyCard from './CopyCard';
import {
  captionTagCount,
  combinedLength,
  dedupeHashtags,
  hashtagProblem,
  normalizeHashtag,
} from './copyRules';
import { ProductionContext, type ProductionContextValue } from './shared';
import {
  contentItem,
  modelFor,
  production,
  withQueryClient,
} from './testFixtures';

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => modelFor(name),
  history: {},
}));
vi.mock('@/services/socialhub/production', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/production')>()),
  getBrand: vi.fn(),
  saveCopy: vi.fn(),
  generateCopy: vi.fn(),
}));

function context(
  resource: Production,
  overrides: Partial<ProductionContextValue> = {},
): ProductionContextValue {
  return {
    item: contentItem(),
    production: resource,
    accountId: 3,
    refetch: vi.fn(async () => undefined),
    setProduction: vi.fn(),
    reload: vi.fn(),
    activeJob: null,
    adoptableJob: null,
    jobRunning: false,
    runningReason: '',
    onJobStarted: vi.fn(),
    onJobEnded: vi.fn(),
    handleError: vi.fn(),
    onUrlExpired: vi.fn(),
    layout: '9x16',
    isCurrentDraft: true,
    ...overrides,
  };
}

function renderCard(
  resource: Production,
  overrides: Partial<ProductionContextValue> = {},
) {
  const value = context(resource, overrides);
  return render(
    withQueryClient(
      <ProductionContext.Provider value={value}>
        <CopyCard />
      </ProductionContext.Provider>,
    ),
  );
}

const english = production({
  caption: 'Hello',
  hashtags: ['budget'],
  alt_text: 'A desk',
  caption_preview: 'Hello\n\n#budget',
});

describe('Copy rules (E06-S06 rule 3)', () => {
  it('normalises hashtags as you type', () => {
    expect(normalizeHashtag('#Budget Tips')).toBe('Budget_Tips');
    expect(normalizeHashtag('##saving')).toBe('saving');
    expect(normalizeHashtag('بودجه‌بندی')).toBe('بودجه_بندی');
  });

  it('removes duplicates ignoring case', () => {
    expect(dedupeHashtags(['Budget_Tips', 'budget_tips', 'saving'])).toEqual([
      'Budget_Tips',
      'saving',
    ]);
  });

  it('rejects digits-only and badly sized tags', () => {
    expect(hashtagProblem('2026')).toBe("#2026 can't be only digits.");
    expect(hashtagProblem('a')).toBe('#a must be 2 to 50 characters.');
    expect(hashtagProblem('مدیریت_مالی')).toBeNull();
  });

  it('counts the combined text and the #tags inside the caption', () => {
    expect(combinedLength('Hello', ['budget'])).toBe('Hello\n\n#budget'.length);
    expect(combinedLength('Hello', [])).toBe(5);
    expect(captionTagCount('Save it #budget #saving #tips')).toBe(3);
  });
});

describe('Copy card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBrand).mockResolvedValue({ default_hashtags: ['budget'] });
  });

  it('shows the counters, including hashtags in the caption count', async () => {
    const screen = await renderCard(english);
    await expect
      .element(screen.getByText('14 / 2,200 including hashtags'))
      .toBeInTheDocument();
    await expect.element(screen.getByText('1 / 5')).toBeInTheDocument();
    await expect.element(screen.getByText('6 / 100')).toBeInTheDocument();
  });

  it('marks brand default hashtags', async () => {
    const screen = await renderCard(english);
    await expect.element(screen.getByText('brand')).toBeInTheDocument();
  });

  it('normalises typed hashtags and saves them', async () => {
    vi.mocked(saveCopy).mockResolvedValue(english);
    const screen = await renderCard(english);
    const input = screen.getByRole('combobox', { name: 'Hashtags' });
    await input.fill('#Budget Tips');
    await userEvent.keyboard('{Enter}');
    await expect.element(screen.getByText('#Budget_Tips')).toBeInTheDocument();
    await input.fill('saving ');
    await expect.element(screen.getByText('#saving')).toBeInTheDocument();
    await expect.element(screen.getByText('3 / 5')).toBeInTheDocument();

    await screen.getByRole('button', { name: 'Save copy' }).click();
    await vi.waitFor(() =>
      expect(saveCopy).toHaveBeenCalledWith(42, {
        base_version: 3,
        caption: 'Hello',
        hashtags: ['budget', 'Budget_Tips', 'saving'],
        alt_text: 'A desk',
      }),
    );
  });

  it('turns the caption counter red when over the limit and blocks saving', async () => {
    const screen = await renderCard(
      production({
        ...english,
        copy_limits: {
          caption_max_chars: 10,
          max_hashtags: 5,
          alt_text_max_chars: 100,
        },
      }),
    );
    await screen.getByLabelText('Caption').fill('Hello there');
    const counter = screen.getByText('20 / 10 including hashtags');
    await expect.element(counter).toBeInTheDocument();
    expect(counter.element().className).toContain('ant-typography-danger');
    await screen.getByRole('button', { name: 'Save copy' }).click();
    await expect
      .element(
        screen.getByText(
          'The caption and hashtags are over the limit. Shorten the caption or remove a hashtag.',
        ),
      )
      .toBeInTheDocument();
    expect(saveCopy).not.toHaveBeenCalled();
  });

  it('asks before regenerating over unsaved changes', async () => {
    const screen = await renderCard(english);
    await screen.getByLabelText('Caption').fill('My own words');
    await screen
      .getByRole('button', { name: 'Regenerate', exact: true })
      .click();
    await expect
      .element(page.getByText('Replace your unsaved changes with a new draft?'))
      .toBeInTheDocument();
  });

  it('offers Generate copy when there is no copy yet', async () => {
    const screen = await renderCard(
      production({
        caption: '',
        hashtags: [],
        alt_text: '',
        caption_preview: '',
      }),
    );
    await expect
      .element(screen.getByRole('button', { name: 'Generate copy' }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText('No caption yet.'))
      .toBeInTheDocument();
  });

  it('is read-only for a submitted version', async () => {
    const screen = await renderCard(
      production({
        ...english,
        status: 'submitted',
        actions: { ...english.actions, can_edit_copy: false },
      }),
      { isCurrentDraft: false },
    );
    await expect
      .element(
        screen.getByText(
          'This version was submitted. Copy can be changed in the next version.',
        ),
      )
      .toBeInTheDocument();
    await expect.element(screen.getByLabelText('Caption')).toBeDisabled();
    await expect
      .element(screen.getByRole('button', { name: 'Save copy' }))
      .not.toBeInTheDocument();
  });

  it('replaces the card with a note for stories', async () => {
    const screen = await renderCard(production({ format: 'story' }));
    await expect
      .element(screen.getByText('Stories are published without a caption.'))
      .toBeInTheDocument();
  });
});
