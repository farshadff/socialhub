import { message } from 'antd';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { updateTopic } from '@/services/socialhub/research';
import { topicActions } from './constants';
import { apiError } from './testUtils';
import { changeTopicStatus } from './topicStatus';

vi.mock('@/services/socialhub/research', () => ({ updateTopic: vi.fn() }));

async function lastSuccessContent(spy: ReturnType<typeof vi.spyOn>) {
  const config = spy.mock.calls.at(-1)?.[0] as {
    content: React.ReactNode;
    duration: number;
  };
  expect(config.duration).toBe(5);
  return render(<div>{config.content}</div>);
}

describe('topic status actions with Undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateTopic).mockResolvedValue({} as any);
  });

  it('shortlists at once and Undo returns the topic to New', async () => {
    const success = vi.spyOn(message, 'success');
    const onChanged = vi.fn();
    const shortlist = topicActions('new')[0];
    await changeTopicStatus({ id: 58, status: 'new' }, shortlist, onChanged);
    expect(updateTopic).toHaveBeenCalledWith(58, { status: 'shortlisted' });
    expect(onChanged).toHaveBeenCalledTimes(1);

    const screen = await lastSuccessContent(success);
    await expect
      .element(screen.getByText('Topic shortlisted'))
      .toBeInTheDocument();
    await screen.getByRole('button', { name: 'Undo' }).click();
    await vi.waitFor(() =>
      expect(updateTopic).toHaveBeenLastCalledWith(58, { status: 'new' }),
    );
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('undoes dismissing a shortlisted topic through New', async () => {
    const success = vi.spyOn(message, 'success');
    const dismiss = topicActions('shortlisted')[1];
    await changeTopicStatus({ id: 7, status: 'shortlisted' }, dismiss, vi.fn());
    const screen = await lastSuccessContent(success);
    await screen.getByRole('button', { name: 'Undo' }).click();
    await vi.waitFor(() => expect(updateTopic).toHaveBeenCalledTimes(3));
    expect(vi.mocked(updateTopic).mock.calls.map((c) => c[1])).toEqual([
      { status: 'dismissed' },
      { status: 'new' },
      { status: 'shortlisted' },
    ]);
  });

  it('reloads on 409 invalid_transition instead of failing silently', async () => {
    const warning = vi.spyOn(message, 'warning');
    vi.mocked(updateTopic).mockRejectedValue(
      apiError(409, { code: 'invalid_transition' }),
    );
    const onChanged = vi.fn();
    const saved = await changeTopicStatus(
      { id: 1, status: 'new' },
      topicActions('new')[0],
      onChanged,
    );
    expect(saved).toBe(false);
    expect(warning).toHaveBeenCalledWith('This topic changed. Reloading.');
    expect(onChanged).toHaveBeenCalled();
  });
});
