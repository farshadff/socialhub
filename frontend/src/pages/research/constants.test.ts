import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatMetrics,
  limitReachedText,
  planLabel,
  runFailureText,
  sourceStatusText,
  topicActions,
  undoSteps,
} from './constants';

describe('research panel helpers', () => {
  it.each([
    ['error:timeout', 'The source did not respond in time.'],
    ['error:http_503', 'The source answered with HTTP 503.'],
    ['error:invalid_feed', 'This address is not a readable RSS or Atom feed.'],
    ['error:blocked_url', 'This address cannot be fetched.'],
    [
      'error:provider_error',
      'The provider failed. It will be tried again on the next run.',
    ],
    [
      'error:transient',
      'The provider failed. It will be tried again on the next run.',
    ],
    ['error:refused', 'The AI declined this search. Rephrase the query.'],
    ['error:provider_not_configured', 'The AI provider is not configured.'],
  ])('tooltip for %s', (status, text) => {
    expect(sourceStatusText(status)).toBe(text);
  });

  it('has no tooltip for ok, empty or never run', () => {
    expect(sourceStatusText('ok')).toBeNull();
    expect(sourceStatusText('empty')).toBeNull();
    expect(sourceStatusText(null)).toBeNull();
  });

  it('formats metrics with thousands separators', () => {
    expect(formatMetrics({ likes: 9200, comments: 310, views: 180000 })).toBe(
      '9,200 likes · 310 comments · 180,000 views',
    );
    expect(formatMetrics({})).toBeNull();
  });

  it('formats run duration', () => {
    expect(formatDuration('2026-11-22T09:20:01Z', '2026-11-22T09:24:37Z')).toBe(
      '4 min 36 s',
    );
    expect(formatDuration('2026-11-22T09:20:01Z', '2026-11-22T09:20:09Z')).toBe(
      '8 s',
    );
    expect(formatDuration('2026-11-22T09:20:01Z', null)).toBe('—');
  });

  it('explains run failures by error code', () => {
    expect(runFailureText('all_sources_failed')).toBe(
      'No source could be read.',
    );
    expect(runFailureText('stale_run')).toBe('The run stopped unexpectedly.');
  });

  it('offers status actions per E02-S05 rule 12', () => {
    expect(topicActions('new').map((a) => a.label)).toEqual([
      'Shortlist',
      'Dismiss',
    ]);
    expect(topicActions('shortlisted').map((a) => a.label)).toEqual([
      'Remove from shortlist',
      'Dismiss',
    ]);
    expect(topicActions('dismissed').map((a) => a.label)).toEqual(['Restore']);
    expect(topicActions('used')).toEqual([]);
  });

  it('undoes through allowed transitions only', () => {
    expect(undoSteps('new', 'shortlisted')).toEqual(['new']);
    expect(undoSteps('dismissed', 'new')).toEqual(['dismissed']);
    expect(undoSteps('shortlisted', 'dismissed')).toEqual([
      'new',
      'shortlisted',
    ]);
  });

  it('labels plans and limits', () => {
    expect(planLabel({ week_start: '2026-11-28' })).toBe('Week of 28 Nov');
    expect(limitReachedText('web_search')).toBe(
      'You can have at most 8 active web search sources. Deactivate one first.',
    );
  });
});
