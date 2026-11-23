import { token } from '@root/config/theme';
import type { BrandFont } from '@/services/socialhub/accounts';

/**
 * Brand fonts in the panel (E00-S03 Brand tab): each bundled font from `GET /fonts/` is loaded
 * once with the `FontFace` API under its own family name, so option labels and the preview tile
 * can render in it. The panel's own font stack stays the fallback while a font loads or when it
 * can't be loaded.
 */

const loads = new Map<string, Promise<boolean>>();

/** The family name a brand font is registered under in this document. */
export const brandFontFamily = (key: string) => `socialhub-brand-${key}`;

/** CSS `font-family` for a brand font key, with the panel stack as fallback. */
export function brandFontStack(key: string | null | undefined): string {
  return key
    ? `"${brandFontFamily(key)}", ${token.fontFamily}`
    : token.fontFamily;
}

/** Loads every weight of the font; resolves true when at least one weight loaded. */
export function loadBrandFont(font: BrandFont): Promise<boolean> {
  const existing = loads.get(font.key);
  if (existing) return existing;
  if (
    typeof FontFace === 'undefined' ||
    typeof document === 'undefined' ||
    !document.fonts
  ) {
    return Promise.resolve(false);
  }
  const family = brandFontFamily(font.key);
  const promise = Promise.allSettled(
    Object.entries(font.files).map(async ([weight, url]) => {
      const face = new FontFace(family, `url(${JSON.stringify(url)})`, {
        weight,
        display: 'swap',
      });
      await face.load();
      document.fonts.add(face);
    }),
  ).then((results) => results.some((result) => result.status === 'fulfilled'));
  loads.set(font.key, promise);
  return promise;
}
