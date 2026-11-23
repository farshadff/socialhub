import { message, notification } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { getJob } from '@/services/socialhub/jobs';
import { apiError, testJob, withQueryClient } from '@/utils/testing';
import JobButton from './index';

vi.mock('@/services/socialhub/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/jobs')>()),
  getJob: vi.fn(),
}));

let counter = 0;
const nextId = () => {
  counter += 1;
  return `job-button-${counter}`;
};

const running = (id: string, overrides = {}) =>
  testJob({
    id,
    kind: 'research.run',
    status: 'running',
    progress: 40,
    message: 'Collecting Coffee trends (2 of 5)',
    ...overrides,
  });

describe('JobButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('shows the message and progress while running, then the success message and onDone once (acceptance 18)', async () => {
    const id = nextId();
    const success = vi.spyOn(message, 'success');
    const onDone = vi.fn();
    vi.mocked(getJob)
      .mockResolvedValueOnce(
        running(id, { progress: 60, message: 'Rendering frame 3 of 5' }),
      )
      .mockResolvedValue(
        running(id, { status: 'succeeded', progress: 100, message: 'Done' }),
      );
    const start = vi
      .fn()
      .mockResolvedValue({
        job: running(id, { status: 'queued', progress: 0, message: '' }),
      });
    const screen = await render(
      withQueryClient(
        <JobButton
          start={start}
          onDone={onDone}
          successMessage="Rendered"
          kinds={['research.run']}
        >
          Render
        </JobButton>,
      ),
    );
    await screen.getByRole('button', { name: 'Render' }).click();
    await expect
      .element(
        screen.getByRole('button', { name: /Rendering frame 3 of 5 · 60%/ }),
      )
      .toBeDisabled();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), {
      timeout: 6000,
    });
    expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('Rendered');
    expect(start).toHaveBeenCalledTimes(1);
    await expect
      .element(screen.getByRole('button', { name: 'Render' }))
      .toBeEnabled();
  });

  it('shows a failure notification with the reference and becomes clickable again', async () => {
    const id = nextId();
    const error = vi.spyOn(notification, 'error');
    const onFailed = vi.fn();
    vi.mocked(getJob).mockResolvedValue(
      running(id, { status: 'failed', error_code: 'stale_job' }),
    );
    const screen = await render(
      withQueryClient(
        <JobButton
          start={() =>
            Promise.resolve({
              job: running(id, { status: 'queued', progress: 0 }),
            })
          }
          onFailed={onFailed}
        >
          Run research
        </JobButton>,
      ),
    );
    await screen.getByRole('button', { name: 'Run research' }).click();
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
    expect(error).toHaveBeenCalledTimes(1);
    const args = error.mock.calls[0][0];
    expect(args.title).toBe('Run research failed');
    const description = await render(<div>{args.description}</div>);
    await expect
      .element(
        description.getByText(
          'This task stopped responding and was ended. Try again.',
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(description.getByText(`Reference: ${id}`))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: 'Run research' }))
      .toBeEnabled();
  });

  it('adopts the running job from a 409 job_in_progress instead of showing an error (acceptance 20)', async () => {
    const id = nextId();
    const info = vi.spyOn(message, 'info');
    const error = vi.spyOn(notification, 'error');
    const onStarted = vi.fn();
    vi.mocked(getJob).mockResolvedValue(running(id));
    const start = vi
      .fn()
      .mockRejectedValue(
        apiError(409, {
          code: 'job_in_progress',
          details: { job: running(id) },
        }),
      );
    const screen = await render(
      withQueryClient(
        <JobButton
          start={start}
          onStarted={onStarted}
          runningReason="Research is running."
        >
          Run research
        </JobButton>,
      ),
    );
    await screen.getByRole('button', { name: 'Run research' }).click();
    await vi.waitFor(() =>
      expect(info).toHaveBeenCalledWith(
        'Already running. Showing its progress.',
      ),
    );
    expect(error).not.toHaveBeenCalled();
    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ id }));
    await expect
      .element(
        screen.getByRole('button', {
          name: /Collecting Coffee trends \(2 of 5\) · 40%/,
        }),
      )
      .toBeDisabled();
  });

  it('follows an active job given on mount without a click (acceptance 19)', async () => {
    const id = nextId();
    vi.mocked(getJob).mockResolvedValue(running(id));
    const start = vi.fn();
    const screen = await render(
      withQueryClient(
        <JobButton
          start={start}
          kinds={['research.run']}
          activeJob={{
            id,
            kind: 'research.run',
            status: 'running',
            progress: 40,
            message: '',
          }}
        >
          Run research
        </JobButton>,
      ),
    );
    await expect
      .element(
        screen.getByRole('button', {
          name: /Collecting Coffee trends \(2 of 5\) · 40%/,
        }),
      )
      .toBeDisabled();
    expect(start).not.toHaveBeenCalled();
    expect(getJob).toHaveBeenCalledWith(id);
  });

  it('is disabled while a job of another kind runs', async () => {
    const screen = await render(
      withQueryClient(
        <JobButton
          start={vi.fn()}
          kinds={['production.render']}
          activeJob={{
            id: nextId(),
            kind: 'qc.run',
            status: 'running',
            progress: 10,
            message: '',
          }}
        >
          Render
        </JobButton>,
      ),
    );
    await expect
      .element(screen.getByRole('button', { name: 'Render' }))
      .toBeDisabled();
    expect(getJob).not.toHaveBeenCalled();
  });

  it('asks for confirmation first when `confirm` is given', async () => {
    const start = vi.fn().mockResolvedValue({ job: running(nextId()) });
    vi.mocked(getJob).mockResolvedValue(running('unused'));
    const screen = await render(
      withQueryClient(
        <JobButton
          start={start}
          confirm={{ title: 'Run the AI test?', okText: 'Run test' }}
        >
          Run AI test
        </JobButton>,
      ),
    );
    await screen.getByRole('button', { name: 'Run AI test' }).click();
    expect(start).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Run test' }).click();
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });

  it('lets the caller handle a start error', async () => {
    const error = vi.spyOn(notification, 'error');
    const onStartError = vi.fn().mockReturnValue(true);
    const failure = apiError(400, { code: 'validation_error' });
    const screen = await render(
      withQueryClient(
        <JobButton
          start={() => Promise.reject(failure)}
          onStartError={onStartError}
        >
          Run research
        </JobButton>,
      ),
    );
    await screen.getByRole('button', { name: 'Run research' }).click();
    await vi.waitFor(() => expect(onStartError).toHaveBeenCalledWith(failure));
    expect(error).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole('button', { name: 'Run research' }))
      .toBeEnabled();
  });

  it('shows the default error notification for other start errors', async () => {
    const error = vi.spyOn(notification, 'error');
    const screen = await render(
      withQueryClient(
        <JobButton
          start={() =>
            Promise.reject(apiError(503, { code: 'provider_not_configured' }))
          }
        >
          Run AI test
        </JobButton>,
      ),
    );
    await screen.getByRole('button', { name: 'Run AI test' }).click();
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error.mock.calls[0][0].title).toBe(
      "A required integration isn't set up. Ask an admin to check Settings → System.",
    );
  });
});
