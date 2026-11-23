import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { brandFontFamily } from '@/utils/brandFonts';
import { hex } from '@/utils/testing';
import BrandPreview from './BrandPreview';

const colors = {
  primary: hex('0B6E4F'),
  secondary: hex('21295C'),
  accent: hex('F2A541'),
  background: hex('FFFFFF'),
  text: hex('1B1B1B'),
};

const style = (element: Element) => window.getComputedStyle(element);

describe('BrandPreview', () => {
  it('paints the tile with the brand colours', async () => {
    const screen = await render(
      <BrandPreview
        colors={colors}
        headingFont="inter"
        bodyFont="vazirmatn"
        handle="@greenhome.ir"
      />,
    );
    const tile = screen.getByTestId('brand-preview').element();
    expect(style(tile).backgroundColor).toBe('rgb(255, 255, 255)');
    expect(
      style(screen.getByTestId('brand-preview-heading').element()).color,
    ).toBe('rgb(27, 27, 27)');
    expect(
      style(screen.getByTestId('brand-preview-accent').element())
        .backgroundColor,
    ).toBe('rgb(242, 165, 65)');
    expect(
      style(screen.getByTestId('brand-preview-button').element())
        .backgroundColor,
    ).toBe('rgb(11, 110, 79)');
    await expect.element(screen.getByText('@greenhome.ir')).toBeVisible();
  });

  it('uses the heading and body fonts', async () => {
    const screen = await render(
      <BrandPreview
        colors={colors}
        headingFont="inter"
        bodyFont="noto-sans-arabic"
      />,
    );
    expect(
      style(screen.getByTestId('brand-preview-heading').element()).fontFamily,
    ).toContain(brandFontFamily('inter'));
    expect(
      style(screen.getByTestId('brand-preview-body').element()).fontFamily,
    ).toContain(brandFontFamily('noto-sans-arabic'));
  });

  it('updates when the colours change', async () => {
    const screen = await render(<BrandPreview colors={colors} />);
    await screen.rerender(
      <BrandPreview
        colors={{ ...colors, background: hex('000000'), text: hex('FFFFFF') }}
      />,
    );
    expect(
      style(screen.getByTestId('brand-preview').element()).backgroundColor,
    ).toBe('rgb(0, 0, 0)');
    expect(
      style(screen.getByTestId('brand-preview-body').element()).color,
    ).toBe('rgb(255, 255, 255)');
  });
});
