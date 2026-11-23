import type { FormInstance } from 'antd';
import { type ApiError, isApiError } from '@/services/socialhub/http';
import { fieldErrorText } from './errorText';

/** `goals.0.target_value` → `['goals', 0, 'target_value']`. */
export function pathToName(path: string): (string | number)[] {
  return path
    .split('.')
    .filter((segment) => segment !== '')
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

/**
 * Puts API field errors on matching form fields (E00-S02 rule 33).
 * `overrides` lets a caller replace the text for one path/code pair.
 * Returns the messages whose path matched no form field, for an Alert above the form.
 */
export function applyFieldErrors(
  form: FormInstance,
  error: unknown,
  overrides?: (field: ApiError['fields'][number]) => string | undefined,
): string[] {
  if (!isApiError(error)) return [];
  const known = new Set(
    form.getFieldsError().map((entry) => JSON.stringify(entry.name)),
  );
  const byName = new Map<
    string,
    { name: (string | number)[]; errors: string[] }
  >();
  const unmatched: string[] = [];

  for (const field of error.fields) {
    const text = overrides?.(field) ?? fieldErrorText(field);
    const name = pathToName(field.path);
    // An indexed list error (`hooks.2`) is shown on the list field when the item has no field.
    let key = JSON.stringify(name);
    if (!known.has(key) && typeof name[name.length - 1] === 'number') {
      const parent = name.slice(0, -1);
      if (known.has(JSON.stringify(parent))) key = JSON.stringify(parent);
    }
    if (known.has(key)) {
      const entry = byName.get(key) ?? {
        name: JSON.parse(key),
        errors: [] as string[],
      };
      entry.errors.push(text);
      byName.set(key, entry);
    } else {
      unmatched.push(text);
    }
  }

  form.setFields(
    Array.from(byName.values()).map(({ name, errors }) => ({ name, errors })),
  );
  return unmatched;
}
