import { FooterToolbar, ProCard, ProForm } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Col,
  ColorPicker,
  Flex,
  Form,
  Input,
  message,
  Radio,
  Row,
  Select,
  Skeleton,
  theme,
} from 'antd';
import type { Color } from 'antd/es/color-picker';
import React, { useEffect, useState } from 'react';
import PageError from '@/components/PageError';
import {
  type Account,
  type BrandProfile,
  getBrand,
  listFonts,
  updateBrand,
} from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { brandFontStack, loadBrandFont } from '@/utils/brandFonts';
import { notifyError } from '@/utils/errorText';
import { useUnsavedChangesGuard } from '@/utils/unsavedChanges';
import { accountKeys, FONTS_QUERY_KEY } from '../shared';
import BrandPreview from './BrandPreview';
import {
  AI_DISCLOSURE_OPTIONS,
  type BrandFormValues,
  COLOR_FIELDS,
  formValuesFrom,
  LIST_FIELDS,
  lowContrastText,
  missingForComplete,
  TEXT_LIMITS,
  toBrandUpdate,
} from './brandLogic';
import LogoCard from './LogoCard';
import TagListField from './TagListField';

/** Fonts from `GET /fonts/`, each loaded with the FontFace API so it can render in its own face. */
export function useBrandFonts() {
  const query = useQuery({
    queryKey: FONTS_QUERY_KEY,
    queryFn: listFonts,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const fonts = query.data?.results;
  useEffect(() => {
    for (const font of fonts ?? []) loadBrandFont(font);
  }, [fonts]);
  return query;
}

type BrandFormProps = { account: Account; brand: BrandProfile };

const BrandForm: React.FC<BrandFormProps> = ({ account, brand }) => {
  const { token } = theme.useToken();
  const [form] = Form.useForm<BrandFormValues>();
  const queryClient = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const fontsQuery = useBrandFonts();
  useUnsavedChangesGuard(dirty);

  const [initialValues] = useState(() => formValuesFrom(brand));
  const colors = Form.useWatch('colors', form) ?? brand.colors;
  const fonts = Form.useWatch('fonts', form) ?? brand.fonts;
  const handleDisplay = Form.useWatch('handle_display', form);

  const fontOptions = (fontsQuery.data?.results ?? []).map((font) => ({
    value: font.key,
    label: (
      <span style={{ fontFamily: brandFontStack(font.key) }}>{font.name}</span>
    ),
    title: font.name,
  }));
  const fontSelectProps = {
    options: fontOptions,
    loading: fontsQuery.isLoading,
    showSearch: { optionFilterProp: 'title' },
    status: fontsQuery.isError ? ('warning' as const) : undefined,
  };

  const lowContrast = brand.warnings.find(
    (warning) =>
      warning.code === 'low_contrast' && warning.path === 'colors.text',
  );
  const otherWarnings = brand.warnings.filter(
    (warning) => warning !== lowContrast,
  );
  const missing = brand.complete ? [] : missingForComplete(brand);

  const onFinish = async (values: BrandFormValues) => {
    setFormErrors([]);
    setSaving(true);
    try {
      const saved = await updateBrand(account.id, toBrandUpdate(values));
      queryClient.setQueryData(accountKeys.brand(account.id), saved);
      queryClient.invalidateQueries({
        queryKey: accountKeys.account(account.id),
      });
      form.setFieldsValue(formValuesFrom(saved));
      setDirty(false);
      message.success('Brand profile saved');
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_error') {
        setFormErrors(applyFieldErrors(form, error));
      } else {
        notifyError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flex vertical gap={token.margin}>
      {missing.length ? (
        <Alert
          type="info"
          showIcon
          title="The brand profile is not complete yet"
          description={
            <ul style={{ margin: 0, paddingInlineStart: token.paddingLG }}>
              {missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          }
        />
      ) : null}
      {otherWarnings.map((warning) => (
        <Alert
          key={`${warning.path}-${warning.code}`}
          type="warning"
          showIcon
          title={warning.message}
        />
      ))}
      <LogoCard accountId={account.id} brand={brand} />
      <ProForm<BrandFormValues>
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={() => setDirty(true)}
        onFinish={onFinish}
        onFinishFailed={() => message.error('Some fields need attention.')}
        submitter={{
          render: () => (
            <FooterToolbar>
              <Button type="primary" htmlType="submit" loading={saving}>
                Save brand profile
              </Button>
            </FooterToolbar>
          ),
        }}
      >
        <Flex vertical gap={token.margin}>
          {formErrors.length ? (
            <Alert type="error" showIcon title={formErrors.join(' ')} />
          ) : null}
          <ProCard title="Colours" headerBordered>
            <Row gutter={[token.marginLG, token.margin]}>
              <Col xs={24} lg={10}>
                {COLOR_FIELDS.map(({ key, label }) => (
                  <React.Fragment key={key}>
                    <Form.Item
                      name={['colors', key]}
                      label={label}
                      getValueFromEvent={(color: Color) =>
                        color.toHexString().toUpperCase()
                      }
                      rules={[{ required: true, message: 'This is required.' }]}
                    >
                      <ColorPicker
                        format="hex"
                        disabledAlpha
                        disabledFormat
                        showText
                        aria-label={`${label} colour`}
                      />
                    </Form.Item>
                    {key === 'text' && lowContrast ? (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: token.margin }}
                        title={lowContrastText(brand.colors)}
                      />
                    ) : null}
                  </React.Fragment>
                ))}
              </Col>
              <Col xs={24} lg={14}>
                <BrandPreview
                  colors={colors}
                  headingFont={fonts?.heading}
                  bodyFont={fonts?.body}
                  handle={handleDisplay}
                />
              </Col>
            </Row>
          </ProCard>
          <ProCard title="Fonts" headerBordered>
            {fontsQuery.isError ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: token.margin }}
                title="The font list couldn't be loaded."
                action={
                  <Button size="small" onClick={() => fontsQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : null}
            <Row gutter={token.marginLG}>
              <Col xs={24} md={12}>
                <Form.Item
                  name={['fonts', 'heading']}
                  label="Heading font"
                  rules={[{ required: true, message: 'This is required.' }]}
                >
                  <Select {...fontSelectProps} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name={['fonts', 'body']}
                  label="Body font"
                  rules={[{ required: true, message: 'This is required.' }]}
                >
                  <Select {...fontSelectProps} />
                </Form.Item>
              </Col>
            </Row>
          </ProCard>
          <ProCard title="Voice and audience" headerBordered>
            <Form.Item name="tone_of_voice" label="Tone of voice">
              <Input.TextArea
                dir="auto"
                rows={4}
                showCount
                maxLength={TEXT_LIMITS.tone_of_voice}
              />
            </Form.Item>
            <Form.Item name="audience_summary" label="Audience">
              <Input.TextArea
                dir="auto"
                rows={3}
                showCount
                maxLength={TEXT_LIMITS.audience_summary}
              />
            </Form.Item>
            <Form.Item
              name="handle_display"
              label="Handle shown on assets"
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: 'This is required.',
                },
              ]}
            >
              <Input
                dir="auto"
                maxLength={TEXT_LIMITS.handle_display}
                showCount
              />
            </Form.Item>
            <Form.Item name="ai_disclosure" label="AI disclosure">
              <Radio.Group options={AI_DISCLOSURE_OPTIONS} />
            </Form.Item>
          </ProCard>
          <ProCard title="Lists" headerBordered>
            {LIST_FIELDS.map((field) => (
              <TagListField
                key={field.name}
                name={field.name}
                label={field.label}
                max={field.max}
                maxItemLength={field.maxItemLength}
                hashtag={field.hashtag}
              />
            ))}
          </ProCard>
        </Flex>
      </ProForm>
    </Flex>
  );
};

/** Brand tab (E00-S03 FE3): five cards and one "Save brand profile" button. */
const BrandTab: React.FC<{ account: Account }> = ({ account }) => {
  const query = useQuery({
    queryKey: accountKeys.brand(account.id),
    queryFn: () => getBrand(account.id),
  });
  if (query.isPending) {
    return (
      <ProCard>
        <Skeleton active paragraph={{ rows: 10 }} />
      </ProCard>
    );
  }
  if (query.isError) {
    return <PageError error={query.error} onRetry={() => query.refetch()} />;
  }
  return <BrandForm key={account.id} account={account} brand={query.data} />;
};

export default BrandTab;
