/** Shared fixtures for the Script tab tests: the E05-S01 example packages. */
import type { ContentItemDetail } from '@/services/socialhub/content';
import type { FormatsResponse } from '@/services/socialhub/formats';
import type { ScriptPackage, ScriptResource } from '@/services/socialhub/scripts';

export const reelMotionPackage = (): ScriptPackage => ({
  scenario:
    'A quick myth-busting reel that opens on a common belief, shows the number that contradicts it, and closes with a checklist to save.',
  hook: 'Posting every day is not why accounts grow.',
  duration_seconds: 30,
  shots: [
    { index: 1, duration_seconds: 4, type: 'text', description: 'Bold opening statement.', on_screen_text: 'Posting every day is not why accounts grow.', voiceover: '', asset_hint: '' },
    { index: 2, duration_seconds: 6, type: 'graphic', description: 'A single large figure.', on_screen_text: '3× more saves', voiceover: '', asset_hint: '' },
    { index: 3, duration_seconds: 8, type: 'graphic', description: 'Three short points.', on_screen_text: 'One idea per post', voiceover: '', asset_hint: '' },
    { index: 4, duration_seconds: 7, type: 'graphic', description: 'A calm image of a desk.', on_screen_text: 'Plan the week.', voiceover: '', asset_hint: '' },
    { index: 5, duration_seconds: 5, type: 'text', description: 'Closing card with the CTA.', on_screen_text: 'Save this checklist', voiceover: '', asset_hint: '' },
  ],
  frames: [
    { index: 1, shot_index: 1, template: 'title', headline: 'Posting every day is not why accounts grow.', body: '', visual_prompt: '', duration_seconds: 4, transition: 'cut' },
    { index: 2, shot_index: 2, template: 'stat', headline: '3×', body: 'more saves on posts that teach one clear thing', visual_prompt: '', duration_seconds: 6, transition: 'fade' },
    { index: 3, shot_index: 3, template: 'list', headline: 'What matters more', body: 'One idea per post\nA first line that earns the second\nA reason to save it', visual_prompt: '', duration_seconds: 8, transition: 'slide' },
    { index: 4, shot_index: 4, template: 'image_caption', headline: 'Plan the week, not the day.', body: '', visual_prompt: 'Top-down photo of a tidy desk with an open notebook and a pen, soft morning light', duration_seconds: 7, transition: 'fade' },
    { index: 5, shot_index: 5, template: 'cta', headline: 'Save this checklist', body: 'Follow for one tip every week', visual_prompt: '', duration_seconds: 5, transition: 'fade' },
  ],
  design_notes: {
    mood: 'Confident and calm.',
    color_usage: 'Dark background, primary colour for highlights.',
    typography: 'Heading font for headlines.',
    imagery_style: 'Natural light photography.',
    layout: 'Text centred in the safe area.',
    do: ['Keep one idea per frame'],
    dont: ['No busy backgrounds behind text'],
  },
  cta: 'Save this checklist for your next planning session.',
  music_hint: 'Light, mid-tempo instrumental',
});

export const feedPostPackage = (): ScriptPackage => ({
  scenario: 'One clear statement card that names the myth and the better habit.',
  hook: 'Daily posting is not the goal.',
  duration_seconds: 0,
  shots: [
    { index: 1, duration_seconds: 0, type: 'graphic', description: 'Daily posting is not the goal.', on_screen_text: '', voiceover: '', asset_hint: '' },
  ],
  frames: [
    { index: 1, shot_index: 1, template: 'statement', headline: 'Daily posting is not the goal.', body: 'Teach one thing well.', visual_prompt: '', duration_seconds: 0, transition: 'cut' },
  ],
  design_notes: {
    mood: 'Calm.',
    color_usage: '',
    typography: '',
    imagery_style: '',
    layout: 'Centred.',
    do: [],
    dont: [],
  },
  cta: '',
  music_hint: '',
});

export function scriptResource(overrides: Partial<ScriptResource> = {}): ScriptResource {
  return {
    content_item: 42,
    version: 1,
    latest_version: 1,
    approved_version: null,
    status: 'draft',
    origin: 'ai',
    feedback: '',
    brief_version: 1,
    brief_is_current: true,
    ai_run: 311,
    created_by: null,
    created_at: '2026-12-01T08:15:42Z',
    payload: reelMotionPackage(),
    validation: { valid: true, issues: [] },
    actions: { can_generate: true, can_edit: true, can_approve: true },
    ...overrides,
  };
}

export function contentItem(overrides: Partial<ContentItemDetail> = {}): ContentItemDetail {
  return {
    id: 42,
    account: 3,
    title: 'Posting every day',
    format: 'reel',
    media_kind: 'video',
    production_mode: 'motion',
    role: 'educate',
    status: 'briefed',
    hold_reason: '',
    needs_attention: false,
    revision_count: 0,
    plan: null,
    slot: null,
    candidate: null,
    active_job: null,
    thumbnail_url: null,
    publication: null,
    created_at: '2026-11-30T08:00:00Z',
    updated_at: '2026-12-01T08:15:42Z',
    cancelled_reason: '',
    current_brief: {
      id: 7,
      version: 1,
      status: 'approved',
      origin: 'ai',
      role: 'educate',
      key_message: 'Consistency beats frequency.',
      success_metric: 'saves',
      created_at: '2026-11-30T09:00:00Z',
    },
    current_script: null,
    current_version: null,
    latest_check: null,
    open_review_task: null,
    allowed_actions: ['generate_script', 'edit_script', 'approve_script'],
    created_by: null,
    ...overrides,
  };
}

/** `GET /formats/` without `script_rules` / `frame_templates`, so the fallback tables apply. */
export const formatsResponse: FormatsResponse = {
  registry_version: '1',
  formats: [],
  production_modes: [],
  specs: [
    { format: 'reel', media_kind: 'video', width: 1080, height: 1920 },
    { format: 'feed_post', media_kind: 'image', width: 1080, height: 1350 },
  ].map((spec) => ({
    ...spec,
    label: spec.format === 'reel' ? 'Reel' : 'Feed post',
  })) as unknown as FormatsResponse['specs'],
};
