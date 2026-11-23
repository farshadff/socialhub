import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Flex,
  message,
  Popconfirm,
  Typography,
  theme,
  Upload,
} from 'antd';
import React from 'react';
import {
  type BrandProfile,
  brandUpdateFrom,
  type LogoVariant,
  updateBrand,
  uploadLogo,
} from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import { errorText, notifyError } from '@/utils/errorText';
import { accountKeys } from '../shared';
import { LOGO_MAX_BYTES, LOGO_TYPES } from './brandLogic';

/** Preview surfaces that stay white or dark whatever the panel theme is. */
const LIGHT_TOKENS = theme.getDesignToken();
const DARK_TOKENS = theme.getDesignToken({ algorithm: theme.darkAlgorithm });
const SURFACES: Record<LogoVariant, { background: string; text: string }> = {
  light: {
    background: LIGHT_TOKENS.colorBgContainer,
    text: LIGHT_TOKENS.colorTextSecondary,
  },
  dark: {
    background: DARK_TOKENS.colorBgLayout,
    text: DARK_TOKENS.colorTextSecondary,
  },
};

const VARIANTS: {
  variant: LogoVariant;
  title: string;
  field: 'logo_light' | 'logo_dark';
}[] = [
  {
    variant: 'light',
    title: 'Logo for light backgrounds',
    field: 'logo_light',
  },
  { variant: 'dark', title: 'Logo for dark backgrounds', field: 'logo_dark' },
];

/** Problems the panel can see before sending the file (rule 22); the API checks the rest. */
export function logoFileProblem(
  file: Pick<File, 'type' | 'size' | 'name'>,
): string | null {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  if (!(isSvg || isPng) || (file.type && !LOGO_TYPES.includes(file.type))) {
    return 'Use a PNG or SVG file.';
  }
  if (file.size > LOGO_MAX_BYTES) return 'The logo can be up to 2 MB.';
  return null;
}

function uploadErrorText(error: unknown): string {
  if (isApiError(error) && error.code === 'unsupported_media') {
    return 'This file can’t be used as a logo. Use a PNG of 256 to 4,096 pixels on each side, or an SVG without scripts or external links.';
  }
  if (isApiError(error) && error.code === 'payload_too_large') {
    return 'The logo can be up to 2 MB.';
  }
  return errorText(error);
}

type LogoBoxProps = {
  accountId: number;
  brand: BrandProfile;
  variant: LogoVariant;
  title: string;
  url: string | null;
};

const LogoBox: React.FC<LogoBoxProps> = ({
  accountId,
  brand,
  variant,
  title,
  url,
}) => {
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const onSaved = (next: BrandProfile) =>
    queryClient.setQueryData(accountKeys.brand(accountId), next);

  const upload = useMutation({
    mutationFn: (file: File) => uploadLogo(accountId, variant, file),
    onSuccess: (next) => {
      onSaved(next);
      message.success('Logo uploaded');
    },
    onError: (error) => notifyError(error, uploadErrorText(error)),
  });

  // Rule 16: a PUT with the stored values and `null` for this logo. Unsaved form edits stay in the
  // form; they are not sent here.
  const remove = useMutation({
    mutationFn: () =>
      updateBrand(accountId, {
        ...brandUpdateFrom(brand),
        [variant === 'light' ? 'logo_light' : 'logo_dark']: null,
      }),
    onSuccess: (next) => {
      onSaved(next);
      message.success('Logo removed');
    },
  });

  const surface = SURFACES[variant];
  return (
    <Flex vertical gap={token.marginXS} style={{ flex: 1, minWidth: 240 }}>
      <Typography.Text strong>{title}</Typography.Text>
      <div
        data-testid={`logo-preview-${variant}`}
        style={{
          background: surface.background,
          border: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          height: 140,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: token.padding,
        }}
      >
        {url ? (
          <img
            src={url}
            alt={title}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
            }}
          />
        ) : (
          <span style={{ color: surface.text }}>No logo yet</span>
        )}
      </div>
      <Flex gap={token.marginXS} wrap>
        <Upload
          accept=".png,.svg,image/png,image/svg+xml"
          showUploadList={false}
          maxCount={1}
          beforeUpload={(file) => {
            const problem = logoFileProblem(file);
            if (problem) {
              message.error(problem);
              return Upload.LIST_IGNORE;
            }
            return true;
          }}
          customRequest={({ file, onSuccess, onError }) => {
            upload.mutate(file as File, {
              onSuccess: (next) => onSuccess?.(next),
              onError: (error) => onError?.(error as Error),
            });
          }}
        >
          <Button icon={<UploadOutlined />} loading={upload.isPending}>
            {url ? 'Replace' : 'Upload'}
          </Button>
        </Upload>
        {url ? (
          <Popconfirm
            title="Remove this logo?"
            okText="Remove"
            okButtonProps={{ danger: true }}
            onConfirm={() => remove.mutateAsync()}
          >
            <Button icon={<DeleteOutlined />} loading={remove.isPending}>
              Remove
            </Button>
          </Popconfirm>
        ) : null}
      </Flex>
    </Flex>
  );
};

/** The Logos card (E00-S03 Brand tab). Uploads and removals save at once, not with the form. */
const LogoCard: React.FC<{ accountId: number; brand: BrandProfile }> = ({
  accountId,
  brand,
}) => {
  const { token } = theme.useToken();
  return (
    <ProCard title="Logos" headerBordered>
      <Flex gap={token.marginLG} wrap>
        {VARIANTS.map(({ variant, title, field }) => (
          <LogoBox
            key={variant}
            accountId={accountId}
            brand={brand}
            variant={variant}
            title={title}
            url={brand[field]}
          />
        ))}
      </Flex>
      <Typography.Paragraph
        type="secondary"
        style={{ marginTop: token.marginSM, marginBottom: 0 }}
      >
        PNG or SVG, up to 2 MB.
      </Typography.Paragraph>
    </ProCard>
  );
};

export default LogoCard;
