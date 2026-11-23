import type {
  Format,
  SignalKind,
  SignalMetrics,
  SourceKind,
  TopicStatus,
} from '@/services/socialhub/research';

export type TabKey = 'topics' | 'signals' | 'sources' | 'runs';
export const TAB_KEYS: TabKey[] = ['topics', 'signals', 'sources', 'runs'];

export const KIND_LABEL: Record<SignalKind, string> = {
  web_search: 'Web search',
  rss: 'RSS feed',
  manual: 'Manual',
};

export const FORMAT_LABEL: Record<Format, string> = {
  reel: 'Reel',
  story: 'Story',
  feed_post: 'Feed post',
};

export const TOPIC_STATUS_LABEL: Record<TopicStatus, string> = {
  new: 'New',
  shortlisted: 'Shortlisted',
  dismissed: 'Dismissed',
  used: 'Used',
};

export const ACTIVE_LIMIT: Record<SourceKind, number> = {
  web_search: 8,
  rss: 15,
};

export const LIMIT_KIND_TEXT: Record<SourceKind, string> = {
  web_search: 'web search',
  rss: 'RSS feed',
};

export const limitReachedText = (kind: SourceKind) =>
  `You can have at most ${ACTIVE_LIMIT[kind]} active ${LIMIT_KIND_TEXT[kind]} sources. Deactivate one first.`;

/** Tooltip text for a source's `last_status` (E02-S01 Panel). */
export function sourceStatusText(status: string | null): string | null {
  if (!status?.startsWith('error:')) return null;
  const code = status.slice('error:'.length);
  const http = /^http_(\d{3})$/.exec(code);
  if (http) return `The source answered with HTTP ${http[1]}.`;
  switch (code) {
    case 'timeout':
      return 'The source did not respond in time.';
    case 'invalid_feed':
      return 'This address is not a readable RSS or Atom feed.';
    case 'blocked_url':
      return 'This address cannot be fetched.';
    case 'provider_error':
    case 'transient':
      return 'The provider failed. It will be tried again on the next run.';
    case 'refused':
      return 'The AI declined this search. Rephrase the query.';
    case 'provider_not_configured':
      return 'The AI provider is not configured.';
    default:
      return 'The source could not be read.';
  }
}

export const EVIDENCE_LABEL = {
  signal_count: 'Signals',
  source_diversity: 'Source variety',
  recency: 'Freshness',
  engagement: 'Engagement',
} as const;

/** "9,200 likes · 310 comments · 180,000 views", or null when there are no numbers. */
export function formatMetrics(
  metrics: SignalMetrics | null | undefined,
): string | null {
  if (!metrics) return null;
  const parts: string[] = [];
  const fmt = (n: number) => n.toLocaleString('en-US');
  if (typeof metrics.likes === 'number')
    parts.push(`${fmt(metrics.likes)} likes`);
  if (typeof metrics.comments === 'number')
    parts.push(`${fmt(metrics.comments)} comments`);
  if (typeof metrics.views === 'number')
    parts.push(`${fmt(metrics.views)} views`);
  return parts.length ? parts.join(' · ') : null;
}

/** "4 min 36 s" from two ISO timestamps. */
export function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const seconds = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000),
  );
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return `${minutes} min ${rest} s`;
}

/** Text shown above a failed run's sources, by job `error_code` (E02-S05). */
export function runFailureText(code: string | null | undefined): string {
  switch (code) {
    case 'all_sources_failed':
      return 'No source could be read.';
    case 'timeout':
      return 'The run took too long and was stopped.';
    case 'stale_run':
      return 'The run stopped unexpectedly.';
    case 'provider_error':
      return "The AI provider failed while grouping signals. Signals were kept; run again with 'Collect new signals' off.";
    default:
      return 'The run failed.';
  }
}

/** Status actions per topic status (E02-S05 rule 12). */
export type TopicAction = {
  key: string;
  label: string;
  to: Exclude<TopicStatus, 'used'>;
  message: string;
};

export function topicActions(status: TopicStatus): TopicAction[] {
  switch (status) {
    case 'new':
      return [
        {
          key: 'shortlist',
          label: 'Shortlist',
          to: 'shortlisted',
          message: 'Topic shortlisted',
        },
        {
          key: 'dismiss',
          label: 'Dismiss',
          to: 'dismissed',
          message: 'Topic dismissed',
        },
      ];
    case 'shortlisted':
      return [
        {
          key: 'unshortlist',
          label: 'Remove from shortlist',
          to: 'new',
          message: 'Topic removed from shortlist',
        },
        {
          key: 'dismiss',
          label: 'Dismiss',
          to: 'dismissed',
          message: 'Topic dismissed',
        },
      ];
    case 'dismissed':
      return [
        {
          key: 'restore',
          label: 'Restore',
          to: 'new',
          message: 'Topic restored',
        },
      ];
    default:
      return [];
  }
}

/**
 * The status changes that undo `from → to`. A shortlisted topic that was dismissed returns
 * through `new`, because `dismissed → shortlisted` is not an allowed transition (E02-S04 rule 21).
 */
export function undoSteps(
  from: TopicStatus,
  to: TopicStatus,
): Exclude<TopicStatus, 'used'>[] {
  if (from === 'shortlisted' && to === 'dismissed')
    return ['new', 'shortlisted'];
  return [from as Exclude<TopicStatus, 'used'>];
}

export const planLabel = (plan: { week_start: string }) => {
  const d = new Date(`${plan.week_start}T00:00:00Z`);
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `Week of ${d.getUTCDate()} ${month}`;
};
