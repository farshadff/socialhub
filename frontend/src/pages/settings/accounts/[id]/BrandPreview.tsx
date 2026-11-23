import { theme } from 'antd';
import React from 'react';
import type { BrandColors } from '@/services/socialhub/accounts';
import { brandFontStack } from '@/utils/brandFonts';

export type BrandPreviewProps = {
  colors: Partial<BrandColors>;
  headingFont?: string | null;
  bodyFont?: string | null;
  /** "Handle shown on assets". */
  handle?: string;
};

/**
 * Live preview tile for the Brand tab (E00-S03): the account's background colour, a heading in
 * the heading font and text colour, a body line, an accent bar and a primary button shape. The
 * colours and fonts are the account's brand values (data), not panel tokens.
 */
const BrandPreview: React.FC<BrandPreviewProps> = ({
  colors,
  headingFont,
  bodyFont,
  handle,
}) => {
  const { token } = theme.useToken();
  const text = colors.text;
  return (
    <figure
      aria-label="Brand preview"
      data-testid="brand-preview"
      style={{
        margin: 0,
        padding: token.paddingLG,
        borderRadius: token.borderRadiusLG,
        border: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
        background: colors.background,
        color: text,
        display: 'flex',
        flexDirection: 'column',
        gap: token.marginSM,
        minHeight: 220,
      }}
    >
      <div
        data-testid="brand-preview-accent"
        style={{
          width: token.sizeXXL,
          height: token.sizeXXS,
          borderRadius: token.borderRadiusXS,
          background: colors.accent,
        }}
      />
      <h3
        dir="auto"
        data-testid="brand-preview-heading"
        style={{
          margin: 0,
          fontFamily: brandFontStack(headingFont),
          fontWeight: 700,
          fontSize: token.fontSizeHeading3,
          lineHeight: token.lineHeightHeading3,
          color: text,
        }}
      >
        Your headline here
      </h3>
      <p
        dir="auto"
        data-testid="brand-preview-body"
        style={{
          margin: 0,
          fontFamily: brandFontStack(bodyFont),
          color: text,
        }}
      >
        Body text looks like this on your posts.
      </p>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: token.marginSM,
          marginTop: 'auto',
        }}
      >
        <span
          data-testid="brand-preview-button"
          style={{
            display: 'inline-block',
            padding: `${token.paddingXXS}px ${token.padding}px`,
            borderRadius: token.borderRadius,
            background: colors.primary,
            color: colors.background,
            fontFamily: brandFontStack(bodyFont),
            fontWeight: 700,
          }}
        >
          Learn more
        </span>
        {handle ? (
          <span
            dir="auto"
            style={{
              color: colors.secondary,
              fontFamily: brandFontStack(bodyFont),
            }}
          >
            {handle}
          </span>
        ) : null}
      </div>
    </figure>
  );
};

export default BrandPreview;
