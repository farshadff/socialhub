import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';

const { model } = vi.hoisted(() => ({
  model: { currentAccount: { content_language: 'fa' } as any },
}));

vi.mock('@umijs/max', () => ({
  useModel: () => ({
    currentAccount: model.currentAccount,
    currentAccountId: 1,
    loading: false,
  }),
}));

import ContentText from './index';

const PERSIAN = 'بازگشت قهوه دمی به منوی کافه‌ها';

describe('ContentText (rule 27)', () => {
  it('renders Persian right-to-left in Vazirmatn inside the LTR panel (acceptance 7)', async () => {
    const screen = await render(
      <div dir="ltr">
        <ContentText>{PERSIAN}</ContentText>
      </div>,
    );
    const element = screen.getByText(PERSIAN).element();
    expect(element.getAttribute('dir')).toBe('auto');
    expect(element.getAttribute('lang')).toBe('fa');
    expect(getComputedStyle(element).direction).toBe('rtl');
    expect(getComputedStyle(element).fontFamily).toMatch(/^Vazirmatn/);
    expect(
      getComputedStyle(element.parentElement as HTMLElement).direction,
    ).toBe('ltr');
  });

  it('follows an English account and keeps English left-to-right', async () => {
    model.currentAccount = { content_language: 'en' };
    const screen = await render(<ContentText>Batch brew is back</ContentText>);
    const element = screen.getByText('Batch brew is back').element();
    expect(element.getAttribute('lang')).toBe('en');
    expect(getComputedStyle(element).direction).toBe('ltr');
    expect(getComputedStyle(element).fontFamily).not.toMatch(/^Vazirmatn/);
    model.currentAccount = { content_language: 'fa' };
  });

  it('renders the requested element and keeps line breaks', async () => {
    const screen = await render(
      <ContentText as="p" preserveLineBreaks>
        {'one\ntwo'}
      </ContentText>,
    );
    const element = screen.getByText(/one/).element();
    expect(element.tagName).toBe('P');
    expect(getComputedStyle(element).whiteSpace).toBe('pre-line');
  });
});
