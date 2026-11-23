import { charCount } from './shared';

/** Zero-width non-joiner, common inside Persian words. */
const ZWNJ = '‌';

/**
 * E06-S06 rule 3 as the operator types: a leading `#` is stripped and spaces and the zero-width
 * non-joiner become `_`. The server applies the same rules on save and stays the authority.
 */
export function normalizeHashtag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .replace(new RegExp(`[\\s${ZWNJ}]+`, 'gu'), '_');
}

/** Removes duplicates ignoring case, keeping the first spelling and the order. */
export function dedupeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const key = tag.toLocaleLowerCase();
    if (tag === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

/** Why a hashtag would be refused, in words, or null. */
export function hashtagProblem(tag: string): string | null {
  const length = charCount(tag);
  if (/^\d+$/.test(tag)) return `#${tag} can't be only digits.`;
  if (length < 2 || length > 50) return `#${tag} must be 2 to 50 characters.`;
  if (!/^[\p{L}\p{M}\p{N}_]+$/u.test(tag))
    return `#${tag} can only use letters, digits and underscores.`;
  return null;
}

/** `#tags` typed inside the caption also count toward the hashtag limit (rule 2). */
export function captionTagCount(caption: string): number {
  return caption.match(/#[\p{L}\p{M}\p{N}_]+/gu)?.length ?? 0;
}

/** The text Instagram receives: caption, a blank line, then `#tag #tag` (rule 2, `full_caption`). */
export function fullCaption(caption: string, hashtags: string[]): string {
  if (hashtags.length === 0) return caption;
  const tags = hashtags.map((tag) => `#${tag}`).join(' ');
  return caption ? `${caption}\n\n${tags}` : tags;
}

export function combinedLength(caption: string, hashtags: string[]): number {
  return charCount(fullCaption(caption, hashtags));
}
