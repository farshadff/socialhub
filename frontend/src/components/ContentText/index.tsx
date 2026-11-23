import { contentFontFamily } from '@root/config/theme';
import { Typography } from 'antd';
import React from 'react';
import { useCurrentAccount } from '@/utils/accountRequest';

export type ContentTextProps = {
  children?: React.ReactNode;
  as?: 'span' | 'p' | 'div';
  /** Clamp to this many lines. */
  ellipsis?: number;
  preserveLineBreaks?: boolean;
  strong?: boolean;
  /** Overrides the current account's content language. */
  lang?: 'fa' | 'en';
  className?: string;
};

/**
 * User or AI content: `dir="auto"` so Persian reads right-to-left inside the English panel,
 * `lang` and font stack from the account's content language (E00-S02 rule 27).
 */
const ContentText: React.FC<ContentTextProps> = ({
  children,
  as = 'span',
  ellipsis,
  preserveLineBreaks,
  strong,
  lang,
  className,
}) => {
  const { account } = useCurrentAccount();
  const language = lang ?? account?.content_language ?? 'fa';
  const style: React.CSSProperties = {
    fontFamily: contentFontFamily[language],
    whiteSpace: preserveLineBreaks ? 'pre-line' : undefined,
    display: as === 'span' && !ellipsis ? undefined : 'block',
    marginBottom: as === 'p' ? undefined : 0,
  };
  const content = strong ? <strong>{children}</strong> : children;
  if (ellipsis) {
    return (
      <Typography.Paragraph
        dir="auto"
        lang={language}
        style={{ ...style, marginBottom: 0 }}
        className={className}
        ellipsis={{ rows: ellipsis, tooltip: false }}
      >
        {content}
      </Typography.Paragraph>
    );
  }
  const Tag = as;
  return (
    <Tag dir="auto" lang={language} style={style} className={className}>
      {content}
    </Tag>
  );
};

export default ContentText;
