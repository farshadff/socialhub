import {
  Alert,
  Button,
  Collapse,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  message,
  Segmented,
  Tag,
  Typography,
  theme,
} from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ContentText from '@/components/ContentText';
import MediaPreview from '@/pages/content/shared/MediaPreview';
import StatusTag, { sentenceCase } from '@/components/StatusTag';
import TemplateSelect from '@/pages/content/shared/TemplateSelect';
import { useFormats } from '@/pages/content/shared/useFormats';
import { useRenderTemplates } from '@/pages/content/shared/useRenderTemplates';
import type { FrameTemplateKey } from '@/services/socialhub/formats';
import { isApiError } from '@/services/socialhub/http';
import {
  type BackgroundAssetRef,
  type EditableFrameField,
  type FrameChange,
  type ProductionFrame,
  renderProduction,
  updateFrame,
} from '@/services/socialhub/production';
import type { Transition } from '@/services/socialhub/scripts';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { confirmDiscard, useLeaveGuard } from '@/pages/content/shared/leaveGuard';
import BackgroundSection from './BackgroundSection';
import { bodyProblem, headlineProblem, listPoints } from './frameText';
import {
  Counter,
  charCount,
  seconds,
  useContentFont,
  useProductionContext,
} from './shared';

const NOTE_STORAGE_KEY = 'socialhub.frameDrawerNoteSeen';
const DURATION_MIN = 1.5;
const DURATION_MAX = 10;

type FormValues = {
  template: FrameTemplateKey;
  headline: string;
  body: string;
  duration_seconds: number;
  transition: Transition;
};

const TRANSITION_LABEL: Record<Transition, string> = {
  cut: 'Cut',
  fade: 'Fade',
  slide: 'Slide',
};

function valuesOf(frame: ProductionFrame): FormValues {
  return {
    template: frame.template,
    headline: frame.headline ?? '',
    body: frame.body ?? '',
    duration_seconds: frame.duration_seconds,
    transition: frame.transition,
  };
}

/** Shows the note once per browser session; storage can be unavailable, then it shows each time. */
function takeNote(): boolean {
  try {
    if (window.sessionStorage.getItem(NOTE_STORAGE_KEY)) return false;
    window.sessionStorage.setItem(NOTE_STORAGE_KEY, '1');
    return true;
  } catch {
    return true;
  }
}

const EditedHere: React.FC<{ show: boolean }> = ({ show }) => {
  const { token } = theme.useToken();
  return show ? (
    <Tag style={{ marginInlineStart: token.marginXS }}>Edited here</Tag>
  ) : null;
};

export type FrameEditDrawerProps = {
  frameIndex: number | null;
  onClose: () => void;
};

/** The frame edit drawer (E06-S07 FE4). */
const FrameEditDrawer: React.FC<FrameEditDrawerProps> = ({
  frameIndex,
  onClose,
}) => {
  const { token } = theme.useToken();
  const contentFont = useContentFont();
  const {
    item,
    production,
    setProduction,
    handleError,
    jobRunning,
    runningReason,
    onJobStarted,
    isCurrentDraft,
    layout,
    onUrlExpired,
  } = useProductionContext();
  const { byKey } = useRenderTemplates(production.format);
  const { getSpec } = useFormats();
  const [form] = Form.useForm<FormValues>();
  const [background, setBackground] = useState<
    BackgroundAssetRef | null | undefined
  >(undefined);
  const [saving, setSaving] = useState<'save' | 'render' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const lastFrame = useRef<ProductionFrame | null>(null);

  const liveFrame =
    frameIndex !== null
      ? production.frames.find((f) => f.index === frameIndex)
      : undefined;
  if (liveFrame) lastFrame.current = liveFrame;
  const frame = liveFrame ?? lastFrame.current;
  const open = frameIndex !== null && !!liveFrame;

  useEffect(() => {
    if (open && frame) {
      setBackground(undefined);
      setFormError(null);
      setShowNote(takeNote());
    }
  }, [open, frameIndex]);

  const watched = {
    template: Form.useWatch('template', form) as FrameTemplateKey | undefined,
    headline: (Form.useWatch('headline', form) as string | undefined) ?? '',
    body: (Form.useWatch('body', form) as string | undefined) ?? '',
    duration_seconds: Form.useWatch('duration_seconds', form) as
      | number
      | undefined,
    transition: Form.useWatch('transition', form) as Transition | undefined,
  };

  const templateKey = watched.template ?? frame?.template;
  const template = templateKey ? byKey.get(templateKey) : undefined;
  const timed = production.production_mode !== 'design';
  const isVideoMode = production.production_mode === 'video';
  const shot = frame
    ? production.shots.find((s) => s.index === frame.shot_index)
    : undefined;
  const durationMax =
    isVideoMode && shot
      ? Math.min(DURATION_MAX, shot.duration_seconds)
      : DURATION_MAX;
  const canEdit = production.actions.can_edit_frames && isCurrentDraft;
  const disabled = !canEdit || jobRunning || saving !== null;

  const changed = useMemo(() => {
    if (!frame) return [] as EditableFrameField[];
    const fields: EditableFrameField[] = [];
    if (watched.template && watched.template !== frame.template)
      fields.push('template');
    if (watched.headline !== (frame.headline ?? '')) fields.push('headline');
    if (watched.body !== (frame.body ?? '')) fields.push('body');
    if (
      timed &&
      watched.duration_seconds !== undefined &&
      watched.duration_seconds !== frame.duration_seconds
    ) {
      fields.push('duration_seconds');
    }
    if (timed && watched.transition && watched.transition !== frame.transition)
      fields.push('transition');
    if (
      background !== undefined &&
      (background?.id ?? null) !== frame.background_asset_id
    ) {
      fields.push('background_asset_id');
    }
    return fields;
  }, [
    frame,
    watched.template,
    watched.headline,
    watched.body,
    watched.duration_seconds,
    watched.transition,
    background,
    timed,
  ]);
  const dirty = open && changed.length > 0;
  const guardText = `Discard your changes to frame ${frame?.index ?? ''}?`;
  useLeaveGuard(dirty, guardText);

  const headlineError = headlineProblem(
    template?.fields.headline,
    watched.headline,
  );
  const bodyError = bodyProblem(template?.fields.body, watched.body);
  const overLimit = !!headlineError || !!bodyError;

  if (!frame) return null;

  const currentBackground =
    background !== undefined ? background : frame.background_asset;
  const otherFrames = production.frames.filter((f) => f.index !== frame.index);
  const durationValue = watched.duration_seconds ?? frame.duration_seconds;
  const total = isVideoMode
    ? production.shots.reduce((sum, s) => sum + s.duration_seconds, 0)
    : otherFrames.reduce((sum, f) => sum + f.duration_seconds, 0) +
      durationValue;
  const spec = getSpec(production.format, production.media_kind);
  const min = spec?.min_duration_s ?? null;
  const max = spec?.max_duration_s ?? null;
  const outOfRange =
    (min !== null && total < min) || (max !== null && total > max);
  const overridden = new Set(frame.overridden);
  const listField = template?.fields.body.items;

  const close = async () => {
    if (dirty && !(await confirmDiscard(guardText, 'Discard changes'))) return;
    onClose();
  };

  const buildChange = (values: FormValues): FrameChange => {
    const change: FrameChange = {};
    for (const field of changed) {
      if (field === 'background_asset_id')
        change.background_asset_id = background?.id ?? null;
      else if (field === 'template') change.template = values.template;
      else if (field === 'headline') change.headline = values.headline;
      else if (field === 'body') change.body = values.body;
      else if (field === 'duration_seconds')
        change.duration_seconds = values.duration_seconds;
      else if (field === 'transition') change.transition = values.transition;
    }
    // A template without an image slot cannot keep a background (rule 18).
    if (
      change.template &&
      byKey.get(change.template)?.image_slot === 'none' &&
      frame.background_asset_id
    ) {
      change.background_asset_id = null;
    }
    return change;
  };

  const save = async (render: boolean) => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(render ? 'render' : 'save');
    setFormError(null);
    try {
      let version = production.version as number;
      if (changed.length > 0) {
        const next = await updateFrame(item.id, frame.index, {
          base_version: version,
          ...buildChange(values),
        });
        setProduction(next);
        version = next.version ?? version;
      }
      if (render) {
        const { job } = await renderProduction(item.id, {
          base_version: version,
          frames: [frame.index],
          reassemble: true,
        });
        onJobStarted(job);
        message.success(`Frame ${frame.index} saved. Rendering…`);
      } else {
        message.success(`Frame ${frame.index} saved`);
      }
      onClose();
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_error') {
        const unmatched = applyFieldErrors(form, error);
        if (unmatched.length) setFormError(unmatched.join(' '));
      } else {
        handleError(error);
      }
    } finally {
      setSaving(null);
    }
  };

  const reset = (field: keyof FormValues) => {
    if (!frame.script_frame) return;
    form.setFieldValue(field, frame.script_frame[field]);
    form.validateFields([field]).catch(() => undefined);
  };

  const textStyle: React.CSSProperties = { fontFamily: contentFont };
  const scriptRows = frame.script_frame
    ? (
        [
          [
            'template',
            'Template',
            byKey.get(frame.script_frame.template)?.name ??
              sentenceCase(frame.script_frame.template),
          ],
          ['headline', 'Headline', frame.script_frame.headline],
          ['body', 'Body', frame.script_frame.body],
          ...(timed
            ? [
                [
                  'duration_seconds',
                  'Duration',
                  seconds(frame.script_frame.duration_seconds),
                ],
                [
                  'transition',
                  'Transition',
                  TRANSITION_LABEL[frame.script_frame.transition],
                ],
              ]
            : []),
        ] as [keyof FormValues, string, string][]
      ).filter(([field]) => field !== 'transition' || frame.index !== 1)
    : [];

  return (
    <Drawer
      open={open}
      onClose={close}
      size={520}
      title={`Frame ${frame.index}`}
      footer={
        canEdit ? (
          <Flex justify="end" gap={token.marginXS}>
            <Button onClick={close} disabled={saving !== null}>
              Cancel
            </Button>
            <Button
              onClick={() => save(false)}
              loading={saving === 'save'}
              disabled={jobRunning || !dirty || overLimit || saving !== null}
              title={jobRunning ? runningReason : undefined}
            >
              Save
            </Button>
            <Button
              type="primary"
              onClick={() => save(true)}
              loading={saving === 'render'}
              disabled={jobRunning || overLimit || saving !== null}
              title={jobRunning ? runningReason : undefined}
            >
              Save and render
            </Button>
          </Flex>
        ) : (
          <Flex justify="end">
            <Button onClick={onClose}>Close</Button>
          </Flex>
        )
      }
    >
      <Flex vertical gap={token.marginLG}>
        {showNote ? (
          <Alert
            type="info"
            showIcon
            title="Changes here apply to this version only. The approved script is not changed."
          />
        ) : null}
        {jobRunning ? (
          <Alert
            type="info"
            showIcon
            title={`${runningReason}. Editing is paused.`}
          />
        ) : null}
        {formError ? <Alert type="error" showIcon title={formError} /> : null}

        <Flex vertical gap={token.marginXS} align="center">
          <MediaPreview
            asset={frame.asset ? { ...frame.asset, kind: 'image' } : null}
            format={production.format}
            mediaKind={production.media_kind}
            state={
              frame.state === 'failed'
                ? 'failed'
                : frame.asset
                  ? 'idle'
                  : 'empty'
            }
            maxHeight={240}
            alt={
              [frame.headline, frame.body].filter(Boolean).join('. ') ||
              `Frame ${frame.index}`
            }
            onUrlExpired={onUrlExpired}
            compact
          />
          <StatusTag kind="frame" status={frame.state} />
        </Flex>

        <Form<FormValues>
          // Remounts with the frame's values each time the drawer opens on a frame.
          key={open ? `frame-${frame.index}` : 'closed'}
          form={form}
          initialValues={valuesOf(frame)}
          layout="vertical"
          disabled={disabled}
          requiredMark={false}
        >
          <Form.Item
            name="template"
            label={
              <span>
                Template
                <EditedHere show={overridden.has('template')} />
              </span>
            }
          >
            <TemplateSelect
              format={production.format}
              layout={layout}
              hideLimits
            />
          </Form.Item>

          <Form.Item
            name="headline"
            label={
              <span>
                Headline
                <EditedHere show={overridden.has('headline')} />
              </span>
            }
            validateStatus={headlineError ? 'error' : undefined}
            help={headlineError ?? undefined}
            extra={
              template ? (
                <Counter
                  count={charCount(watched.headline)}
                  max={template.fields.headline.max_chars}
                />
              ) : undefined
            }
          >
            <Input.TextArea
              dir="auto"
              style={textStyle}
              autoSize={{ minRows: 1, maxRows: 4 }}
            />
          </Form.Item>

          <Form.Item
            name="body"
            label={
              <span>
                Body
                <EditedHere show={overridden.has('body')} />
              </span>
            }
            validateStatus={bodyError ? 'error' : undefined}
            help={bodyError ?? undefined}
            extra={
              template ? (
                <Flex vertical gap={token.marginXXS}>
                  {listField ? (
                    <Typography.Text type="secondary">
                      One point per line, {listField.min} to {listField.max}{' '}
                      points
                    </Typography.Text>
                  ) : null}
                  {listField
                    ? listPoints(watched.body).map((point, position) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: points are positional
                        <Flex key={position} gap={token.marginXS}>
                          <Typography.Text type="secondary">
                            Point {position + 1}:
                          </Typography.Text>
                          <Counter
                            count={charCount(point)}
                            max={listField.max_chars}
                          />
                        </Flex>
                      ))
                    : null}
                  <Counter
                    count={charCount(watched.body)}
                    max={template.fields.body.max_chars}
                  />
                </Flex>
              ) : undefined
            }
          >
            <Input.TextArea
              dir="auto"
              style={textStyle}
              autoSize={{ minRows: listField ? 4 : 2, maxRows: 8 }}
            />
          </Form.Item>

          {timed ? (
            <>
              <Flex gap={token.margin} wrap>
                <Form.Item
                  name="duration_seconds"
                  rules={[{ required: true, message: 'Enter a duration.' }]}
                  label={
                    <span>
                      Duration
                      <EditedHere show={overridden.has('duration_seconds')} />
                    </span>
                  }
                  style={{ marginBottom: token.marginXS }}
                >
                  <InputNumber
                    min={DURATION_MIN}
                    max={durationMax}
                    step={0.5}
                    suffix="s"
                    style={{ width: 120 }}
                  />
                </Form.Item>
                {frame.index !== 1 ? (
                  <Form.Item
                    name="transition"
                    label={
                      <span>
                        Transition
                        <EditedHere show={overridden.has('transition')} />
                      </span>
                    }
                    style={{ marginBottom: token.marginXS }}
                  >
                    <Segmented<Transition>
                      options={(['cut', 'fade', 'slide'] as Transition[]).map(
                        (value) => ({
                          value,
                          label: TRANSITION_LABEL[value],
                        }),
                      )}
                    />
                  </Form.Item>
                ) : null}
              </Flex>
              <Typography.Text
                type={outOfRange ? 'danger' : 'secondary'}
                style={{ display: 'block', marginBottom: token.marginLG }}
              >
                Video length after this change: {seconds(total)}
                {min !== null && max !== null
                  ? ` (allowed ${min}–${max} s)`
                  : ''}
              </Typography.Text>
            </>
          ) : null}
        </Form>

        {template ? (
          <Flex vertical gap={token.marginXS}>
            <Typography.Text strong>
              Background
              <EditedHere show={overridden.has('background_asset_id')} />
            </Typography.Text>
            <BackgroundSection
              frame={frame}
              template={template}
              current={currentBackground}
              onChange={setBackground}
              onGenerated={() => setBackground(undefined)}
              disabled={disabled}
            />
          </Flex>
        ) : null}

        {frame.script_frame && frame.overridden.length > 0 ? (
          <Collapse
            size="small"
            items={[
              {
                key: 'script',
                label: 'Approved script',
                children: (
                  <Flex vertical gap={token.marginSM}>
                    {scriptRows.map(([field, label, value]) => (
                      <Flex key={field} vertical gap={token.marginXXS}>
                        <Flex justify="space-between" align="center">
                          <Typography.Text type="secondary">
                            {label}
                          </Typography.Text>
                          {canEdit ? (
                            <Button
                              type="link"
                              size="small"
                              disabled={disabled}
                              onClick={() => reset(field)}
                              aria-label={`Reset ${label.toLowerCase()} to script`}
                            >
                              Reset to script
                            </Button>
                          ) : null}
                        </Flex>
                        {field === 'headline' || field === 'body' ? (
                          <ContentText preserveLineBreaks>
                            {value || '—'}
                          </ContentText>
                        ) : (
                          <Typography.Text>{value}</Typography.Text>
                        )}
                      </Flex>
                    ))}
                  </Flex>
                ),
              },
            ]}
          />
        ) : null}
      </Flex>
    </Drawer>
  );
};

export default FrameEditDrawer;
