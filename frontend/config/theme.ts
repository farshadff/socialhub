/**
 * Social Hub panel tokens (docs/DESIGN-SYSTEM.md section 2).
 *
 * The single source of colours, type and radius for the panel. `config/config.ts` passes `token`
 * to the Ant Design `ConfigProvider` and `config/defaultSettings.ts` passes `colorPrimary` to Pro
 * layout. Components read tokens through `theme.useToken()` or `antd-style`; no file under `src/`
 * contains a literal colour, font family or radius.
 *
 * `colorSuccess`, `colorWarning`, `colorError` and `colorInfo` stay Ant Design defaults on purpose.
 */

/** Ant Design's default system font stack (`token.fontFamily` in antd 6). */
export const ANTD_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'";

/** Bundled from `public/fonts/` by the `@font-face` rule in `src/global.less`. */
export const PERSIAN_FONT = 'Vazirmatn';

export const token = {
  colorPrimary: '#1677ff',
  borderRadius: 8,
  fontSize: 14,
  /** Ant Design's default stack with Vazirmatn appended for Persian glyphs. */
  fontFamily: `${ANTD_FONT_STACK}, ${PERSIAN_FONT}`,
};

/** Kept as `theme` for existing imports. */
export const theme = token;

export type ContentLanguage = 'fa' | 'en';

/** Font stack for user or AI content by the account's content language: Vazirmatn first for `fa`. */
export const contentFontFamily: Record<ContentLanguage, string> = {
  fa: `${PERSIAN_FONT}, ${ANTD_FONT_STACK}`,
  en: token.fontFamily,
};

export default token;
