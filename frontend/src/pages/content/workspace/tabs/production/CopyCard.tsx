import { ProCard } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Flex,
  Form,
  Input,
  message,
  Popover,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import ContentText from '@/components/ContentText';
import FrameWarning from '@/pages/content/shared/FrameWarning';
import JobButton from '@/components/JobButton';
import JobProgress from '@/components/JobProgress';
import { isApiError } from '@/services/socialhub/http';
import type { Job } from '@/services/socialhub/jobs';
import {
  generateCopy,
  getBrand,
  saveCopy,
} from '@/services/socialhub/production';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { jobErrorText } from '@/utils/errorText';
import { useLeaveGuard } from '@/pages/content/shared/leaveGuard';
import {
  captionTagCount,
  combinedLength,
  dedupeHashtags,
  fullCaption,
  hashtagProblem,
  normalizeHashtag,
} from './copyRules';
import {
  Counter,
  charCount,
  useContentFont,
  useProductionContext,
} from './shared';

const FEEDBACK_MAX = 1000;
const COPY_FIELDS = ['caption', 'hashtags', 'alt_text'];
const COPY_WARNING_CODES = ['banned_term', 'first_line_long'];

type CopyValues = { caption: string; hashtags: string[]; alt_text: string };

/** Failure text for a `copy.generate` job (E06-S06 "Refusal"). */
export function copyFailureText(
  job: Pick<Job, 'error_code' | 'error_detail'>,
): string {
  if (job.error_code === 'provider_error' && job.error_detail === 'refused') {
    return 'The caption could not be drafted for this content. Write it by hand or adjust the brief.';
  }
  return jobErrorText(job);
}

type HashtagSelectProps = {
  value?: string[];
  onChange?: (value: string[]) => void;
  brandTags: Set<string>;
  disabled?: boolean;
  id?: string;
};

/**
 * Hashtags in tags mode: a space or Enter adds a tag; `#` is stripped and the zero-width
 * non-joiner (or pasted spaces) become `_` as you type (E06-S06 rule 3).
 */
export const HashtagSelect: React.FC<HashtagSelectProps> = ({
  value = [],
  onChange,
  brandTags,
  disabled,
  id,
}) => {
  const { token } = theme.useToken();
  const [search, setSearch] = useState('');
  const commit = (tags: string[]) =>
    onChange?.(dedupeHashtags(tags.map(normalizeHashtag)));
  return (
    <Select<string[]>
      id={id}
      mode="tags"
      aria-label="Hashtags"
      value={value}
      disabled={disabled}
      searchValue={search}
      open={false}
      suffixIcon={null}
      placeholder="Type a hashtag and press space or Enter"
      onSearch={(text) => {
        if (/\s$/.test(text) && text.trim() !== '') {
          commit([...value, text]);
          setSearch('');
          return;
        }
        setSearch(text.trimStart() === '' ? '' : normalizeHashtag(text));
      }}
      onChange={(next) => {
        commit(next);
        setSearch('');
      }}
      onBlur={() => {
        if (search.trim()) {
          commit([...value, search]);
          setSearch('');
        }
      }}
      tagRender={({ value: tag, closable, onClose }) => {
        const brand = brandTags.has(String(tag).toLocaleLowerCase());
        return (
          <Tag
            closable={closable}
            onClose={onClose}
            style={{ marginInlineEnd: token.marginXXS }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <bdi>#{String(tag)}</bdi>
            {brand ? (
              <Typography.Text
                type="secondary"
                style={{ marginInlineStart: token.marginXXS }}
              >
                brand
              </Typography.Text>
            ) : null}
          </Tag>
        );
      }}
    />
  );
};

const CopyEditor: React.FC = () => {
  const { token } = theme.useToken();
  const contentFont = useContentFont();
  const {
    item,
    production,
    accountId,
    setProduction,
    handleError,
    jobRunning,
    runningReason,
    activeJob,
    adoptableJob,
    onJobStarted,
    onJobEnded,
    refetch,
    isCurrentDraft,
  } = useProductionContext();
  const [form] = Form.useForm<CopyValues>();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingReset, setPendingReset] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [keepHashtags, setKeepHashtags] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const brand = useQuery({
    queryKey: [accountId, 'brand'],
    queryFn: () => getBrand(accountId),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const brandTags = useMemo(
    () =>
      new Set(
        (brand.data?.default_hashtags ?? []).map((tag) =>
          normalizeHashtag(tag).toLocaleLowerCase(),
        ),
      ),
    [brand.data],
  );

  const saved: CopyValues = useMemo(
    () => ({
      caption: production.caption ?? '',
      hashtags: production.hashtags ?? [],
      alt_text: production.alt_text ?? '',
    }),
    [production.caption, production.hashtags, production.alt_text],
  );
  const caption =
    (Form.useWatch('caption', form) as string | undefined) ?? saved.caption;
  const hashtags =
    (Form.useWatch('hashtags', form) as string[] | undefined) ?? saved.hashtags;
  const altText =
    (Form.useWatch('alt_text', form) as string | undefined) ?? saved.alt_text;
  const dirty =
    caption !== saved.caption ||
    altText !== saved.alt_text ||
    hashtags.join('\n') !== saved.hashtags.join('\n');
  useLeaveGuard(
    dirty,
    'Your copy changes are not saved. Leave without saving?',
  );

  const savedKey = `${production.version}|${saved.caption}|${saved.hashtags.join(' ')}|${saved.alt_text}`;
  useEffect(() => {
    if (!dirty || pendingReset) {
      form.setFieldsValue(saved);
      setPendingReset(false);
    }
  }, [savedKey]);

  const limits = production.copy_limits;
  const length = combinedLength(caption, hashtags);
  const tagCount = hashtags.length + captionTagCount(caption);
  const editable = production.actions.can_edit_copy && isCurrentDraft;
  const disabled = !editable || jobRunning || saving;
  const noCopy =
    saved.caption === '' &&
    saved.hashtags.length === 0 &&
    saved.alt_text === '';
  const copyJobRunning = jobRunning && activeJob?.kind === 'copy.generate';
  const readOnlyNote =
    production.status !== null && production.status !== 'draft';
  const warnings = production.render_warnings.filter(
    (warning) =>
      COPY_WARNING_CODES.includes(warning.code) ||
      (warning.field !== undefined && COPY_FIELDS.includes(warning.field)),
  );
  const replaceConfirm = dirty
    ? {
        title: 'Replace your unsaved changes with a new draft?',
        okText: 'Replace',
      }
    : undefined;

  const afterJob = () => {
    setFailure(null);
    setPendingReset(true);
    onJobEnded();
    refetch();
  };
  const jobFailed = (job: Job) => {
    setFailure(copyFailureText(job));
    onJobEnded();
    refetch();
  };
  const startError = (error: unknown) => {
    handleError(error);
    return true;
  };

  const save = async () => {
    let values: CopyValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const next = await saveCopy(item.id, {
        base_version: production.version as number,
        caption: values.caption,
        hashtags: values.hashtags,
        alt_text: values.alt_text,
      });
      setPendingReset(true);
      setProduction(next);
      message.success('Copy saved');
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_error') {
        const unmatched = applyFieldErrors(form, error);
        if (unmatched.length) message.error(unmatched.join(' '));
      } else {
        handleError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  const retry = async () => {
    setRetrying(true);
    try {
      const { job } = await generateCopy(item.id, {
        base_version: production.version as number,
      });
      setFailure(null);
      onJobStarted(job);
    } catch (error) {
      handleError(error);
    } finally {
      setRetrying(false);
    }
  };

  const feedbackContent = (
    <Flex vertical gap={token.marginXS} style={{ width: 340 }}>
      <label htmlFor="copy-feedback">
        <Typography.Text strong>What should change?</Typography.Text>
      </label>
      <Input.TextArea
        id="copy-feedback"
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        autoSize={{ minRows: 3, maxRows: 8 }}
        status={charCount(feedback) > FEEDBACK_MAX ? 'error' : undefined}
        placeholder="For example: Shorter. Open with the question, not the statistic."
      />
      <Flex justify="space-between" align="center">
        <Checkbox
          checked={keepHashtags}
          onChange={(event) => setKeepHashtags(event.target.checked)}
        >
          Keep the hashtags
        </Checkbox>
        <Counter count={charCount(feedback)} max={FEEDBACK_MAX} />
      </Flex>
      <Flex justify="end" gap={token.marginXS}>
        <Button onClick={() => setFeedbackOpen(false)}>Cancel</Button>
        <JobButton
          type="primary"
          start={() =>
            generateCopy(item.id, {
              base_version: production.version as number,
              feedback: feedback.trim() || undefined,
              keep_hashtags: keepHashtags,
            })
          }
          onStarted={(job) => {
            setFailure(null);
            setFeedbackOpen(false);
            setFeedback('');
            onJobStarted(job);
          }}
          onStartError={startError}
          confirm={replaceConfirm}
          disabled={charCount(feedback) > FEEDBACK_MAX}
        >
          Regenerate
        </JobButton>
      </Flex>
    </Flex>
  );

  return (
    <ProCard
      title="Copy"
      extra={
        editable ? (
          <Space wrap size={token.marginXS}>
            <Button
              type={dirty ? 'primary' : 'default'}
              onClick={save}
              loading={saving}
              disabled={disabled || !dirty}
            >
              Save copy
            </Button>
            <JobButton
              type={noCopy && !dirty ? 'primary' : 'default'}
              start={() =>
                generateCopy(item.id, {
                  base_version: production.version as number,
                })
              }
              activeJob={adoptableJob}
              kinds={['copy.generate']}
              onStarted={(job) => onJobStarted(job, true)}
              onDone={afterJob}
              onFailed={jobFailed}
              onStartError={startError}
              successMessage="Copy drafted"
              failureText={copyFailureText}
              confirm={replaceConfirm}
              disabled={jobRunning || saving}
              disabledReason={runningReason}
              runningReason={runningReason}
            >
              {noCopy ? 'Generate copy' : 'Regenerate'}
            </JobButton>
            {noCopy ? null : (
              <Popover
                open={feedbackOpen && !jobRunning}
                onOpenChange={setFeedbackOpen}
                trigger="click"
                title="Regenerate with feedback"
                content={feedbackContent}
                destroyOnHidden
              >
                <Tooltip title={jobRunning ? runningReason : undefined}>
                  <Button disabled={jobRunning || saving}>
                    Regenerate with feedback
                  </Button>
                </Tooltip>
              </Popover>
            )}
          </Space>
        ) : undefined
      }
    >
      <Flex vertical gap={token.margin}>
        {readOnlyNote ? (
          <Typography.Text type="secondary">
            This version was submitted. Copy can be changed in the next version.
          </Typography.Text>
        ) : null}
        {copyJobRunning && activeJob ? (
          <JobProgress job={activeJob} variant="inline" />
        ) : null}
        {failure && !jobRunning ? (
          <Alert
            type="error"
            showIcon
            title={failure}
            action={
              editable ? (
                <Button size="small" onClick={retry} loading={retrying}>
                  Try again
                </Button>
              ) : undefined
            }
          />
        ) : null}
        {warnings.length > 0 ? <FrameWarning warnings={warnings} /> : null}
        <Form<CopyValues>
          form={form}
          layout="vertical"
          initialValues={saved}
          disabled={disabled}
          requiredMark={false}
        >
          <Form.Item
            name="caption"
            label="Caption"
            rules={[
              {
                validator: async () => {
                  if (
                    combinedLength(
                      form.getFieldValue('caption') ?? '',
                      form.getFieldValue('hashtags') ?? [],
                    ) > limits.caption_max_chars
                  ) {
                    throw new Error(
                      'The caption and hashtags are over the limit. Shorten the caption or remove a hashtag.',
                    );
                  }
                },
              },
            ]}
            extra={
              <Flex justify="space-between" gap={token.marginXS} wrap>
                <Typography.Text type="secondary">
                  {caption === ''
                    ? 'No caption yet.'
                    : production.disclosure_required
                      ? 'An AI disclosure line is added at the end.'
                      : ''}
                </Typography.Text>
                <Counter
                  count={length}
                  max={limits.caption_max_chars}
                  suffix="including hashtags"
                />
              </Flex>
            }
          >
            <Input.TextArea
              dir="auto"
              style={{ fontFamily: contentFont }}
              autoSize={{ minRows: 6, maxRows: 16 }}
            />
          </Form.Item>
          <Form.Item
            name="hashtags"
            label="Hashtags"
            dependencies={['caption']}
            rules={[
              {
                validator: async (_, value: string[] | undefined) => {
                  const tags = value ?? [];
                  const problem = tags.map(hashtagProblem).find(Boolean);
                  if (problem) throw new Error(problem);
                  const counted =
                    tags.length +
                    captionTagCount(form.getFieldValue('caption') ?? '');
                  if (counted > limits.max_hashtags) {
                    throw new Error(
                      `Up to ${limits.max_hashtags} hashtags, counting any #tags in the caption.`,
                    );
                  }
                },
              },
            ]}
            extra={
              <Flex justify="end">
                <Counter count={tagCount} max={limits.max_hashtags} />
              </Flex>
            }
          >
            <HashtagSelect brandTags={brandTags} />
          </Form.Item>
          <Form.Item
            name="alt_text"
            label="Alt text (read aloud by screen readers)"
            rules={[
              {
                validator: async (_, value: string | undefined) => {
                  if (charCount(value) > limits.alt_text_max_chars) {
                    throw new Error(
                      `Up to ${limits.alt_text_max_chars} characters.`,
                    );
                  }
                },
              },
            ]}
            extra={
              <Flex justify="end">
                <Counter
                  count={charCount(altText)}
                  max={limits.alt_text_max_chars}
                />
              </Flex>
            }
          >
            <Input dir="auto" style={{ fontFamily: contentFont }} />
          </Form.Item>
        </Form>
        <Collapse
          size="small"
          items={[
            {
              key: 'preview',
              label: 'As it will appear',
              children: (
                <ContentText as="div" preserveLineBreaks>
                  {(dirty
                    ? fullCaption(caption, hashtags)
                    : production.caption_preview) || '—'}
                </ContentText>
              ),
            },
          ]}
        />
      </Flex>
    </ProCard>
  );
};

/** The Copy card (E06-S06); stories get a one-line note instead. */
const CopyCard: React.FC = () => {
  const { production } = useProductionContext();
  if (production.format === 'story') {
    return (
      <ProCard title="Copy">
        <Typography.Text type="secondary">
          Stories are published without a caption.
        </Typography.Text>
      </ProCard>
    );
  }
  return <CopyEditor />;
};

export default CopyCard;
