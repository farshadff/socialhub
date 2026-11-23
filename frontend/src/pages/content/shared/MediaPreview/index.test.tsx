import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import {
  formatsResponse,
  withQueryClient,
} from '@/pages/content/workspace/tabs/production/testFixtures';
import { getFormats } from '@/services/socialhub/formats';
import MediaPreview, { factsText, safeAreaBands } from './index';

vi.mock('@/services/socialhub/formats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/formats')>()),
  getFormats: vi.fn(),
}));

const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

const image = { url: PIXEL, kind: 'image', width: 1080, height: 1920 };
const video = {
  url: 'data:video/mp4;base64,AAAA',
  kind: 'video',
  width: 1080,
  height: 1920,
  duration_ms: 20000,
  bytes: 5893120,
  rights_status: 'cleared' as const,
};

const frameOf = (screen: {
  getByTestId: (id: string) => { element: () => Element };
}) => screen.getByTestId('media-frame').element() as HTMLElement;

describe('MediaPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFormats).mockResolvedValue(formatsResponse);
  });

  it('keeps the format aspect ratio from the registry and fits the maximum height', async () => {
    const screen = await render(
      withQueryClient(
        <MediaPreview
          asset={image}
          format="reel"
          mediaKind="video"
          alt="Frame text"
        />,
      ),
    );
    await vi.waitFor(() =>
      expect(frameOf(screen).style.aspectRatio).toBe('1080 / 1920'),
    );
    const box = frameOf(screen).getBoundingClientRect();
    expect(box.height).toBeLessThanOrEqual(561);
    expect(box.width / box.height).toBeCloseTo(1080 / 1920, 2);
  });

  it('uses the 4:5 canvas for a feed post', async () => {
    const screen = await render(
      withQueryClient(
        <MediaPreview asset={image} format="feed_post" alt="Post" />,
      ),
    );
    await vi.waitFor(() =>
      expect(frameOf(screen).style.aspectRatio).toBe('1080 / 1350'),
    );
  });

  it.each([560, 280])(
    'draws the safe-area bands from the registry at %i px',
    async (maxHeight) => {
      const screen = await render(
        withQueryClient(
          <MediaPreview
            asset={image}
            format="reel"
            mediaKind="video"
            alt="Frame"
            maxHeight={maxHeight}
          />,
        ),
      );
      await expect
        .element(screen.getByTestId('safe-area'))
        .not.toBeInTheDocument();
      await screen.getByLabelText('Safe area').click();
      await expect.element(screen.getByTestId('safe-area')).toBeInTheDocument();
      const frame = frameOf(screen).getBoundingClientRect();
      const top = screen.container.querySelector(
        '[data-band="top"]',
      ) as HTMLElement;
      const bottom = screen.container.querySelector(
        '[data-band="bottom"]',
      ) as HTMLElement;
      const right = screen.container.querySelector(
        '[data-band="right"]',
      ) as HTMLElement;
      expect(top.getBoundingClientRect().height / frame.height).toBeCloseTo(
        220 / 1920,
        2,
      );
      expect(bottom.getBoundingClientRect().height / frame.height).toBeCloseTo(
        420 / 1920,
        2,
      );
      expect(right.getBoundingClientRect().width / frame.width).toBeCloseTo(
        120 / 1080,
        2,
      );
    },
  );

  it('computes the bands in percentages', () => {
    const bands = safeAreaBands(
      { top: 220, right: 120, bottom: 420, left: 0 },
      1080,
      1920,
    );
    expect(bands.top.height).toBe(`${(220 / 1920) * 100}%`);
    expect(bands.right.width).toBe(`${(120 / 1080) * 100}%`);
    expect(bands.outline).toEqual({
      top: `${(220 / 1920) * 100}%`,
      bottom: `${(420 / 1920) * 100}%`,
      left: '0%',
      right: `${(120 / 1080) * 100}%`,
    });
  });

  it('shows the cover image in Cover mode for a reel', async () => {
    const screen = await render(
      withQueryClient(
        <MediaPreview
          asset={video}
          format="reel"
          cover={{ url: PIXEL, kind: 'image' }}
          alt="Reel about budgets"
        />,
      ),
    );
    await expect
      .element(screen.getByLabelText('Video preview, 20 seconds'))
      .toBeInTheDocument();
    await screen.getByLabelText('Cover').click();
    await expect
      .element(screen.getByRole('img', { name: 'Reel about budgets' }))
      .toBeInTheDocument();
    expect(screen.container.querySelector('video')).toBeNull();
  });

  it('has no Cover toggle outside reels', async () => {
    const screen = await render(
      withQueryClient(
        <MediaPreview
          asset={image}
          format="feed_post"
          cover={{ url: PIXEL }}
          alt="Post"
        />,
      ),
    );
    await expect
      .element(screen.getByLabelText('Safe area'))
      .toBeInTheDocument();
    await expect
      .element(screen.getByLabelText('Cover'))
      .not.toBeInTheDocument();
  });

  it.each([
    ['rendering', 'Rendering…'],
    ['failed', 'Render failed'],
  ] as const)('shows the %s overlay', async (state, text) => {
    const screen = await render(
      withQueryClient(
        <MediaPreview asset={image} format="reel" state={state} />,
      ),
    );
    await expect.element(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows the empty state without an asset', async () => {
    const screen = await render(
      withQueryClient(<MediaPreview asset={null} format="reel" />),
    );
    await expect
      .element(screen.getByText('Nothing rendered yet'))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole('img', { name: 'Nothing rendered yet' }))
      .toBeInTheDocument();
  });

  it('gives images role="img" with the alt text and lists the file facts', async () => {
    const screen = await render(
      withQueryClient(
        <MediaPreview
          asset={{ ...image, bytes: 5893120, rights_status: 'cleared' }}
          format="reel"
          alt="سه نشانه"
          usesAiGenerated
        />,
      ),
    );
    await expect
      .element(screen.getByRole('img', { name: 'سه نشانه' }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText('1080 × 1920 · 5.6 MB'))
      .toBeInTheDocument();
    await expect.element(screen.getByText('Cleared')).toBeInTheDocument();
    await expect
      .element(screen.getByText('AI-generated content'))
      .toBeInTheDocument();
  });

  it('formats facts', () => {
    expect(factsText(video)).toBe('1080 × 1920 · 20 s · 5.6 MB');
  });

  it('reports an expired URL once', async () => {
    const onUrlExpired = vi.fn();
    await render(
      withQueryClient(
        <MediaPreview
          asset={{ url: 'http://127.0.0.1:9/missing.png', kind: 'image' }}
          format="reel"
          onUrlExpired={onUrlExpired}
        />,
      ),
    );
    await vi.waitFor(() => expect(onUrlExpired).toHaveBeenCalledTimes(1));
  });
});
