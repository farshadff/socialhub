import { WarningOutlined } from '@ant-design/icons';
import { Space, Tag, Tooltip, theme } from 'antd';
import React from 'react';
import type { RenderWarning } from '@/services/socialhub/production';

/**
 * Text for render warning codes (E06-S02 table, plus the codes added by E06-S03 to E06-S07).
 * Codes whose text depends on the case (`banned_term`, `final_needs_normalising`) use the
 * server's message.
 */
export const FRAME_WARNING_TEXT: Record<string, string> = {
  // E06-S02
  text_overflow: 'Text does not fit. Shorten it or choose another template.',
  logo_not_configured: 'No logo in the brand profile.',
  brand_incomplete: 'Brand colours are incomplete; defaults were used.',
  background_required: 'This template needs an image.',
  background_missing:
    'No background image was found; the brand background was used.',
  rights_not_cleared: "The background image's rights are not cleared.",
  // E06-S04
  clip_padded: 'The clip is shorter than the shot; its last frame is held.',
  clip_cropped_heavily: 'Landscape clip cropped to vertical',
  clip_low_resolution: 'Low resolution clip',
  // E06-S05
  background_low_resolution: 'The background image is low resolution.',
  // E06-S06
  banned_term: 'Contains a banned term.',
  first_line_long: "The first line is long; it may be cut off before 'more'.",
  // E06-S07
  final_needs_normalising:
    'The file will be adjusted to the format before publishing.',
};

/** Codes whose server message carries the specific detail and is shown instead of the generic text. */
const MESSAGE_FIRST = new Set([
  'banned_term',
  'final_needs_normalising',
  'clip_padded',
]);

export type WarningInput = RenderWarning | string;

function asWarning(input: WarningInput): RenderWarning {
  return typeof input === 'string' ? { code: input } : input;
}

/** English text for one warning. */
export function warningText(input: WarningInput): string {
  const warning = asWarning(input);
  if (
    warning.code === 'rights_not_cleared' &&
    warning.asset_id &&
    !warning.frame_index
  ) {
    // Assembly warnings point at a clip or the music, not at a background (E06-S04 panel text).
    return 'Rights are not cleared';
  }
  if (MESSAGE_FIRST.has(warning.code) && warning.message) {
    if (warning.code === 'final_needs_normalising') {
      return `Needs adjusting before publishing: ${warning.message}`;
    }
    return warning.message;
  }
  return (
    FRAME_WARNING_TEXT[warning.code] ??
    warning.message ??
    warning.code.replace(/_/g, ' ')
  );
}

/** "Frame 3", "Shot 2", "Caption" … for a warning's locator. */
export function warningLocator(input: WarningInput): string | null {
  const warning = asWarning(input);
  if (warning.frame_index) return `Frame ${warning.frame_index}`;
  if (warning.shot_index) return `Shot ${warning.shot_index}`;
  if (warning.field) {
    const field = warning.field.replace(/_/g, ' ');
    return field.charAt(0).toUpperCase() + field.slice(1);
  }
  return null;
}

export type FrameWarningProps = {
  warnings: WarningInput[];
  /** `tags` (default) lists orange tags; `icon` shows a warning icon with the texts in a tooltip. */
  mode?: 'tags' | 'icon';
  /** Prefix each tag with its locator ("Frame 3: …"). */
  showLocator?: boolean;
};

/** Render warnings as orange tags (DESIGN-SYSTEM.md section 3: render warnings are orange). */
const FrameWarning: React.FC<FrameWarningProps> = ({
  warnings,
  mode = 'tags',
  showLocator,
}) => {
  const { token } = theme.useToken();
  if (warnings.length === 0) return null;
  const texts = warnings.map((input) => {
    const locator = showLocator ? warningLocator(input) : null;
    const text = warningText(input);
    return locator ? `${locator}: ${text}` : text;
  });
  if (mode === 'icon') {
    const label =
      texts.length === 1
        ? texts[0]
        : `${texts.length} warnings: ${texts.join(' ')}`;
    return (
      <Tooltip
        title={
          <Space orientation="vertical" size={4}>
            {texts.map((text) => (
              <span key={text}>{text}</span>
            ))}
          </Space>
        }
      >
        <WarningOutlined
          role="img"
          aria-label={label}
          tabIndex={0}
          style={{ color: token.colorWarning }}
        />
      </Tooltip>
    );
  }
  // Two warnings can share a text (same code on two frames without locators).
  const keyed = texts.map((text, position) => ({
    text,
    key: `${position}-${text}`,
  }));
  return (
    <Space size={[token.marginXXS, token.marginXXS]} wrap>
      {keyed.map(({ text, key }) => (
        <Tag key={key} color="warning" icon={<WarningOutlined />}>
          {text}
        </Tag>
      ))}
    </Space>
  );
};

export default FrameWarning;
