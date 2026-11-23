import type { TemplateField } from '@/services/socialhub/production';
import { charCount } from './shared';

/** Points of a `list` body: one per line, blank lines ignored. */
export function listPoints(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** The template rule a headline breaks, in words, or null (E06-S07 rule 18). */
export function headlineProblem(
  field: TemplateField | undefined,
  text: string,
): string | null {
  if (!field) return null;
  if (field.required && text.trim() === '')
    return 'This template needs a headline.';
  if (charCount(text) > field.max_chars)
    return `Up to ${field.max_chars} characters for this template.`;
  return null;
}

/** The template rule a body breaks, in words, or null (including the `list` points rule). */
export function bodyProblem(
  field: TemplateField | undefined,
  text: string,
): string | null {
  if (!field) return null;
  const empty = text.trim() === '';
  if (field.required && empty) return 'This template needs a body.';
  if (field.items && !empty) {
    const points = listPoints(text);
    if (points.length < field.items.min || points.length > field.items.max) {
      return `Write ${field.items.min} to ${field.items.max} points, one per line.`;
    }
    if (
      points.some(
        (point) =>
          charCount(point) >
          (field.items?.max_chars ?? Number.POSITIVE_INFINITY),
      )
    ) {
      return `Each point can be up to ${field.items.max_chars} characters.`;
    }
  }
  if (charCount(text) > field.max_chars)
    return `Up to ${field.max_chars} characters for this template.`;
  return null;
}
