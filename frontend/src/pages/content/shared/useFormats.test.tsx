import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { registry, withQueryClient } from '@/pages/content/workspace/tabs/brief/testFixtures';
import { getFormats } from '@/services/socialhub/formats';
import RolePicker from './RolePicker';
import useFormats from './useFormats';

vi.mock('@/services/socialhub/formats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/formats')>()),
  getFormats: vi.fn(),
}));

const Label: React.FC<{ id: string }> = ({ id }) => {
  const { formatLabel, modeLabel, getSpec } = useFormats();
  return (
    <div data-testid={id}>
      {formatLabel('story', 'video')} | {formatLabel('story')} | {modeLabel('motion')} |{' '}
      {getSpec('reel', 'image') ? 'spec' : 'no spec'}
    </div>
  );
};

describe('useFormats (E04-S01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFormats).mockResolvedValue(registry);
  });

  it('fetches the registry once for two consumers', async () => {
    await render(
      withQueryClient(
        <>
          <Label id="a" />
          <Label id="b" />
        </>,
      ),
    );
    await expect.element(page.getByTestId('a')).toHaveTextContent('Video story | Story | Motion | no spec');
    await expect.element(page.getByTestId('b')).toHaveTextContent('Video story');
    expect(getFormats).toHaveBeenCalledTimes(1);
  });

  it('falls back to built-in labels when the registry fails', async () => {
    vi.mocked(getFormats).mockRejectedValue(new Error('down'));
    await render(withQueryClient(<Label id="c" />));
    await expect.element(page.getByTestId('c')).toHaveTextContent('Story | Story | Motion | no spec');
  });
});

describe('RolePicker (E04-S02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFormats).mockResolvedValue(registry);
  });

  it('shows five roles with their purpose and metric', async () => {
    const onChange = vi.fn();
    await render(withQueryClient(<RolePicker value="educate" onChange={onChange} format="reel" />));
    await expect.element(page.getByText('Teach something useful enough to save')).toBeVisible();
    await expect.element(page.getByText('Measured by: Comments')).toBeVisible();
    expect(page.getByRole('radio').all()).toHaveLength(5);
    await page.getByText('Engage', { exact: true }).click();
    expect(onChange).toHaveBeenCalledWith('engage');
  });

  it('uses the story metric and offers "No role yet" when clearable', async () => {
    const onChange = vi.fn();
    await render(
      withQueryClient(<RolePicker value={null} onChange={onChange} format="story" allowClear />),
    );
    await expect.element(page.getByText('Measured by: Replies')).toBeVisible();
    await expect.element(page.getByText('No role yet')).toBeVisible();
    await page.getByText('Attract', { exact: true }).click();
    expect(onChange).toHaveBeenCalledWith('attract');
  });
});
