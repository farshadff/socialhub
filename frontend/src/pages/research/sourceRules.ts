import type { SourceKind } from '@/services/socialhub/research';

/**
 * Client-side mirror of E02-S01 rule 4, so most mistakes are caught before the request.
 * The server stays the authority.
 */
export function normalizeSourceValue(kind: SourceKind, raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (kind === 'web_search') return trimmed.replace(/\s+/g, ' ');
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i.exec(trimmed);
  if (!match) return trimmed;
  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}${match[3]}`;
}

function isIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.startsWith('[') || host.includes(':');
}

/** Returns an error message, or null when the value is acceptable. */
export function validateSourceValue(
  kind: SourceKind,
  raw: string,
): string | null {
  const value = normalizeSourceValue(kind, raw);
  if (!value)
    return kind === 'web_search'
      ? 'Enter a search query.'
      : 'Enter a feed address.';
  if (kind === 'web_search') {
    if (value.length < 3) return 'Use at least 3 characters.';
    if (value.length > 200) return 'Use at most 200 characters.';
    return null;
  }
  if (value.length > 500) return 'Use at most 500 characters.';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Enter a full address starting with http:// or https://.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Enter a full address starting with http:// or https://.';
  }
  const host = url.hostname.toLowerCase();
  if (!host) return 'Enter a full address starting with http:// or https://.';
  if (host === 'localhost' || isIpLiteral(host)) {
    return 'Use a public web address, not an IP address or localhost.';
  }
  return null;
}

/** Display form used when the label is left empty: the query, or the feed's host. */
export function defaultSourceLabel(kind: SourceKind, raw: string): string {
  const value = normalizeSourceValue(kind, raw);
  if (kind === 'web_search') return value;
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}
