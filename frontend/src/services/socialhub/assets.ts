/** Asset library (E06-S01). Uploads are multipart with progress through XMLHttpRequest. */
import {
  API_PREFIX,
  ApiError,
  type ApiErrorBody,
  api,
  type Page,
  readCookie,
} from './http';
import type { UserRef } from './content';

export type AssetKind = 'image' | 'video' | 'audio' | 'document';
export type AssetRole =
  | 'source'
  | 'background'
  | 'clip'
  | 'music'
  | 'final'
  | 'frame'
  | 'cover';
export type UploadRole = 'source' | 'background' | 'clip' | 'music' | 'final';
export type AssetOrigin = 'uploaded' | 'licensed' | 'ai_generated' | 'rendered';
export type RightsStatus = 'cleared' | 'unknown' | 'restricted' | 'expired';

export type Asset = {
  id: number;
  account: number;
  content_item: number | null;
  kind: AssetKind;
  role: AssetRole;
  url: string;
  thumbnail_url: string | null;
  original_filename: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  checksum: string;
  origin: AssetOrigin;
  rights_status: RightsStatus;
  license_note: string;
  source_url: string;
  rights_expires_at: string | null;
  meta: Record<string, any>;
  in_use: boolean;
  duplicate?: boolean;
  created_by: UserRef | null;
  created_at: string;
  updated_at: string;
};

export type AssetUsage = {
  content_item: number;
  title?: string;
  version: number;
  as: string;
};

export type AssetDetail = Asset & { used_by: AssetUsage[] };

export type AssetListParams = {
  account: number;
  /** An item ID, or `'null'` for library assets only. */
  content_item?: number | 'null';
  kind?: AssetKind;
  role?: AssetRole[];
  origin?: AssetOrigin[];
  rights_status?: RightsStatus[];
  in_use?: boolean;
  q?: string;
  ordering?: '-created_at' | 'created_at' | 'bytes' | '-bytes';
  page?: number;
  page_size?: number;
};

export const listAssets = (params: AssetListParams) =>
  api.get<Page<Asset>>('/assets/', params);

export const getAsset = (id: number) => api.get<AssetDetail>(`/assets/${id}/`);

export type AssetRightsChange = {
  role?: UploadRole;
  rights_status?: RightsStatus;
  license_note?: string;
  source_url?: string;
  rights_expires_at?: string | null;
  content_item?: number | null;
};

export const updateAsset = (id: number, body: AssetRightsChange) =>
  api.patch<Asset>(`/assets/${id}/`, body);

export const deleteAsset = (id: number) => api.delete(`/assets/${id}/`);

export type UploadFields = {
  account: number;
  content_item?: number | null;
  role?: UploadRole;
  origin?: 'uploaded' | 'licensed';
  rights_status?: RightsStatus;
  license_note?: string;
  source_url?: string;
  rights_expires_at?: string | null;
};

/**
 * Sends a multipart form and reports upload progress (0–100).
 * Errors become `ApiError` with the API's error contract, like every other call.
 */
export function postMultipart<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_PREFIX}${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    const token = readCookie('csrftoken');
    if (token) xhr.setRequestHeader('X-CSRFToken', token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () =>
      reject(new ApiError(0, { code: 'network_error', message: 'Network unavailable.' }));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.onload = () => {
      const isJson = (xhr.getResponseHeader('Content-Type') ?? '').includes(
        'application/json',
      );
      let data: any = null;
      if (isJson && xhr.responseText) {
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
        return;
      }
      let body: ApiErrorBody;
      if (data?.error) {
        body = data.error;
      } else if (xhr.status === 413) {
        body = { code: 'payload_too_large', message: xhr.statusText };
      } else if ((xhr.status === 502 || xhr.status === 503) && !isJson) {
        body = { code: 'api_restarting', message: xhr.statusText };
      } else {
        body = {
          code: xhr.status >= 500 ? 'server_error' : 'request_error',
          message: xhr.statusText,
        };
      }
      reject(new ApiError(xhr.status, body));
    };
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(form);
  });
}

export function appendFields(form: FormData, fields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    form.append(key, String(value));
  }
}

export function uploadAsset(
  file: File,
  fields: UploadFields,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Asset> {
  const form = new FormData();
  form.append('file', file);
  appendFields(form, fields);
  return postMultipart<Asset>('/assets/', form, onProgress, signal);
}

/** E06-S01 rule 1, used for instant client-side checks before sending. */
export const KIND_RULES: Record<
  AssetKind,
  { extensions: string[]; maxBytes: number; label: string }
> = {
  image: { extensions: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 20 * 1024 ** 2, label: 'Image' },
  video: { extensions: ['mp4', 'mov'], maxBytes: 500 * 1024 ** 2, label: 'Video' },
  audio: { extensions: ['mp3', 'm4a', 'wav'], maxBytes: 30 * 1024 ** 2, label: 'Audio' },
  document: { extensions: ['pdf'], maxBytes: 20 * 1024 ** 2, label: 'Document' },
};

/** Which kinds each upload role accepts (E06-S01 rule 7). */
export const ROLE_KINDS: Record<UploadRole, AssetKind[]> = {
  source: ['image', 'video', 'audio', 'document'],
  background: ['image'],
  clip: ['video'],
  music: ['audio'],
  final: ['image', 'video'],
};

export const ROLE_LABEL: Record<AssetRole, string> = {
  source: 'Source',
  background: 'Background',
  clip: 'Clip',
  music: 'Music',
  final: 'Final asset',
  frame: 'Frame',
  cover: 'Cover',
};

export const ORIGIN_LABEL: Record<AssetOrigin, string> = {
  uploaded: 'Uploaded',
  licensed: 'Licensed',
  ai_generated: 'AI generated',
  rendered: 'Rendered',
};

export const KIND_LABEL: Record<AssetKind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function kindForExtension(name: string): AssetKind | null {
  const ext = extensionOf(name);
  const match = (Object.keys(KIND_RULES) as AssetKind[]).find((kind) =>
    KIND_RULES[kind].extensions.includes(ext),
  );
  return match ?? null;
}

/** Returns the reason a file would be refused, or null when it may be sent. */
export function precheckFile(file: File, role: UploadRole): string | null {
  const kind = kindForExtension(file.name);
  if (!kind) {
    return 'This file type is not supported. Use JPG, PNG, WebP, MP4, MOV, MP3, M4A, WAV or PDF.';
  }
  if (!ROLE_KINDS[role].includes(kind)) {
    return `${KIND_LABEL[kind]} files can't be used as ${ROLE_LABEL[role].toLowerCase()}.`;
  }
  if (file.size === 0) return 'The file is empty.';
  if (file.size > KIND_RULES[kind].maxBytes) {
    return `${KIND_LABEL[kind]} files can be up to ${formatBytes(KIND_RULES[kind].maxBytes)}.`;
  }
  return null;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} min ${rest} s`;
}

// Added for the E06 panel (library, uploader, "Use my own file").

export type ReasonContext = {
  /** "video" or "image": what the item needs. */
  kind?: string;
  /** Plural format name for sentences such as "reels need 9:16". */
  formatPlural?: string;
};

/**
 * Plain-words text for one entry of `error.details.reasons`, which the API sends as
 * `"<code>: <detail>"` (E06-S01 upload rejections, E06-S07 rule 23 registry rejections).
 * Unknown codes keep the server's detail so nothing is lost.
 */
export function reasonText(reason: string, context: ReasonContext = {}): string {
  const colon = reason.indexOf(':');
  const code = (colon >= 0 ? reason.slice(0, colon) : reason).trim();
  const detail = colon >= 0 ? reason.slice(colon + 1).trim() : '';
  const kind = context.kind ?? 'file';
  const kindName = kind === 'file' ? 'file' : kind;
  switch (code) {
    case 'wrong_aspect_ratio': {
      const match = detail.match(/^([\d.]+:[\d.]+),\s*expected\s+([\d.]+:[\d.]+)/);
      if (match) {
        return context.formatPlural
          ? `The ${kindName} is ${match[1]}; ${context.formatPlural} need ${match[2]}.`
          : `The ${kindName} is ${match[1]}; it needs to be ${match[2]}.`;
      }
      return `The ${kindName} has the wrong shape${detail ? ` (${detail})` : ''}.`;
    }
    case 'duration_out_of_range': {
      const match = detail.match(/^([\d.]+)\s*s,\s*allowed\s+(.+)$/);
      if (match) return `The video is ${match[1]} s long; it must be ${match[2]}.`;
      return `The video is too short or too long${detail ? ` (${detail})` : ''}.`;
    }
    case 'duration_too_long':
      return `The file is too long${detail ? ` (${detail})` : ''}.`;
    case 'duration_too_short':
      return `The file is too short${detail ? ` (${detail})` : ''}.`;
    case 'resolution_too_low':
    case 'dimensions_too_small':
      return `The ${kindName} is too small${detail ? ` (${detail})` : ''}.`;
    case 'dimensions_too_large':
      return `The ${kindName} is too large${detail ? ` (${detail})` : ''}.`;
    case 'wrong_media_kind':
      return context.kind
        ? `This needs ${context.kind === 'image' ? 'an image' : 'a video'}${detail ? `; the file is ${detail}` : ''}.`
        : `The file is the wrong kind of media${detail ? ` (${detail})` : ''}.`;
    case 'unreadable_media':
    case 'unreadable':
    case 'broken_file':
      return 'The file could not be read. It may be damaged.';
    case 'unsupported_type':
    case 'unknown_type':
      return 'This file type is not supported.';
    case 'extension_mismatch':
      return "The file's extension does not match its content.";
    case 'no_video_stream':
      return 'The file has no video in it.';
    default: {
      const words = code.replace(/_/g, ' ');
      const sentence = words.charAt(0).toUpperCase() + words.slice(1);
      return detail ? `${sentence}: ${detail}.` : `${sentence}.`;
    }
  }
}

/** The reasons of a `400 unsupported_media` error, in plain words. */
export function rejectionReasons(
  details: Record<string, any> | undefined,
  context?: ReasonContext,
): string[] {
  const reasons = details?.reasons;
  if (!Array.isArray(reasons)) return [];
  return reasons.map((reason) => reasonText(String(reason), context));
}
