/**
 * Script tab constants: fallback registry tables (E05-S01 "Script rules" and "Frame templates"),
 * display labels and panel copy. The fallbacks are used only while `GET /formats/` does not
 * return `script_rules` / `frame_templates`, so the editor still shows counters.
 */
import type { ItemStatus } from '@/services/socialhub/content';
import type {
  Format,
  FrameTemplate,
  FrameTemplateKey,
  ScriptRule,
  ShotType,
} from '@/services/socialhub/formats';
import type { Transition } from '@/services/socialhub/scripts';

export const FALLBACK_SCRIPT_RULES: ScriptRule[] = [
  {
    format: 'feed_post',
    media_kind: 'image',
    production_mode: 'design',
    shots: { min: 1, max: 1 },
    frames: { min: 1, max: 1 },
    duration_seconds: { min: 0, max: 0 },
    frame_duration_seconds: { min: 0, max: 0 },
    allowed_shot_types: ['graphic'],
    frame_per_shot_required: true,
    last_frame_cta: false,
  },
  {
    format: 'story',
    media_kind: 'image',
    production_mode: 'design',
    shots: { min: 1, max: 1 },
    frames: { min: 1, max: 1 },
    duration_seconds: { min: 0, max: 0 },
    frame_duration_seconds: { min: 0, max: 0 },
    allowed_shot_types: ['graphic'],
    frame_per_shot_required: true,
    last_frame_cta: false,
  },
  {
    format: 'story',
    media_kind: 'video',
    production_mode: 'motion',
    shots: { min: 1, max: 4 },
    frames: { min: 1, max: 4 },
    duration_seconds: { min: 5, max: 60 },
    frame_duration_seconds: { min: 2, max: 15 },
    allowed_shot_types: ['graphic', 'text'],
    frame_per_shot_required: true,
    last_frame_cta: false,
  },
  {
    format: 'story',
    media_kind: 'video',
    production_mode: 'video',
    shots: { min: 1, max: 4 },
    frames: { min: 0, max: 4 },
    duration_seconds: { min: 5, max: 60 },
    frame_duration_seconds: null,
    allowed_shot_types: ['footage', 'graphic', 'text'],
    frame_per_shot_required: false,
    last_frame_cta: false,
  },
  {
    format: 'reel',
    media_kind: 'video',
    production_mode: 'motion',
    shots: { min: 4, max: 8 },
    frames: { min: 4, max: 8 },
    duration_seconds: { min: 15, max: 60 },
    frame_duration_seconds: { min: 2, max: 8 },
    allowed_shot_types: ['graphic', 'text'],
    frame_per_shot_required: true,
    last_frame_cta: true,
  },
  {
    format: 'reel',
    media_kind: 'video',
    production_mode: 'video',
    shots: { min: 3, max: 10 },
    frames: { min: 0, max: 10 },
    duration_seconds: { min: 15, max: 90 },
    frame_duration_seconds: null,
    allowed_shot_types: ['footage', 'graphic', 'text'],
    frame_per_shot_required: false,
    last_frame_cta: false,
  },
];

export const FALLBACK_FRAME_TEMPLATES: FrameTemplate[] = [
  {
    key: 'title',
    label: 'Title',
    purpose: 'Opening card',
    headline: { min: 1, max: 60 },
    body: { min: 0, max: 90 },
    visual_prompt: { required: false, max: 400 },
    body_lines: null,
  },
  {
    key: 'statement',
    label: 'Statement',
    purpose: 'One strong sentence',
    headline: { min: 1, max: 90 },
    body: { min: 0, max: 120 },
    visual_prompt: { required: false, max: 400 },
    body_lines: null,
  },
  {
    key: 'stat',
    label: 'Stat',
    purpose: 'A number and what it means',
    headline: { min: 1, max: 12 },
    body: { min: 1, max: 80 },
    visual_prompt: { required: false, max: 400 },
    body_lines: null,
  },
  {
    key: 'list',
    label: 'List',
    purpose: 'Short points',
    headline: { min: 1, max: 50 },
    body: { min: 3, max: 229 },
    visual_prompt: { required: false, max: 400 },
    body_lines: { min: 2, max: 5, max_chars: 45 },
  },
  {
    key: 'quote',
    label: 'Quote',
    purpose: 'A quotation',
    headline: { min: 1, max: 140 },
    body: { min: 0, max: 40 },
    visual_prompt: { required: false, max: 400 },
    body_lines: null,
  },
  {
    key: 'image_caption',
    label: 'Image + caption',
    purpose: 'A picture with a line of text',
    headline: { min: 1, max: 60 },
    body: { min: 0, max: 100 },
    visual_prompt: { required: true, min: 10, max: 400 },
    body_lines: null,
  },
  {
    key: 'cta',
    label: 'CTA',
    purpose: 'Closing call to action',
    headline: { min: 1, max: 40 },
    body: { min: 0, max: 60 },
    visual_prompt: { required: false, max: 400 },
    body_lines: null,
  },
];

export const TEMPLATE_KEYS: FrameTemplateKey[] = FALLBACK_FRAME_TEMPLATES.map((t) => t.key);

/** Canvas sizes by format, used for the preview box when the registry has not loaded. */
export const FALLBACK_CANVAS: Record<Format, { width: number; height: number }> = {
  feed_post: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  reel: { width: 1080, height: 1920 },
};

export const SHOT_TYPE_LABEL: Record<ShotType, string> = {
  footage: 'Footage',
  graphic: 'Graphic',
  text: 'Text',
};

export const TRANSITIONS: Transition[] = ['cut', 'fade', 'slide'];

export const TRANSITION_LABEL: Record<Transition, string> = {
  cut: 'Cut',
  fade: 'Fade',
  slide: 'Slide',
};

/**
 * E05-S01 rule 24: words that ask the image model for text. English and Persian, matched
 * case-insensitively as substrings of `visual_prompt`.
 */
export const VISUAL_PROMPT_TEXT_WORDS = [
  'text',
  'caption',
  'logo',
  'watermark',
  'letters',
  'lettering',
  'typography',
  'متن',
  'نوشته',
  'کپشن',
  'لوگو',
  'واترمارک',
  'حروف',
];

/** Statuses in which a script can be generated, edited or approved (E05-S01 rule 2, E05-S02 rule 1). */
export const SCRIPT_EDIT_STATUSES: ItemStatus[] = [
  'briefed',
  'scripted',
  'in_production',
  'needs_revision',
];

/** Panel copy that is used in more than one file. */
export const COPY = {
  leave: 'Leave without saving? Your changes will be lost.',
  briefNotApproved: 'The script is written from the approved brief.',
  noScript: 'No script yet. Generate one from the brief.',
  providerNotConfigured:
    'The AI provider is not configured. Ask an admin to check Settings → System.',
  saveFirst: 'Save your changes first',
  fixProblems: 'Fix the listed problems first',
  briefChanged:
    'The brief changed after this script was written. Regenerate or save a new version.',
  fieldsInvalid: 'Some fields are not valid.',
  approved: 'Script approved. Production started.',
  sumOfFrames: "Sum of this shot's frames",
  otherJobFallback: 'Another task is running for this item.',
} as const;

/** E05-S01 "Copy for error codes", for job failures and start errors. */
export function scriptErrorText(code: string | null | undefined, detail?: string | null) {
  switch (code) {
    case 'provider_error':
      return detail === 'refused'
        ? 'The AI service declined this request. Edit the brief or write the script by hand.'
        : 'The AI service did not return a script. Try again in a minute.';
    case 'provider_not_configured':
      return COPY.providerNotConfigured;
    case 'job_in_progress':
      return 'A job is already running for this item.';
    case 'invalid_transition':
      return 'This item is not at a stage where its script can be generated.';
    default:
      return null;
  }
}
