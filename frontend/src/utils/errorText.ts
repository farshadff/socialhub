import { notification } from 'antd';
import { isApiError } from '@/services/socialhub/http';

/** English text for every API error code (E00-S02 rule 31). */
export const ERROR_TEXT: Record<string, string> = {
  validation_error: 'Some fields need attention.',
  invalid_credentials: 'Wrong username or password.',
  authentication_required: 'Your session ended. Sign in again.',
  permission_denied: "You don't have permission to do this.",
  not_found: "We couldn't find that. It may have been removed.",
  method_not_allowed: "That action isn't supported here.",
  rate_limited: 'Too many requests. Wait a moment and try again.',
  state_conflict:
    "This changed while you were working. We've reloaded the latest version.",
  invalid_transition: "That action isn't available in the current status.",
  job_in_progress:
    'Something is already running for this item. Wait for it to finish.',
  version_conflict:
    "A newer version exists. We've loaded it; reapply your change if still needed.",
  payload_too_large: 'That file or request is too large.',
  unsupported_media: "That file type or size isn't supported.",
  provider_not_configured:
    "A required integration isn't set up. Ask an admin to check Settings → System.",
  provider_error: 'An external service failed. Try again in a few minutes.',
  instagram_not_connected:
    "This account isn't connected to Instagram, or its connection needs attention. Check Settings → Accounts → Connection.",
  instagram_permission_missing:
    "Instagram hasn't granted the permission this needs. Connect the account again and allow every permission.",
  insights_unavailable:
    'Instagram insights are unavailable for this account. Enter metrics by hand instead.',
  publishing_disabled: 'Publishing is switched off for this account.',
  service_unavailable:
    'The service is temporarily unavailable. Try again shortly.',
  service_timeout: 'The service took too long to respond. Try again.',
  upstream_error: "A connected service didn't respond. Try again.",
  csrf_failed: 'Your session expired. Reload the page.',
  server_error:
    'Something went wrong on our side. Share the reference with support.',
  request_error: "That request couldn't be processed.",
  // Panel-side codes (DESIGN-SYSTEM.md section 7).
  api_restarting: 'Social Hub is restarting. Try again in a moment.',
  network_error: "Can't reach the server. Check your connection and try again.",
};

/** Job `error_code` texts (E00-S06 and the stories that own job kinds). */
export const JOB_ERROR_TEXT: Record<string, string> = {
  stale_job: 'This task stopped responding and was ended. Try again.',
  timeout: 'This task took too long and was stopped. Try again.',
  enqueue_failed: "The task couldn't be started. Try again in a minute.",
  media_checksum_mismatch: 'A stored file looks damaged. Upload it again.',
  // E02 research.run
  all_sources_failed: 'No source could be read. Check the Sources tab.',
  stale_run: 'The run stopped unexpectedly.',
  // E04 brief.generate_batch
  all_failed: 'No brief could be written. Try again in a few minutes.',
  // E06 production steps
  render_failed: 'A frame could not be rendered. Try again.',
  frames_not_ready: 'Some frames are not rendered yet. Re-render them first.',
  duration_out_of_range: 'The video is too short or too long for this format. Change the frame durations.',
  assembly_failed: 'The video could not be assembled. Try again.',
  output_invalid: "The finished file doesn't meet the format rules. Try again or use your own file.",
  copy_too_long: "The caption and hashtags don't fit the limit. Shorten the caption and try again.",
};

/** Field-level text by `fields[].code` (E00-S02 rule 32, plus codes owned by later stories). */
export const FIELD_ERROR_TEXT: Record<string, string> = {
  // E00-S02 rule 32
  required: 'This is required.',
  blank: "This can't be empty.",
  invalid: "This value isn't valid.",
  min_value: 'This is below the minimum.',
  max_value: 'This is above the maximum.',
  min_length: 'This is too short.',
  max_length: 'This is too long.',
  does_not_exist: "That choice isn't available.",
  unique: 'This is already in use.',
  invalid_choice: "That choice isn't available.",
  // E01 weekly plan
  invalid_week_start: "Plans start on the account's first day of the week.",
  out_of_range: 'Pick a week from this week up to eight weeks ahead.',
  account_archived: 'This account is archived.',
  read_only: "This can't be changed.",
  invalid_combination: "This combination isn't allowed for this metric.",
  duplicate: 'This is a duplicate.',
  outside_week: "Pick a time inside the plan's week.",
  too_soon: 'Pick a time at least 30 minutes from now.',
  exceeds_daily_limit:
    "This goes over the account's daily limit for this format.",
  gap_too_small: 'Too close to another reel or feed post that day.',
  min_gap: 'This time is too close to another feed post or reel.',
  daily_limit: 'This would go over the account’s daily posting limit.',
  slot_unavailable: 'That slot is no longer open for this item.',
  not_available: 'That rework option is not available for this version.',
  checkpoint_not_reached: 'This checkpoint has not been reached yet.',
  checkpoint_passed: 'This checkpoint is too old for a manual reading. Choose a later checkpoint or enter an ad hoc reading.',
  not_applicable: 'This metric does not apply to this format.',
  metrics_required: 'Enter at least one metric.',
  invalid_step: 'Use 5-minute steps.',
  max_slots: 'A plan can have at most 60 slots.',
  no_template: 'Set up the usual week first.',
};

/** Alias used by some stories' notes. */
export const FIELD_TEXT = FIELD_ERROR_TEXT;

/** English text for an error: by `code`, falling back to the API's `message` for unknown codes. */
export function errorText(error: unknown): string {
  if (isApiError(error)) {
    return ERROR_TEXT[error.code] ?? error.message ?? ERROR_TEXT.server_error;
  }
  if (error instanceof Error && error.message) return error.message;
  return ERROR_TEXT.server_error;
}

export function fieldErrorText(field: { code: string; message?: string }) {
  return (
    FIELD_ERROR_TEXT[field.code] ?? field.message ?? FIELD_ERROR_TEXT.invalid
  );
}

type JobLike = { error_code?: string | null; error_detail?: string | null };

export function jobErrorText(job: JobLike): string {
  const code = job.error_code ?? '';
  return (
    JOB_ERROR_TEXT[code] ??
    ERROR_TEXT[code] ??
    job.error_detail ??
    'The task failed.'
  );
}

/**
 * Failure notification for a mutation (E00-S02 rule 34): the code's text and the reference.
 * Used by default for TanStack mutations without their own `onError` (src/utils/queryClient.ts)
 * and by callers that handle errors in place.
 */
export function notifyError(error: unknown, title?: string) {
  const reference = isApiError(error) ? error.request_id : null;
  notification.error({
    title: title ?? errorText(error),
    description: [
      title ? errorText(error) : null,
      reference ? `Reference: ${reference}` : null,
    ]
      .filter(Boolean)
      .join(' '),
  });
}
