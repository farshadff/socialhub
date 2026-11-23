import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  MoreOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { EditableProTable, ProCard, type ProColumns } from '@ant-design/pro-components';
import { Button, Dropdown, InputNumber, Modal, Select, Space, Tooltip, theme } from 'antd';
import React from 'react';
import type { ProductionMode, ShotType } from '@/services/socialhub/formats';
import { SCRIPT_LIMITS } from '@/services/socialhub/scripts';
import { COPY, SHOT_TYPE_LABEL } from './constants';
import { ContentInput, ContentTextArea, type FieldState, LockTooltip, useContentLang } from './fields';
import { type EditorPackage, type EditorShot, fieldDomId } from './scriptModel';

export type ShotTableProps = {
  pkg: EditorPackage;
  mode: ProductionMode;
  allowedTypes: ShotType[];
  state: FieldState;
  onChange: (key: string, patch: Partial<Omit<EditorShot, 'key' | 'index'>>) => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
  onDelete: (key: string) => void;
  onAddFrame: (shotKey: string) => void;
};

type TextField = 'description' | 'on_screen_text' | 'voiceover' | 'asset_hint';

/**
 * The shot list (E05-S02 Shots): one inline-edited row per shot. Rows are reordered with move up
 * and move down buttons rather than drag handles, so reordering works by keyboard too.
 */
const ShotTable: React.FC<ShotTableProps> = ({
  pkg,
  mode,
  allowedTypes,
  state,
  onChange,
  onMove,
  onAdd,
  onDelete,
  onAddFrame,
}) => {
  const { token } = theme.useToken();
  const lang = useContentLang();
  const L = SCRIPT_LIMITS;
  const shots = pkg.shots;
  const position = (key: string) => shots.findIndex((s) => s.key === key);
  const lockReason = state.disabled ? state.lockReason : undefined;

  const confirmDelete = (shot: EditorShot) => {
    const frames = pkg.frames.filter((f) => f.shotKey === shot.key).length;
    if (frames === 0) {
      onDelete(shot.key);
      return;
    }
    Modal.confirm({
      title: `Delete shot ${shot.index}?`,
      content:
        frames === 1
          ? 'Its frame will be deleted too.'
          : `Its ${frames} frames will be deleted too.`,
      okText: 'Delete shot',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => onDelete(shot.key),
    });
  };

  const formItemProps = (field: string) => (_form: unknown, config: { entity: EditorShot }) => {
    const path = `shots.${position(config.entity.key)}.${field}`;
    return {
      validateStatus: state.status(path),
      help: state.error(path),
      style: { marginBottom: 0 },
    };
  };

  const textColumn = (
    field: TextField,
    title: string,
    max: number,
    multiline: boolean,
    width: number,
  ): ProColumns<EditorShot> => ({
    title,
    dataIndex: field,
    width,
    formItemProps: formItemProps(field) as ProColumns<EditorShot>['formItemProps'],
    formItemRender: (_schema, config) => {
      const shot = config.record as EditorShot;
      const at = position(shot.key);
      const props = {
        path: `shots.${at}.${field}`,
        lang,
        max,
        value: shot[field],
        disabled: state.disabled,
        'aria-label': `Shot ${shot.index} ${title.toLowerCase()}`,
      };
      return (
        <LockTooltip reason={lockReason}>
          {multiline ? (
            <ContentTextArea
              {...props}
              autoSize={{ minRows: 1, maxRows: 6 }}
              onChange={(e) => onChange(shot.key, { [field]: e.target.value })}
            />
          ) : (
            <ContentInput
              {...props}
              onChange={(e) => onChange(shot.key, { [field]: e.target.value })}
            />
          )}
        </LockTooltip>
      );
    },
  });

  const columns: ProColumns<EditorShot>[] = [
    {
      title: '#',
      dataIndex: 'index',
      width: 48,
      editable: false,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      width: 130,
      formItemProps: formItemProps('type') as ProColumns<EditorShot>['formItemProps'],
      formItemRender: (_schema, config) => {
        const shot = config.record as EditorShot;
        const at = position(shot.key);
        const options = (['footage', 'graphic', 'text'] as ShotType[])
          .filter((t) => allowedTypes.includes(t) || t === shot.type)
          .map((t) => ({ value: t, label: SHOT_TYPE_LABEL[t] }));
        return (
          <LockTooltip reason={lockReason}>
            <Select<ShotType>
              id={fieldDomId(`shots.${at}.type`)}
              aria-label={`Shot ${shot.index} type`}
              value={shot.type}
              options={options}
              disabled={state.disabled}
              style={{ width: '100%' }}
              onChange={(value) => onChange(shot.key, { type: value })}
            />
          </LockTooltip>
        );
      },
    },
    {
      title: 'Duration',
      dataIndex: 'duration_seconds',
      width: 120,
      formItemProps: formItemProps('duration_seconds') as ProColumns<EditorShot>['formItemProps'],
      formItemRender: (_schema, config) => {
        const shot = config.record as EditorShot;
        const at = position(shot.key);
        const input = (
          <InputNumber
            id={fieldDomId(`shots.${at}.duration_seconds`)}
            aria-label={`Shot ${shot.index} duration`}
            value={shot.duration_seconds}
            min={0}
            precision={0}
            suffix="s"
            readOnly={mode === 'motion'}
            disabled={state.disabled}
            style={{ width: '100%' }}
            onChange={(value) => onChange(shot.key, { duration_seconds: Number(value ?? 0) })}
          />
        );
        if (mode === 'motion') {
          return (
            <Tooltip title={lockReason ?? COPY.sumOfFrames}>
              <span style={{ display: 'block' }}>{input}</span>
            </Tooltip>
          );
        }
        return <LockTooltip reason={lockReason}>{input}</LockTooltip>;
      },
    },
    textColumn('description', 'Description', L.shot_description.max, true, 260),
    textColumn('on_screen_text', 'On-screen text', L.shot_on_screen_text.max, false, 200),
    textColumn('voiceover', 'Voiceover note', L.shot_voiceover.max, true, 200),
    textColumn('asset_hint', 'Asset hint', L.shot_asset_hint.max, false, 180),
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      editable: false,
      render: (_dom, shot) => {
        const at = position(shot.key);
        return (
          <Space size={0}>
            <Tooltip title={lockReason ?? `Move shot ${shot.index} up`}>
              <Button
                type="text"
                size="small"
                icon={<ArrowUpOutlined />}
                aria-label={`Move shot ${shot.index} up`}
                disabled={state.disabled || at === 0}
                onClick={() => onMove(at, at - 1)}
              />
            </Tooltip>
            <Tooltip title={lockReason ?? `Move shot ${shot.index} down`}>
              <Button
                type="text"
                size="small"
                icon={<ArrowDownOutlined />}
                aria-label={`Move shot ${shot.index} down`}
                disabled={state.disabled || at === shots.length - 1}
                onClick={() => onMove(at, at + 1)}
              />
            </Tooltip>
            <Dropdown
              disabled={state.disabled}
              trigger={['click']}
              menu={{
                items: [
                  { key: 'add-frame', label: 'Add frame to this shot' },
                  { key: 'delete', label: 'Delete shot', danger: true },
                ],
                onClick: ({ key }) => {
                  if (key === 'add-frame') onAddFrame(shot.key);
                  else confirmDelete(shot);
                },
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<MoreOutlined />}
                aria-label={`More actions for shot ${shot.index}`}
                disabled={state.disabled}
              />
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  return (
    <ProCard title="Shots" headerBordered>
      <EditableProTable<EditorShot>
        rowKey="key"
        value={shots}
        columns={columns}
        controlled
        recordCreatorProps={false}
        search={false}
        options={false}
        toolBarRender={false}
        pagination={false}
        scroll={{ x: 'max-content' }}
        editable={{
          type: 'multiple',
          editableKeys: shots.map((s) => s.key),
          actionRender: () => [],
        }}
      />
      <Button
        id={fieldDomId('shots')}
        type="dashed"
        icon={<PlusOutlined />}
        disabled={state.disabled}
        onClick={onAdd}
        style={{ marginTop: token.margin }}
      >
        Add shot
      </Button>
    </ProCard>
  );
};

export default ShotTable;
