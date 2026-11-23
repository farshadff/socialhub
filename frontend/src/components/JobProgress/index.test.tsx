import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { getJob } from '@/services/socialhub/jobs';
import { apiError, testJob, testModel, withQueryClient } from '@/utils/testing';
import JobProgress, { elapsedText } from './index';

const state = vi.hoisted(() => ({ access: 'admin' as 'admin' | 'operator' }));

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => testModel(name, { access: state.access }),
}));
vi.mock('@/services/socialhub/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/jobs')>()),
  getJob: vi.fn(),
}));

let counter = 0;
const nextId = () => {
  counter += 1;
  return `job-progress-${counter}`;
};

describe('JobProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.access = 'admin';
  });

  it('shows a spinner with the message while running at 0%', async () => {
    const id = nextId();
    vi.mocked(getJob).mockResolvedValue(
      testJob({ id, progress: 0, message: 'Waiting for a worker' }),
    );
    const screen = await render(
      withQueryClient(<JobProgress jobId={id} title="AI test" />),
    );
    await expect
      .element(screen.getByText('Waiting for a worker'))
      .toBeVisible();
    await expect
      .element(screen.getByText('Running', { exact: true }))
      .toBeVisible();
    expect(screen.container.querySelector('.ant-spin')).not.toBeNull();
    expect(screen.container.querySelector('.ant-progress')).toBeNull();
  });

  it('shows the progress bar and message once the job reports progress', async () => {
    const id = nextId();
    vi.mocked(getJob).mockResolvedValue(
      testJob({ id, progress: 60, message: 'Rendering frame 3 of 5' }),
    );
    const screen = await render(
      withQueryClient(<JobProgress jobId={id} variant="inline" />),
    );
    await expect
      .element(screen.getByText('Rendering frame 3 of 5'))
      .toBeVisible();
    await expect.element(screen.getByLabelText('Progress')).toBeInTheDocument();
  });

  it('shows the error text, the detail for admins, and "Try again"', async () => {
    const id = nextId();
    const onRetry = vi.fn();
    vi.mocked(getJob).mockResolvedValue(
      testJob({
        id,
        status: 'failed',
        progress: 40,
        error_code: 'timeout',
        error_detail: 'The task took longer than 15 minutes.',
      }),
    );
    const screen = await render(
      withQueryClient(<JobProgress jobId={id} onRetry={onRetry} />),
    );
    await expect
      .element(
        screen.getByText('This task took too long and was stopped. Try again.'),
      )
      .toBeVisible();
    await expect
      .element(screen.getByText('The task took longer than 15 minutes.'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Try again' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('hides the error detail from operators', async () => {
    state.access = 'operator';
    const id = nextId();
    vi.mocked(getJob).mockResolvedValue(
      testJob({
        id,
        status: 'failed',
        error_code: 'timeout',
        error_detail: 'Secret-ish detail',
      }),
    );
    const screen = await render(withQueryClient(<JobProgress jobId={id} />));
    await expect
      .element(
        screen.getByText('This task took too long and was stopped. Try again.'),
      )
      .toBeVisible();
    expect(screen.container.textContent).not.toContain('Secret-ish detail');
  });

  it('says when the task no longer exists', async () => {
    const id = nextId();
    vi.mocked(getJob).mockRejectedValue(apiError(404, { code: 'not_found' }));
    const screen = await render(withQueryClient(<JobProgress jobId={id} />));
    await expect
      .element(screen.getByText('This task no longer exists.'))
      .toBeVisible();
  });

  it('renders nothing without a job', async () => {
    const screen = await render(withQueryClient(<JobProgress job={null} />));
    expect(screen.container.textContent).toBe('');
  });
});

describe('elapsedText', () => {
  it('says how long the job has been running', async () => {
    const dayjs = (await import('dayjs')).default;
    const now = dayjs('2026-11-25T10:12:30Z');
    expect(
      elapsedText(
        {
          started_at: '2026-11-25T10:10:00Z',
          created_at: '2026-11-25T10:09:00Z',
        },
        now,
      ),
    ).toBe('Running for 2 min');
    expect(
      elapsedText(
        {
          started_at: '2026-11-25T10:12:10Z',
          created_at: '2026-11-25T10:12:00Z',
        },
        now,
      ),
    ).toBe('Running for less than a minute');
    expect(
      elapsedText(
        { started_at: null, created_at: '2026-11-25T10:07:00Z' },
        now,
      ),
    ).toBe('Waiting for 5 min');
  });
});
