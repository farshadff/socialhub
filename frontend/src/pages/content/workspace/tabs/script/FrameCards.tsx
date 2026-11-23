import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import {
  Button,
  Col,
  Empty,
  Form,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import React from 'react';
import ContentText from '@/components/ContentText';
import type { FrameTemplate, FrameTemplateKey, ProductionMode } from '@/services/socialhub/formats';
import { SCRIPT_LIMITS, type Transition } from '@/services/socialhub/scripts';
import { TRANSITION_LABEL, TRANSITIONS } from './constants';
import { ContentInput, ContentTextArea, Field, type FieldState, useContentLang } from './fields';
import {
  type EditorFrame,
  type EditorPackage,
  type EditorShot,
  fieldDomId,
  templateFor,
} from './scriptModel';

export type FrameCardsProps = {
  pkg: EditorPackage;
  templates: FrameTemplate[];
  mode: ProductionMode;
  isImage: boolean;
  canvas: { width: number; height: number };
  state: FieldState;
  onChange: (
    key: string,
    patch: Partial<Omit<EditorFrame, 'key' | 'index' | 'shot_index'>>,
  ) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
  onAdd: () => void;
};

/** The schematic preview: the format's aspect ratio with headline and body as plain text. */
const FramePreview: React.FC<{
  frame: EditorFrame;
  canvas: { width: number; height: number };
}> = ({ frame, canvas }) => {
  const { token } = theme.useToken();
  const empty = !frame.headline.trim() && !frame.body.trim();
  return (
    <figure
      aria-label={`Frame ${frame.index} preview`}
      style={{
        aspectRatio: `${canvas.width} / ${canvas.height}`,
        width: '60%',
        margin: `0 auto ${token.marginSM}px`,
        padding: token.paddingSM,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: token.marginXXS,
        overflow: 'hidden',
        background: token.colorFillQuaternary,
        border: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        fontSize: token.fontSizeSM,
        textAlign: 'start',
      }}
    >
      {empty ? (
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          No text yet
        </Typography.Text>
      ) : (
        <>
          <div
            style={{
              fontSize: frame.template === 'stat' ? token.fontSizeHeading3 : token.fontSize,
            }}
          >
            <ContentText as="div" strong>
              {frame.headline}
            </ContentText>
          </div>
          {frame.body.trim() ? (
            <ContentText as="div" preserveLineBreaks>
              {frame.body}
            </ContentText>
          ) : null}
        </>
      )}
    </figure>
  );
};

type FrameCardProps = Omit<FrameCardsProps, 'pkg' | 'onAdd'> & {
  frame: EditorFrame;
  position: number;
  count: number;
  shots: EditorShot[];
};

const FrameCard: React.FC<FrameCardProps> = ({
  frame,
  position,
  count,
  shots,
  templates,
  mode,
  isImage,
  canvas,
  state,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}) => {
  const { token } = theme.useToken();
  const lang = useContentLang();
  const template = templateFor(templates, frame.template);
  const n = frame.index;
  const path = (field: string) => `frames.${position}.${field}`;
  const shot = shots.find((s) => s.key === frame.shotKey);
  const lockReason = state.disabled ? state.lockReason : undefined;
  const iconButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <Tooltip title={lockReason ?? label}>
      <Button
        type="text"
        size="small"
        icon={icon}
        aria-label={label}
        disabled={state.disabled || disabled}
        onClick={onClick}
      />
    </Tooltip>
  );

  const extra = isImage ? null : (
    <Space size={0}>
      {iconButton(
        `Move frame ${n} left`,
        <ArrowLeftOutlined />,
        () => onMove(position, position - 1),
        position === 0,
      )}
      {iconButton(
        `Move frame ${n} right`,
        <ArrowRightOutlined />,
        () => onMove(position, position + 1),
        position === count - 1,
      )}
      {iconButton(`Duplicate frame ${n}`, <CopyOutlined />, () => onDuplicate(frame.key))}
      <Popconfirm
        title={`Delete frame ${n}?`}
        okText="Delete"
        okButtonProps={{ danger: true }}
        cancelText="Cancel"
        onConfirm={() => onDelete(frame.key)}
        disabled={state.disabled}
      >
        <Tooltip title={lockReason ?? `Delete frame ${n}`}>
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            aria-label={`Delete frame ${n}`}
            disabled={state.disabled}
          />
        </Tooltip>
      </Popconfirm>
    </Space>
  );

  const lines = template?.body_lines;
  return (
    <div id={fieldDomId(`frames.${position}`)} tabIndex={-1} style={{ height: '100%' }}>
      <ProCard
        title={isImage ? template?.label ?? frame.template : `${n} · ${template?.label ?? frame.template}`}
        extra={extra}
        variant="outlined"
        size="small"
        headerBordered
        style={{ height: '100%' }}
      >
        <FramePreview frame={frame} canvas={canvas} />
        <Form layout="vertical" component="div">
          <Field path={path('template')} label="Template" state={state}>
            <Select<FrameTemplateKey>
              id={fieldDomId(path('template'))}
              value={frame.template}
              disabled={state.disabled}
              status={state.status(path('template'))}
              options={templates.map((t) => ({
                value: t.key,
                label: t.label,
                purpose: t.purpose,
              }))}
              optionRender={(option) => (
                <Space orientation="vertical" size={0}>
                  <span>{option.data.label}</span>
                  <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    {option.data.purpose}
                  </Typography.Text>
                </Space>
              )}
              onChange={(value) => onChange(frame.key, { template: value })}
            />
          </Field>
          {isImage ? null : (
            <Field path={path('shot_index')} label="Shot" state={state}>
              <Select<string>
                id={fieldDomId(path('shot_index'))}
                value={shot ? frame.shotKey : undefined}
                placeholder="Choose a shot"
                disabled={state.disabled}
                status={state.status(path('shot_index'))}
                options={shots.map((s) => ({ value: s.key, label: `Shot ${s.index}` }))}
                onChange={(value) => onChange(frame.key, { shotKey: value })}
              />
            </Field>
          )}
          <Field path={path('headline')} label="Headline" state={state} required>
            <ContentInput
              path={path('headline')}
              lang={lang}
              max={template?.headline.max}
              value={frame.headline}
              disabled={state.disabled}
              onChange={(e) => onChange(frame.key, { headline: e.target.value })}
            />
          </Field>
          <Field
            path={path('body')}
            label="Body"
            state={state}
            required={!!template && template.body.min > 0}
            extra={lines ? `One point per line, ${lines.min}–${lines.max} lines` : undefined}
          >
            <ContentTextArea
              path={path('body')}
              lang={lang}
              max={lines ? undefined : template?.body.max}
              autoSize={{ minRows: 2, maxRows: 6 }}
              value={frame.body}
              disabled={state.disabled}
              onChange={(e) => onChange(frame.key, { body: e.target.value })}
            />
          </Field>
          <Field
            path={path('visual_prompt')}
            label="Background image description"
            state={state}
            required={!!template?.visual_prompt.required}
          >
            <ContentTextArea
              path={path('visual_prompt')}
              lang={lang}
              max={Math.min(
                template?.visual_prompt.max ?? SCRIPT_LIMITS.visual_prompt.max,
                SCRIPT_LIMITS.visual_prompt.max,
              )}
              autoSize={{ minRows: 2, maxRows: 6 }}
              value={frame.visual_prompt}
              disabled={state.disabled}
              onChange={(e) => onChange(frame.key, { visual_prompt: e.target.value })}
            />
          </Field>
          {isImage ? null : (
            <Row gutter={token.marginSM}>
              <Col span={12}>
                <Field path={path('duration_seconds')} label="Duration" state={state}>
                  <InputNumber
                    id={fieldDomId(path('duration_seconds'))}
                    value={frame.duration_seconds}
                    min={0}
                    max={mode === 'video' && shot ? shot.duration_seconds : undefined}
                    precision={0}
                    suffix="s"
                    status={state.status(path('duration_seconds'))}
                    disabled={state.disabled}
                    style={{ width: '100%' }}
                    onChange={(value) =>
                      onChange(frame.key, { duration_seconds: Number(value ?? 0) })
                    }
                  />
                </Field>
              </Col>
              <Col span={12}>
                <Field path={path('transition')} label="Transition" state={state}>
                  <Select<Transition>
                    id={fieldDomId(path('transition'))}
                    value={frame.transition}
                    disabled={state.disabled}
                    options={TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABEL[t] }))}
                    onChange={(value) => onChange(frame.key, { transition: value })}
                  />
                </Field>
              </Col>
            </Row>
          )}
        </Form>
      </ProCard>
    </div>
  );
};

/** Frame cards, four per row at 1280 px; one card for image formats (E05-S02 Frames). */
const FrameCards: React.FC<FrameCardsProps> = (props) => {
  const { token } = theme.useToken();
  const { pkg, isImage, state, onAdd } = props;
  const frames = isImage ? pkg.frames.slice(0, 1) : pkg.frames;
  return (
    <ProCard title={isImage ? 'Frame' : 'Frames'} headerBordered>
      {frames.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No frames. Add one to put text on screen." />
      ) : (
        <Row gutter={[token.margin, token.margin]}>
          {frames.map((frame, position) => (
            <Col key={frame.key} xs={24} md={12} xl={isImage ? 8 : 6}>
              <FrameCard
                {...props}
                frame={frame}
                position={position}
                count={frames.length}
                shots={pkg.shots}
              />
            </Col>
          ))}
        </Row>
      )}
      {isImage ? null : (
        <Button
          id={fieldDomId('frames')}
          type="dashed"
          icon={<PlusOutlined />}
          disabled={state.disabled || pkg.shots.length === 0}
          onClick={onAdd}
          style={{ marginTop: token.margin }}
        >
          Add frame
        </Button>
      )}
    </ProCard>
  );
};

export default FrameCards;
