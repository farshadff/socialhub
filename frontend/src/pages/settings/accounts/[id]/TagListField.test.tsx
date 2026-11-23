import { Form, type FormInstance } from 'antd';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import TagListField from './TagListField';

function Harness(props: {
  initial: string[];
  max: number;
  maxItemLength?: number;
  hashtag?: boolean;
  onForm: (form: FormInstance) => void;
}) {
  const [form] = Form.useForm();
  props.onForm(form);
  return (
    <Form form={form} initialValues={{ list: props.initial }}>
      <TagListField
        name="list"
        label="Content pillars"
        max={props.max}
        maxItemLength={props.maxItemLength ?? 80}
        hashtag={props.hashtag}
      />
    </Form>
  );
}

describe('TagListField', () => {
  it('shows the count against the limit', async () => {
    let form: FormInstance | null = null;
    const screen = await render(
      <Harness
        initial={['Energy', 'Myths']}
        max={10}
        onForm={(f) => {
          form = f;
        }}
      />,
    );
    await expect
      .element(screen.getByTestId('list-count'))
      .toHaveTextContent('2 / 10');
    expect(form).not.toBeNull();
  });

  it('turns the counter red and refuses to validate past the limit', async () => {
    let form: FormInstance | null = null;
    const items = Array.from(
      { length: 11 },
      (_, index) => `Pillar ${index + 1}`,
    );
    const screen = await render(
      <Harness
        initial={items}
        max={10}
        onForm={(f) => {
          form = f;
        }}
      />,
    );
    const counter = screen.getByTestId('list-count');
    await expect.element(counter).toHaveTextContent('11 / 10');
    expect(counter.element().className).toContain('ant-typography-danger');
    await expect(
      (form as unknown as FormInstance).validateFields(),
    ).rejects.toBeTruthy();
    await expect.element(screen.getByText('Up to 10 items.')).toBeVisible();
  });

  it('refuses items longer than the item limit', async () => {
    let form: FormInstance | null = null;
    const screen = await render(
      <Harness
        initial={['x'.repeat(81)]}
        max={10}
        maxItemLength={80}
        onForm={(f) => {
          form = f;
        }}
      />,
    );
    await expect(
      (form as unknown as FormInstance).validateFields(),
    ).rejects.toBeTruthy();
    await expect
      .element(screen.getByText('Each item can have up to 80 characters.'))
      .toBeVisible();
  });

  it('shows hashtags with #', async () => {
    const screen = await render(
      <Harness
        initial={['خانه_سبز']}
        max={30}
        hashtag
        onForm={() => undefined}
      />,
    );
    await expect
      .element(screen.getByText('#خانه_سبز').first())
      .toBeInTheDocument();
  });
});
