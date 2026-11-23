import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import FrameWarning, { warningLocator, warningText } from './index';

describe('FrameWarning mapping (E06-S02)', () => {
  it.each([
    [
      'text_overflow',
      'Text does not fit. Shorten it or choose another template.',
    ],
    ['logo_not_configured', 'No logo in the brand profile.'],
    ['brand_incomplete', 'Brand colours are incomplete; defaults were used.'],
    ['background_required', 'This template needs an image.'],
    [
      'background_missing',
      'No background image was found; the brand background was used.',
    ],
    ['rights_not_cleared', "The background image's rights are not cleared."],
    ['clip_cropped_heavily', 'Landscape clip cropped to vertical'],
    ['clip_low_resolution', 'Low resolution clip'],
    [
      'first_line_long',
      "The first line is long; it may be cut off before 'more'.",
    ],
  ])('%s → "%s"', (code, text) => {
    expect(warningText({ code })).toBe(text);
  });

  it('uses the server message where it carries the detail', () => {
    expect(
      warningText({
        code: 'banned_term',
        field: 'caption',
        message: 'Contains a banned term: ارزان',
      }),
    ).toBe('Contains a banned term: ارزان');
    expect(
      warningText({
        code: 'rights_not_cleared',
        asset_id: 502,
        message: 'Rights are unknown.',
      }),
    ).toBe('Rights are not cleared');
  });

  it('keeps unknown codes readable', () => {
    expect(warningText({ code: 'something_new' })).toBe('something new');
    expect(
      warningText({ code: 'something_new', message: 'Server text.' }),
    ).toBe('Server text.');
  });

  it('names the locator', () => {
    expect(warningLocator({ code: 'x', frame_index: 3 })).toBe('Frame 3');
    expect(warningLocator({ code: 'x', shot_index: 2 })).toBe('Shot 2');
    expect(warningLocator({ code: 'x', field: 'alt_text' })).toBe('Alt text');
  });

  it('renders orange tags', async () => {
    const screen = await render(
      <FrameWarning
        warnings={[{ code: 'text_overflow', frame_index: 3 }]}
        showLocator
      />,
    );
    const tag = screen.getByText(
      'Frame 3: Text does not fit. Shorten it or choose another template.',
    );
    await expect.element(tag).toBeInTheDocument();
    expect(tag.element().closest('.ant-tag')?.className).toContain(
      'ant-tag-warning',
    );
  });

  it('lists the texts in a tooltip in icon mode, with an accessible name', async () => {
    const screen = await render(
      <FrameWarning warnings={['background_missing']} mode="icon" />,
    );
    const icon = screen.getByRole('img', {
      name: 'No background image was found; the brand background was used.',
    });
    await icon.hover();
    await expect
      .element(
        page
          .getByRole('tooltip')
          .getByText(
            'No background image was found; the brand background was used.',
          ),
      )
      .toBeVisible();
  });

  it('renders nothing without warnings', async () => {
    const screen = await render(<FrameWarning warnings={[]} />);
    expect(screen.container.textContent).toBe('');
  });
});
