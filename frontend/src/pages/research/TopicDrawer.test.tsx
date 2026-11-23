import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { getTopic, type TrendTopicDetail } from '@/services/socialhub/research';
import TopicDrawer from './TopicDrawer';
import { ACCOUNT, modelFor, withQueryClient } from './testUtils';

vi.mock('@umijs/max', () => ({ useModel: (name: string) => modelFor(name) }));
vi.mock('@/services/socialhub/research', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/research')>()),
  getTopic: vi.fn(),
  updateTopic: vi.fn(),
}));

const topic: TrendTopicDetail = {
  id: 58,
  account: 3,
  plan: null,
  run: 31,
  title: 'بازگشت قهوه دمی به منوی کافه‌ها',
  summary: 'کافه‌ها از افزایش سفارش قهوه دمی خبر می‌دهند.',
  why_now: 'چند رسانه تخصصی به این تغییر پرداخته‌اند.',
  hooks: ['چرا همه دوباره سراغ قهوه دمی رفته‌اند؟'],
  suggested_formats: ['reel'],
  keywords: ['قهوه دمی'],
  evidence_score: 87,
  evidence_breakdown: {
    signal_count: 73,
    source_diversity: 100,
    recency: 89,
    engagement: 92,
  },
  signal_count: 0,
  status: 'new',
  origin: 'ai',
  created_at: '2026-11-22T09:24:30Z',
  updated_at: '2026-11-22T09:24:30Z',
  signals: [],
};

function renderDrawer() {
  return render(
    withQueryClient(
      <TopicDrawer
        topicId={58}
        account={ACCOUNT}
        readOnly={false}
        plans={[]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    ),
  );
}

describe('Topic drawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('labels the save button "Save and shortlist" for a new topic', async () => {
    vi.mocked(getTopic).mockResolvedValue(topic);
    const screen = await renderDrawer();
    await screen.getByRole('button', { name: 'Edit' }).click();
    await expect
      .element(screen.getByRole('button', { name: 'Save and shortlist' }))
      .toBeInTheDocument();
  });

  it('labels it "Save" for a shortlisted topic', async () => {
    vi.mocked(getTopic).mockResolvedValue({ ...topic, status: 'shortlisted' });
    const screen = await renderDrawer();
    await screen.getByRole('button', { name: 'Edit' }).click();
    await expect
      .element(screen.getByRole('button', { name: 'Save', exact: true }))
      .toBeInTheDocument();
  });

  it('shows no edit or status actions for a used topic', async () => {
    vi.mocked(getTopic).mockResolvedValue({ ...topic, status: 'used' });
    const screen = await renderDrawer();
    await expect.element(screen.getByText('Used')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' }).query()).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Shortlist' }).query(),
    ).toBeNull();
  });
});
