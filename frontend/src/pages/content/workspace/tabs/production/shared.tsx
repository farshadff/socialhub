import { contentFontFamily } from '@root/config/theme';
import { message, Typography } from 'antd';
import React, { createContext, useContext } from 'react';
import type { ContentItemDetail } from '@/services/socialhub/content';
import type { Format } from '@/services/socialhub/formats';
import { isApiError } from '@/services/socialhub/http';
import type { Job, JobSummary } from '@/services/socialhub/jobs';
import {
  type Production,
  type ProductionFrame,
  type ProductionVersionEntry,
  type StepKey,
  type SubmitBlocker,
  startProduction,
  type VersionStatus,
} from '@/services/socialhub/production';
import { useCurrentAccount } from '@/utils/accountRequest';
import { ERROR_TEXT, jobErrorText, notifyError } from '@/utils/errorText';

/** Everything the Production tab's cards share. Built once in `index.tsx`. */
export type ProductionContextValue = {
  item: ContentItemDetail;
  production: Production;
  accountId: number;
  /** Refetches the production resource. */
  refetch: () => Promise<unknown>;
  /** Puts a mutation's response (the production resource) into the cache. */
  setProduction: (next: Production) => void;
  /** Refetches the item in the shell. */
  reload: () => void;
  /** The job running on the item, from the shell's item, a job started here, or the resource. */
  activeJob: JobSummary | null;
  jobRunning: boolean;
  /** Tooltip for actions disabled while a job runs. */
  runningReason: string;
  /**
   * The running job for buttons that adopt jobs they did not start; excludes jobs whose own
   * start button follows them (so one job never shows two success messages).
   */
  adoptableJob: JobSummary | null;
  /**
   * Records a job started on this tab so every card treats the item as busy at once. `owned` is
   * true when the starting component follows the job itself.
   */
  onJobStarted: (job: JobSummary, owned?: boolean) => void;
  /** Called when a job started from this tab ends. */
  onJobEnded: () => void;
  /** Conflict-aware error handling for production mutations. */
  handleError: (error: unknown) => void;
  /** A signed media URL failed to load: refetch once (E06-S07 states). */
  onUrlExpired: () => void;
  layout: '4x5' | '9x16';
  /** False when viewing an older version, or the version is not an editable draft. */
  isCurrentDraft: boolean;
};

export const ProductionContext = createContext<ProductionContextValue | null>(
  null,
);

export function useProductionContext(): ProductionContextValue {
  const value = useContext(ProductionContext);
  if (!value)
    throw new Error('useProductionContext outside the Production tab');
  return value;
}

export const STEP_KEYS: Extract<
  StepKey,
  'backgrounds' | 'frames' | 'assemble' | 'copy'
>[] = ['backgrounds', 'frames', 'assemble', 'copy'];

export const STEP_LABEL: Record<StepKey, string> = {
  prepare: 'Prepare',
  backgrounds: 'Backgrounds',
  frames: 'Frames',
  assemble: 'Assemble',
  copy: 'Copy',
  finish: 'Finish',
};

export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  passed: 'Passed',
  rejected: 'Rejected',
};

/** "Version 3 · Draft", "Version 1 · Draft (replaced)". */
export function versionLabel(
  entry: Pick<ProductionVersionEntry, 'version' | 'status' | 'is_current'>,
): string {
  const replaced =
    entry.status === 'draft' && !entry.is_current ? ' (replaced)' : '';
  return `Version ${entry.version} · ${VERSION_STATUS_LABEL[entry.status]}${replaced}`;
}

/** Submit blockers in words (E06-S07 rule 28) for the Submit button's tooltip. */
export const BLOCKER_TEXT: Record<SubmitBlocker, string> = {
  not_current: 'Switch to the current version first',
  not_draft: 'This version was already submitted',
  not_rendered: 'Render the changed frames first',
  waiting_for_backgrounds: 'Choose an image for every frame that needs one',
  waiting_for_clips: 'Add footage for every shot first',
  caption_missing: 'Write a caption first',
  cover_missing: 'Choose a cover first',
  newer_script: 'Approve the newer script first',
  brief_not_approved: 'Approve the brief first',
};

export function blockerText(code: string): string {
  return BLOCKER_TEXT[code as SubmitBlocker] ?? code.replace(/_/g, ' ');
}

export const PRODUCTION_JOB_KINDS = [
  'production.start',
  'production.render',
  'production.generate_image',
];

/** The tooltip on disabled actions while a job runs (DESIGN-SYSTEM.md section 7). */
export function runningReasonFor(job: JobSummary | null): string {
  if (!job) return '';
  if (!job.kind || PRODUCTION_JOB_KINDS.includes(job.kind))
    return 'Production is running';
  if (job.kind === 'copy.generate') return 'The caption is being written';
  return 'Something is running for this item';
}

export function layoutFor(format: Format): '4x5' | '9x16' {
  return format === 'feed_post' ? '4x5' : '9x16';
}

/** Length in Unicode code points, the way the server counts (E06-S06 test notes). */
export function charCount(text: string | null | undefined): number {
  return text ? Array.from(text).length : 0;
}

/** "20 s", "4.5 s". */
export function seconds(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} s`;
}

/** "2, 3 and 5". */
export function joinNumbers(values: number[]): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

/** Frames that need an image before they can render (`background_required`). */
export function framesNeedingImage(production: Production): number[] {
  const indexes = new Set<number>();
  for (const frame of production.frames) {
    if (frame.warnings.some((w) => w.code === 'background_required'))
      indexes.add(frame.index);
  }
  for (const warning of production.render_warnings) {
    if (warning.code === 'background_required' && warning.frame_index)
      indexes.add(warning.frame_index);
  }
  return Array.from(indexes).sort((a, b) => a - b);
}

/** The step that failed in the last run, if any. */
export function failedStep(
  production: Production,
): { step: StepKey; errorCode: string | null } | null {
  for (const key of [
    'backgrounds',
    'frames',
    'assemble',
    'copy',
    'finish',
  ] as StepKey[]) {
    const step = production.production_steps[key];
    if (step?.status === 'failed')
      return { step: key, errorCode: step.error_code ?? null };
  }
  return null;
}

/** True when the current draft has a failed or waiting step ("Resume production"). */
export function canResume(production: Production): boolean {
  return Object.values(production.production_steps).some(
    (step) => step?.status === 'failed' || step?.status === 'waiting',
  );
}

export function runningStep(production: Production): StepKey | null {
  for (const key of STEP_KEYS) {
    if (production.production_steps[key]?.status === 'running') return key;
  }
  return null;
}

export function frameNeedsRender(frame: ProductionFrame): boolean {
  return frame.state === 'stale' || frame.state === 'failed';
}

/** "Production stopped at assemble: The video could not be assembled. Try again." */
export function stoppedText(step: StepKey, errorCode: string | null): string {
  return `Production stopped at ${STEP_LABEL[step].toLowerCase()}: ${jobErrorText({ error_code: errorCode })}`;
}

export function productionFailureText(job: Job): string {
  return jobErrorText(job);
}

/** Returned by a start wrapper when the server answers `unchanged: true`. */
export class NothingToDo extends Error {
  constructor() {
    super('Production is already up to date.');
    this.name = 'NothingToDo';
  }
}

/**
 * Production mutations: `409 version_conflict` reloads with the section 7 message, `409
 * job_in_progress` follows the running job, anything else is a notification.
 */
export function makeErrorHandler(
  refetch: () => unknown,
  reload: () => unknown,
) {
  return (error: unknown) => {
    if (error instanceof NothingToDo) {
      message.info(error.message);
      return;
    }
    if (isApiError(error) && error.code === 'version_conflict') {
      message.warning('This item changed. Reloading.');
      refetch();
      reload();
      return;
    }
    if (isApiError(error) && error.code === 'job_in_progress') {
      message.info(ERROR_TEXT.job_in_progress);
      refetch();
      reload();
      return;
    }
    notifyError(error);
  };
}

/** Starts production; an `unchanged: true` answer becomes `NothingToDo`. */
export function startJob(itemId: number, restart: boolean) {
  return async (): Promise<{ job: Job }> => {
    const response = await startProduction(itemId, restart);
    if (!response.job) throw new NothingToDo();
    return { job: response.job };
  };
}

/** "42 / 60" under a text field; red when over the limit (DESIGN-SYSTEM.md section 3: colorError). */
export const Counter: React.FC<{
  count: number;
  max: number;
  suffix?: string;
  id?: string;
}> = ({ count, max, suffix, id }) => (
  <Typography.Text
    id={id}
    type={count > max ? 'danger' : 'secondary'}
    aria-live="polite"
  >
    {count.toLocaleString('en')} / {max.toLocaleString('en')}
    {suffix ? ` ${suffix}` : ''}
  </Typography.Text>
);

/** The content font for editable content fields (same stack as `ContentText`). */
export function useContentFont(): string {
  const { account } = useCurrentAccount();
  return contentFontFamily[account?.content_language === 'en' ? 'en' : 'fa'];
}
