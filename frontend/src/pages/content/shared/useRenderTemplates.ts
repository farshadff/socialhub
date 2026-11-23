import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Format, FrameTemplateKey } from '@/services/socialhub/formats';
import {
  listRenderTemplates,
  type RenderTemplate,
} from '@/services/socialhub/production';

/**
 * Render templates (E06-S02 `GET /render-templates/`), cached for the session per format.
 * Templates change only with a deployment, so the list is never refetched in the background.
 */
export function useRenderTemplates(format?: Format | null) {
  const query = useQuery({
    queryKey: ['render-templates', format ?? 'all'],
    queryFn: async () =>
      (await listRenderTemplates(format ?? undefined)).results,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const templates: RenderTemplate[] = query.data ?? [];
  const byKey = useMemo(() => {
    const map = new Map<FrameTemplateKey, RenderTemplate>();
    for (const template of templates) map.set(template.key, template);
    return map;
  }, [templates]);
  return {
    templates,
    byKey,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export default useRenderTemplates;
