import { Form, Select, Tag, Typography, theme } from 'antd';
import React from 'react';
import { listProblem, normalizeList } from './brandLogic';

export type TagListFieldProps = {
  name: string;
  label: string;
  /** Most items allowed (rule 19). */
  max: number;
  maxItemLength: number;
  /** Shown with `#`; a leading `#` is stripped and repeats are dropped ignoring case. */
  hashtag?: boolean;
  disabled?: boolean;
};

/**
 * A brand list as a `Select mode="tags"` with a counter such as "4 / 10" (E00-S03 Brand tab).
 * The counter turns red past the limit and the field refuses to validate until it fits.
 */
const TagListField: React.FC<TagListFieldProps> = ({
  name,
  label,
  max,
  maxItemLength,
  hashtag,
  disabled,
}) => {
  const { token } = theme.useToken();
  const items: string[] | undefined = Form.useWatch(name);
  const count = items?.length ?? 0;
  const id = `brand-list-${name}`;
  return (
    <Form.Item
      name={name}
      label={label}
      htmlFor={id}
      normalize={(value) => normalizeList(value, hashtag)}
      rules={[
        {
          validator: (_, value: string[] | undefined) => {
            const problem = listProblem(value, { max, maxItemLength, hashtag });
            return problem
              ? Promise.reject(new Error(problem))
              : Promise.resolve();
          },
        },
      ]}
      extra={
        <Typography.Text
          type={count > max ? 'danger' : 'secondary'}
          data-testid={`${name}-count`}
        >
          {count} / {max}
        </Typography.Text>
      }
    >
      <Select
        id={id}
        mode="tags"
        open={false}
        suffixIcon={null}
        disabled={disabled}
        tokenSeparators={hashtag ? [' ', ','] : undefined}
        placeholder={
          hashtag ? 'Type a hashtag and press Enter' : 'Type and press Enter'
        }
        tagRender={({ value, closable, onClose }) => (
          <Tag
            closable={closable}
            onClose={onClose}
            style={{ marginInlineEnd: token.marginXXS }}
          >
            <span dir="auto">
              {hashtag ? '#' : ''}
              {String(value)}
            </span>
          </Tag>
        )}
      />
    </Form.Item>
  );
};

export default TagListField;
