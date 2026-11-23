import { Form, Input } from 'antd';
import type { FormInstance } from 'antd';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { ApiError } from '@/services/socialhub/http';
import { applyFieldErrors, pathToName } from './applyFieldErrors';

const validation = (fields: { path: string; code: string; message: string }[]) =>
  new ApiError(400, { code: 'validation_error', message: '…', fields });

const Harness: React.FC<{ onForm: (form: FormInstance) => void }> = ({
  onForm,
}) => {
  const [instance] = Form.useForm();
  onForm(instance);
  return (
    <Form form={instance}>
      <Form.Item name="title" label="Title">
        <Input />
      </Form.Item>
      <Form.Item name={['goals', 0, 'target_value']} label="Target">
        <Input />
      </Form.Item>
    </Form>
  );
};

async function renderForm() {
  let form: FormInstance | undefined;
  const screen = await render(
    <Harness
      onForm={(instance) => {
        form = instance;
      }}
    />,
  );
  return { screen, form: form as FormInstance };
}

describe('pathToName', () => {
  it('turns dot paths into name arrays with numeric indexes', () => {
    expect(pathToName('goals.0.target_value')).toEqual([
      'goals',
      0,
      'target_value',
    ]);
  });
});

describe('applyFieldErrors (rule 33)', () => {
  it('puts the error under a nested, indexed field (acceptance 11)', async () => {
    const { screen, form } = await renderForm();
    const unmatched = applyFieldErrors(
      form,
      validation([
        { path: 'goals.0.target_value', code: 'min_value', message: '…' },
      ]),
    );
    expect(unmatched).toEqual([]);
    expect(form.getFieldError(['goals', 0, 'target_value'])).toEqual([
      'This is below the minimum.',
    ]);
    await expect
      .element(screen.getByText('This is below the minimum.'))
      .toBeInTheDocument();
  });

  it('uses the API message for an unknown field code', async () => {
    const { form } = await renderForm();
    applyFieldErrors(
      form,
      validation([{ path: 'title', code: 'odd_code', message: 'Odd.' }]),
    );
    expect(form.getFieldError('title')).toEqual(['Odd.']);
  });

  it('returns errors whose path matches no field, for the form-level Alert', async () => {
    const { form } = await renderForm();
    const unmatched = applyFieldErrors(
      form,
      validation([{ path: 'week_start', code: 'required', message: '…' }]),
    );
    expect(unmatched).toEqual(['This is required.']);
  });

  it('ignores errors that are not API errors', async () => {
    const { form } = await renderForm();
    expect(applyFieldErrors(form, new Error('x'))).toEqual([]);
  });
});
