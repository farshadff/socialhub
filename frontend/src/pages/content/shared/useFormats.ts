import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  FORMAT_FALLBACK_LABEL,
  type Format,
  type FormatSpec,
  type FormatsResponse,
  type FrameTemplate,
  type FrameTemplateKey,
  getFormats,
  type MediaKind,
  MODE_FALLBACK_LABEL,
  type ProductionMode,
  type Role,
  ROLE_FALLBACK_LABEL,
  type RoleInfo,
  type ScriptRule,
} from '@/services/socialhub/formats';

export const FORMATS_QUERY_KEY = ['formats'] as const;

/**
 * The format registry (E04-S01), fetched once per browser session and shared by every
 * component. Helpers never throw: an unknown combination returns `undefined` and labels fall
 * back to built-in names so a failed load only hides counters.
 *
 * Uses TanStack Query (the panel's data convention, E00-S02 rule 25) with an infinite stale time
 * instead of Umi's `useRequest`; the effect is the same single request.
 */
export function useFormats() {
  const query = useQuery({
    queryKey: FORMATS_QUERY_KEY,
    queryFn: getFormats,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const data: FormatsResponse | undefined = query.data;

  const getSpec = useCallback(
    (format: Format, mediaKind: MediaKind): FormatSpec | undefined =>
      data?.specs.find((s) => s.format === format && s.media_kind === mediaKind),
    [data],
  );

  const modesFor = useCallback(
    (format: Format, mediaKind: MediaKind): ProductionMode[] =>
      getSpec(format, mediaKind)?.production_modes ?? [],
    [getSpec],
  );

  const formatLabel = useCallback(
    (format: Format, mediaKind?: MediaKind): string => {
      if (mediaKind) {
        const spec = getSpec(format, mediaKind);
        if (spec) return spec.label;
      }
      const info = data?.formats.find((f) => f.format === format);
      return info?.label ?? FORMAT_FALLBACK_LABEL[format] ?? String(format);
    },
    [data, getSpec],
  );

  const modeLabel = useCallback(
    (mode: ProductionMode): string =>
      data?.production_modes.find((m) => m.key === mode)?.label ??
      MODE_FALLBACK_LABEL[mode] ??
      String(mode),
    [data],
  );

  const roleInfo = useCallback(
    (role: Role): RoleInfo | undefined => data?.roles?.find((r) => r.key === role),
    [data],
  );

  const roleLabel = useCallback(
    (role: Role | null | undefined): string =>
      role ? (roleInfo(role)?.label ?? ROLE_FALLBACK_LABEL[role] ?? String(role)) : 'Not set',
    [roleInfo],
  );

  const scriptRule = useCallback(
    (format: Format, mediaKind: MediaKind, mode: ProductionMode): ScriptRule | undefined =>
      data?.script_rules?.find(
        (r) => r.format === format && r.media_kind === mediaKind && r.production_mode === mode,
      ),
    [data],
  );

  const frameTemplate = useCallback(
    (key: FrameTemplateKey): FrameTemplate | undefined =>
      data?.frame_templates?.find((t) => t.key === key),
    [data],
  );

  return {
    data,
    loading: query.isLoading,
    error: query.error,
    getSpec,
    modesFor,
    formatLabel,
    modeLabel,
    roleInfo,
    roleLabel,
    scriptRule,
    frameTemplate,
  };
}

export default useFormats;
