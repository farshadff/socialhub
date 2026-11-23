import {
  AppstoreOutlined,
  BarsOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  PageContainer,
  ProCard,
  ProTable,
  type ProColumns,
} from '@ant-design/pro-components';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Button,
  Empty,
  Flex,
  Input,
  Pagination,
  Segmented,
  Select,
  Skeleton,
  Tag,
  Typography,
  theme,
} from 'antd';
import dayjs from 'dayjs';
import React, { useState } from 'react';
import AccountGate from '@/components/AccountGate';
import { AssetThumb, sizeOrDuration } from '@/pages/content/shared/AssetPicker';
import AssetUploader from '@/pages/content/shared/AssetUploader';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import RightsTag from '@/pages/content/shared/RightsTag';
import {
  type Asset,
  type AssetKind,
  type AssetListParams,
  type AssetOrigin,
  formatBytes,
  formatDuration,
  KIND_LABEL,
  listAssets,
  ORIGIN_LABEL,
  ROLE_LABEL,
  type RightsStatus,
} from '@/services/socialhub/assets';
import { useAccountId } from '@/utils/accountRequest';
import AssetDrawer from './AssetDrawer';

type KindFilter = 'all' | AssetKind;
type Scope = 'library' | 'all' | 'used' | 'unused';
type View = 'grid' | 'list';

export type LibraryFilters = {
  q: string;
  kind: KindFilter;
  rights?: RightsStatus;
  origin?: AssetOrigin;
  scope: Scope;
};

export const DEFAULT_FILTERS: LibraryFilters = {
  q: '',
  kind: 'all',
  scope: 'library',
};

const VIEW_STORAGE_KEY = 'socialhub.library.view';
const GRID_PAGE_SIZE = 24;
const LIST_PAGE_SIZE = 20;

/** Filter bar values → `GET /assets/` query (E06-S01). */
export function toListParams(
  accountId: number,
  filters: LibraryFilters,
  page: number,
  pageSize: number,
): AssetListParams {
  return {
    account: accountId,
    q: filters.q || undefined,
    kind: filters.kind === 'all' ? undefined : filters.kind,
    rights_status: filters.rights ? [filters.rights] : undefined,
    origin: filters.origin ? [filters.origin] : undefined,
    content_item: filters.scope === 'library' ? 'null' : undefined,
    in_use:
      filters.scope === 'used'
        ? true
        : filters.scope === 'unused'
          ? false
          : undefined,
    page,
    page_size: pageSize,
  };
}

export function filtersActive(filters: LibraryFilters): boolean {
  return (
    filters.q !== '' ||
    filters.kind !== 'all' ||
    !!filters.rights ||
    !!filters.origin ||
    filters.scope !== 'library'
  );
}

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list'
      ? 'list'
      : 'grid';
  } catch {
    return 'grid';
  }
}

function storeView(view: View) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Storage can be unavailable; the choice then lasts for this page only.
  }
}

const AssetCard: React.FC<{ asset: Asset; onOpen: () => void }> = ({
  asset,
  onOpen,
}) => {
  const { token } = theme.useToken();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${asset.original_filename}`}
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
        border: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
      }}
    >
      <div style={{ width: '100%', aspectRatio: '4 / 3' }}>
        <AssetThumb asset={asset} />
      </div>
      <Flex
        vertical
        gap={token.marginXXS}
        style={{ padding: token.paddingSM, width: '100%' }}
      >
        <Typography.Text ellipsis style={{ maxWidth: '100%' }}>
          {asset.original_filename}
        </Typography.Text>
        <Typography.Text type="secondary">
          {sizeOrDuration(asset)}
        </Typography.Text>
        <Flex gap={token.marginXXS} wrap>
          <RightsTag
            status={asset.rights_status}
            licenseNote={asset.license_note}
            expiresAt={asset.rights_expires_at}
          />
          {asset.in_use ? <Tag>In use</Tag> : null}
        </Flex>
      </Flex>
    </button>
  );
};

const gridStyle = (gap: number): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap,
});

const Library: React.FC<{ accountId: number }> = ({ accountId }) => {
  const { token } = theme.useToken();
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>(readView);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(
    view === 'grid' ? GRID_PAGE_SIZE : LIST_PAGE_SIZE,
  );
  const [uploading, setUploading] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const params = toListParams(accountId, filters, page, pageSize);
  const query = useQuery({
    queryKey: [accountId, 'assets', params],
    queryFn: () => listAssets(params),
    placeholderData: keepPreviousData,
  });

  const change = (next: Partial<LibraryFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  };
  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearch('');
    setPage(1);
  };
  const switchView = (next: View) => {
    setView(next);
    storeView(next);
    setPageSize(next === 'grid' ? GRID_PAGE_SIZE : LIST_PAGE_SIZE);
    setPage(1);
  };

  const uploadButton = (
    <Button
      type="primary"
      icon={<UploadOutlined />}
      onClick={() => setUploading(true)}
    >
      Upload
    </Button>
  );

  const filterBar = (
    <Flex gap={token.marginSM} wrap align="center">
      <Input.Search
        allowClear
        aria-label="Search assets"
        placeholder="Search by file name or licence note"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          if (event.target.value === '') change({ q: '' });
        }}
        onSearch={(value) => change({ q: value.trim() })}
        style={{ width: 280 }}
      />
      <Segmented<KindFilter>
        aria-label="Kind"
        value={filters.kind}
        onChange={(kind) => change({ kind })}
        options={[
          { value: 'all', label: 'All' },
          { value: 'image', label: 'Images' },
          { value: 'video', label: 'Video' },
          { value: 'audio', label: 'Audio' },
          { value: 'document', label: 'Documents' },
        ]}
      />
      <Select<RightsStatus>
        allowClear
        aria-label="Rights"
        placeholder="Rights"
        value={filters.rights}
        onChange={(rights) => change({ rights })}
        style={{ minWidth: 140 }}
        options={[
          { value: 'cleared', label: 'Cleared' },
          { value: 'unknown', label: 'Unknown' },
          { value: 'restricted', label: 'Restricted' },
          { value: 'expired', label: 'Expired' },
        ]}
      />
      <Select<AssetOrigin>
        allowClear
        aria-label="Origin"
        placeholder="Origin"
        value={filters.origin}
        onChange={(origin) => change({ origin })}
        style={{ minWidth: 150 }}
        options={(Object.keys(ORIGIN_LABEL) as AssetOrigin[]).map((origin) => ({
          value: origin,
          label: ORIGIN_LABEL[origin],
        }))}
      />
      <Select<Scope>
        aria-label="Scope"
        value={filters.scope}
        onChange={(scope) => change({ scope })}
        style={{ minWidth: 150 }}
        options={[
          { value: 'library', label: 'Library only' },
          { value: 'all', label: 'All' },
          { value: 'used', label: 'Used' },
          { value: 'unused', label: 'Unused' },
        ]}
      />
      <div style={{ flex: 1 }} />
      <Segmented<View>
        aria-label="View"
        value={view}
        onChange={switchView}
        options={[
          { value: 'grid', icon: <AppstoreOutlined />, label: 'Grid' },
          { value: 'list', icon: <BarsOutlined />, label: 'List' },
        ]}
      />
    </Flex>
  );

  const columns: ProColumns<Asset>[] = [
    {
      title: 'Preview',
      dataIndex: 'thumbnail_url',
      width: 72,
      render: (_, asset) => (
        <div
          style={{
            width: 48,
            height: 48,
            overflow: 'hidden',
            borderRadius: token.borderRadiusSM,
          }}
        >
          <AssetThumb asset={asset} />
        </div>
      ),
    },
    {
      title: 'Name',
      dataIndex: 'original_filename',
      ellipsis: true,
      render: (_, asset) => (
        <Typography.Link onClick={() => setOpenId(asset.id)}>
          {asset.original_filename}
        </Typography.Link>
      ),
    },
    {
      title: 'Kind',
      dataIndex: 'kind',
      render: (_, asset) => KIND_LABEL[asset.kind],
    },
    {
      title: 'Role',
      dataIndex: 'role',
      render: (_, asset) => ROLE_LABEL[asset.role],
    },
    {
      title: 'Size',
      dataIndex: 'bytes',
      render: (_, asset) => formatBytes(asset.bytes),
    },
    {
      title: 'Dimensions/Duration',
      dataIndex: 'width',
      render: (_, asset) => {
        const parts: string[] = [];
        if (asset.width && asset.height)
          parts.push(`${asset.width} × ${asset.height}`);
        if (asset.duration_ms) parts.push(formatDuration(asset.duration_ms));
        return parts.join(' · ') || '—';
      },
    },
    {
      title: 'Origin',
      dataIndex: 'origin',
      render: (_, asset) => ORIGIN_LABEL[asset.origin],
    },
    {
      title: 'Rights',
      dataIndex: 'rights_status',
      render: (_, asset) => (
        <RightsTag
          status={asset.rights_status}
          licenseNote={asset.license_note}
          expiresAt={asset.rights_expires_at}
        />
      ),
    },
    {
      title: 'Expires',
      dataIndex: 'rights_expires_at',
      render: (_, asset) =>
        asset.rights_expires_at
          ? dayjs(asset.rights_expires_at).format('D MMM YYYY')
          : '—',
    },
    {
      title: 'Added',
      dataIndex: 'created_at',
      render: (_, asset) => <DateTime value={asset.created_at} format="date" />,
    },
    {
      title: 'Used',
      dataIndex: 'in_use',
      render: (_, asset) => (asset.in_use ? <Tag>In use</Tag> : 'Unused'),
    },
  ];

  const results = query.data?.results ?? [];
  const total = query.data?.count ?? 0;

  let content: React.ReactNode;
  if (query.error && !query.data) {
    content = <PageError error={query.error} onRetry={() => query.refetch()} />;
  } else if (query.isLoading) {
    content =
      view === 'grid' ? (
        <div style={gridStyle(token.margin)} data-testid="library-loading">
          {Array.from({ length: 8 }, (_, n) => `slot-${n}`).map((slot) => (
            <Skeleton.Node
              key={slot}
              active
              style={{ width: '100%', height: 240 }}
            />
          ))}
        </div>
      ) : (
        <Skeleton active paragraph={{ rows: 8 }} />
      );
  } else if (total === 0 && !filtersActive(filters)) {
    content = (
      <Empty description="No assets yet. Upload images, clips or music to use in production.">
        {uploadButton}
      </Empty>
    );
  } else if (total === 0) {
    content = (
      <Empty description="Nothing matches these filters.">
        <Button onClick={clearFilters}>Clear filters</Button>
      </Empty>
    );
  } else if (view === 'grid') {
    content = (
      <Flex vertical gap={token.marginLG}>
        <div style={gridStyle(token.margin)}>
          {results.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onOpen={() => setOpenId(asset.id)}
            />
          ))}
        </div>
        <Pagination
          align="end"
          current={page}
          pageSize={pageSize}
          total={total}
          showSizeChanger={false}
          showTotal={(count) => `${count.toLocaleString('en')} assets`}
          onChange={setPage}
        />
      </Flex>
    );
  } else {
    content = (
      <ProTable<Asset>
        rowKey="id"
        columns={columns}
        dataSource={results}
        loading={query.isFetching}
        search={false}
        options={false}
        toolBarRender={false}
        scroll={{ x: 1200 }}
        onRow={(asset) => ({
          onClick: () => setOpenId(asset.id),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (count) => `${count.toLocaleString('en')} assets`,
          onChange: (next, size) => {
            setPage(size !== pageSize ? 1 : next);
            setPageSize(size);
          },
        }}
      />
    );
  }

  return (
    <PageContainer
      title="Library"
      content="Images, clips and music for this account, with their usage rights."
      extra={uploadButton}
    >
      <ProCard>
        <Flex vertical gap={token.marginLG}>
          {filterBar}
          {content}
        </Flex>
      </ProCard>
      <AssetUploader
        open={uploading}
        accountId={accountId}
        defaultRole="source"
        onClose={(uploaded) => {
          setUploading(false);
          if (uploaded.length > 0) query.refetch();
        }}
      />
      <AssetDrawer
        accountId={accountId}
        assetId={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => query.refetch()}
      />
    </PageContainer>
  );
};

const LibraryPage: React.FC = () => {
  const accountId = useAccountId();
  return (
    <AccountGate title="Library">
      {accountId !== null ? (
        <Library key={accountId} accountId={accountId} />
      ) : null}
    </AccountGate>
  );
};

export default LibraryPage;
