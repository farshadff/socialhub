import {
  FilePdfOutlined,
  SoundOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Empty,
  Flex,
  Input,
  Modal,
  Pagination,
  Skeleton,
  Tabs,
  Typography,
  theme,
} from 'antd';
import React, { useState } from 'react';
import AssetUploader from '@/pages/content/shared/AssetUploader';
import PageError from '@/components/PageError';
import RightsTag from '@/pages/content/shared/RightsTag';
import {
  type Asset,
  type AssetKind,
  formatBytes,
  formatDuration,
  KIND_LABEL,
  listAssets,
  ROLE_KINDS,
  type UploadRole,
} from '@/services/socialhub/assets';

const PAGE_SIZE = 12;

/** Upload role preset per kind when the caller gives none. */
const DEFAULT_ROLE: Record<AssetKind, UploadRole> = {
  image: 'background',
  video: 'clip',
  audio: 'music',
  document: 'source',
};

/** Roles a person can pick from for a kind: system roles (`frame`, `cover`) stay out of the grid. */
function pickableRoles(kind: AssetKind): UploadRole[] {
  return (Object.keys(ROLE_KINDS) as UploadRole[]).filter((role) =>
    ROLE_KINDS[role].includes(kind),
  );
}

/**
 * Asks before using an asset whose rights are restricted or expired (E06-S01).
 * Resolves true when the asset may be used.
 */
export function confirmRights(
  asset: Pick<Asset, 'rights_status'>,
): Promise<boolean> {
  if (
    asset.rights_status !== 'restricted' &&
    asset.rights_status !== 'expired'
  ) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    Modal.confirm({
      title: `This asset's rights are ${asset.rights_status}. The rights check will fail unless you fix them.`,
      okText: 'Use this asset',
      cancelText: 'Choose another',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/** Thumbnail of an asset, or an icon for audio and documents. */
export const AssetThumb: React.FC<{
  asset: Asset;
  height?: number | string;
}> = ({ asset, height = '100%' }) => {
  const { token } = theme.useToken();
  const box: React.CSSProperties = {
    width: '100%',
    height,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: token.colorFillTertiary,
    color: token.colorTextTertiary,
    fontSize: token.fontSizeHeading3,
  };
  const src =
    asset.thumbnail_url ?? (asset.kind === 'image' ? asset.url : null);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        style={{ ...box, objectFit: 'cover', display: 'block' }}
      />
    );
  }
  const icon =
    asset.kind === 'audio' ? (
      <SoundOutlined />
    ) : asset.kind === 'document' ? (
      <FilePdfOutlined />
    ) : (
      <VideoCameraOutlined />
    );
  return (
    <span style={box} aria-hidden>
      {icon}
    </span>
  );
};

/** "2.4 MB" for images and documents, "1 min 32 s" for video and audio. */
export function sizeOrDuration(
  asset: Pick<Asset, 'kind' | 'bytes' | 'duration_ms'>,
): string {
  return asset.kind === 'video' || asset.kind === 'audio'
    ? formatDuration(asset.duration_ms)
    : formatBytes(asset.bytes);
}

export type AssetBrowserProps = {
  accountId: number;
  kind: AssetKind;
  /** Upload preset for "Upload new". */
  uploadRole?: UploadRole;
  /** Shows the "This item" tab. */
  contentItemId?: number | null;
  /** Highlights the chosen asset. */
  selectedId?: number | null;
  /** Called after the rights confirmation, when needed. */
  onPick: (asset: Asset) => void;
  allowUpload?: boolean;
};

/** The two-tab grid with search used by `AssetPicker` and the "From library" tab (E06-S07). */
export const AssetBrowser: React.FC<AssetBrowserProps> = ({
  accountId,
  kind,
  uploadRole,
  contentItemId,
  selectedId,
  onPick,
  allowUpload = true,
}) => {
  const { token } = theme.useToken();
  const hasItem = contentItemId !== undefined && contentItemId !== null;
  const [tab, setTab] = useState<'item' | 'library'>(
    hasItem ? 'item' : 'library',
  );
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);

  const params = {
    account: accountId,
    kind,
    role: pickableRoles(kind),
    content_item:
      tab === 'item' && hasItem ? (contentItemId as number) : ('null' as const),
    q: search || undefined,
    page,
    page_size: PAGE_SIZE,
  };
  const query = useQuery({
    queryKey: [accountId, 'assets', params],
    queryFn: () => listAssets(params),
  });

  const pick = async (asset: Asset) => {
    if (await confirmRights(asset)) onPick(asset);
  };

  const kindPlural = `${KIND_LABEL[kind].toLowerCase()}${kind === 'audio' ? ' files' : 's'}`;
  let body: React.ReactNode;
  if (query.isLoading) {
    body = (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: token.marginSM,
        }}
      >
        {['a', 'b', 'c', 'd', 'e', 'f'].map((slot) => (
          <Skeleton.Node
            key={slot}
            active
            style={{ width: '100%', height: 160 }}
          />
        ))}
      </div>
    );
  } else if (query.error) {
    body = <PageError error={query.error} onRetry={() => query.refetch()} />;
  } else if (!query.data || query.data.results.length === 0) {
    body = (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          search
            ? 'Nothing matches this search.'
            : tab === 'item'
              ? `No ${kindPlural} attached to this item yet.`
              : `No ${kindPlural} in the library yet.`
        }
      />
    );
  } else {
    body = (
      <Flex vertical gap={token.margin}>
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: token.marginSM,
          }}
        >
          {query.data.results.map((asset) => {
            const selected = asset.id === selectedId;
            return (
              <li key={asset.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Choose ${asset.original_filename}`}
                  onClick={() => pick(asset)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                    padding: 0,
                    textAlign: 'start',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    font: 'inherit',
                    color: 'inherit',
                    background: token.colorBgContainer,
                    borderRadius: token.borderRadius,
                    border: `${selected ? token.lineWidthBold : token.lineWidth}px ${token.lineType} ${
                      selected ? token.colorPrimary : token.colorBorderSecondary
                    }`,
                  }}
                >
                  <div style={{ width: '100%', aspectRatio: '1 / 1' }}>
                    <AssetThumb asset={asset} />
                  </div>
                  <Flex
                    vertical
                    gap={token.marginXXS}
                    style={{ padding: token.paddingXS, width: '100%' }}
                  >
                    <Typography.Text ellipsis style={{ maxWidth: '100%' }}>
                      {asset.original_filename}
                    </Typography.Text>
                    <Flex
                      justify="space-between"
                      align="center"
                      gap={token.marginXXS}
                      wrap
                    >
                      <Typography.Text type="secondary">
                        {sizeOrDuration(asset)}
                      </Typography.Text>
                      <RightsTag
                        status={asset.rights_status}
                        licenseNote={asset.license_note}
                        expiresAt={asset.rights_expires_at}
                      />
                    </Flex>
                  </Flex>
                </button>
              </li>
            );
          })}
        </ul>
        {query.data.count > PAGE_SIZE ? (
          <Pagination
            align="center"
            size="small"
            current={page}
            pageSize={PAGE_SIZE}
            total={query.data.count}
            onChange={setPage}
            showSizeChanger={false}
          />
        ) : null}
      </Flex>
    );
  }

  const toolbar = (
    <Flex gap={token.marginXS} wrap>
      <Input.Search
        allowClear
        placeholder="Search by file name or licence note"
        aria-label="Search assets"
        onSearch={(value) => {
          setSearch(value.trim());
          setPage(1);
        }}
        style={{ flex: 1, minWidth: 200 }}
      />
      {allowUpload ? (
        <Button icon={<UploadOutlined />} onClick={() => setUploading(true)}>
          Upload new
        </Button>
      ) : null}
    </Flex>
  );

  return (
    <>
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setTab(key as 'item' | 'library');
          setPage(1);
        }}
        items={[
          ...(hasItem ? [{ key: 'item', label: 'This item' }] : []),
          { key: 'library', label: 'Library' },
        ]}
      />
      <Flex vertical gap={token.margin}>
        {toolbar}
        {body}
      </Flex>
      <AssetUploader
        open={uploading}
        accountId={accountId}
        contentItemId={tab === 'item' ? contentItemId : null}
        defaultRole={uploadRole ?? DEFAULT_ROLE[kind]}
        roles={uploadRole ? [uploadRole] : pickableRoles(kind)}
        onClose={(uploaded) => {
          setUploading(false);
          if (uploaded.length > 0) query.refetch();
        }}
      />
    </>
  );
};

const PICKER_TITLE: Record<AssetKind, string> = {
  image: 'Choose an image',
  video: 'Choose a video',
  audio: 'Choose audio',
  document: 'Choose a document',
};

export type AssetPickerProps = {
  open: boolean;
  accountId: number;
  kind: AssetKind;
  /** Upload preset for "Upload new" (for example `music` or `clip`). */
  uploadRole?: UploadRole;
  contentItemId?: number | null;
  selectedId?: number | null;
  title?: string;
  onSelect: (asset: Asset) => void;
  onClose: () => void;
};

/**
 * Chooses an existing asset (E06-S01): tabs "This item" and "Library", a thumbnail grid with
 * search, rights on every card and an upload shortcut with the role preset.
 */
const AssetPicker: React.FC<AssetPickerProps> = ({
  open,
  title,
  onSelect,
  onClose,
  kind,
  ...rest
}) => (
  <Modal
    open={open}
    title={title ?? PICKER_TITLE[kind]}
    onCancel={onClose}
    footer={null}
    width={760}
    destroyOnHidden
  >
    <AssetBrowser
      {...rest}
      kind={kind}
      onPick={(asset) => {
        onSelect(asset);
        onClose();
      }}
    />
  </Modal>
);

export default AssetPicker;
