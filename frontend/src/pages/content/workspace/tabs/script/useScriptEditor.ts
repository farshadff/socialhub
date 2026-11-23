/**
 * Editor state and data layer for the Script tab (E05-S02-FE1): loads the latest script and the
 * registry limits, holds the working package, tracks unsaved changes, and exposes edits that keep
 * indices, `shot_index` and durations consistent. Client issues are shown while editing; the
 * server's `validation` is shown for a saved version.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormats } from '@/pages/content/shared/useFormats';
import type { ValidationIssue } from '@/services/socialhub/briefs';
import { getBrief } from '@/services/socialhub/briefs';
import type { ContentItemDetail } from '@/services/socialhub/content';
import type { FrameTemplateKey, ScriptRule } from '@/services/socialhub/formats';
import { type FieldError, isApiError } from '@/services/socialhub/http';
import {
  approveScript,
  type DesignNotes,
  getScript,
  type ScriptPackage,
  type ScriptResource,
  saveScript,
} from '@/services/socialhub/scripts';
import { useAccountId } from '@/utils/accountRequest';
import { FALLBACK_CANVAS, FALLBACK_FRAME_TEMPLATES, FALLBACK_SCRIPT_RULES } from './constants';
import {
  addFrame as addFrameTo,
  addShot as addShotTo,
  blankFrame,
  blankShot,
  computeIssues,
  deleteFrame as deleteFrameFrom,
  deleteShot as deleteShotFrom,
  derive,
  duplicateFrame as duplicateFrameIn,
  type EditorContext,
  type EditorFrame,
  type EditorPackage,
  type EditorShot,
  emptyPackage,
  fromPayload,
  moveFrame as moveFrameIn,
  moveShot as moveShotIn,
  samePayload,
  stripPayload,
  toPayload,
  updateFrame as updateFrameIn,
  updateShot as updateShotIn,
} from './scriptModel';

export const scriptQueryKey = (accountId: number | null, itemId: number) =>
  [accountId, 'script', itemId] as const;
export const scriptVersionsKey = (accountId: number | null, itemId: number) =>
  [accountId, 'script-versions', itemId] as const;

/** `GET …/script/` answers 404 `no_script` when there is none: that is the empty state. */
export async function fetchScript(itemId: number): Promise<ScriptResource | null> {
  try {
    return await getScript(itemId);
  } catch (error) {
    if (isApiError(error) && error.status === 404 && error.details.reason === 'no_script') {
      return null;
    }
    throw error;
  }
}

function resolveRule(
  found: ScriptRule | undefined,
  item: Pick<ContentItemDetail, 'format' | 'media_kind' | 'production_mode'>,
): ScriptRule {
  return (
    found ??
    FALLBACK_SCRIPT_RULES.find(
      (r) =>
        r.format === item.format &&
        r.media_kind === item.media_kind &&
        r.production_mode === item.production_mode,
    ) ??
    FALLBACK_SCRIPT_RULES.find(
      (r) => r.format === item.format && r.media_kind === item.media_kind,
    ) ??
    FALLBACK_SCRIPT_RULES[4]
  );
}

export type StoryField = 'scenario' | 'hook' | 'cta' | 'music_hint';
export type NoteField = Exclude<keyof DesignNotes, 'do' | 'dont'>;

export function useScriptEditor(item: ContentItemDetail) {
  const accountId = useAccountId();
  const queryClient = useQueryClient();
  const formats = useFormats();
  const key = scriptQueryKey(accountId, item.id);

  const scriptQuery = useQuery({
    queryKey: key,
    queryFn: () => fetchScript(item.id),
    refetchOnWindowFocus: false,
  });

  const briefApproved = item.current_brief?.status === 'approved';
  const briefCtaQuery = useQuery({
    queryKey: [accountId, 'script-brief-cta', item.id, item.current_brief?.version],
    queryFn: async () => {
      try {
        const resource = await getBrief(item.id);
        return resource.brief?.cta ?? null;
      } catch {
        return null;
      }
    },
    enabled: briefApproved,
    refetchOnWindowFocus: false,
  });

  const ctx: EditorContext = useMemo(
    () => ({ mode: item.production_mode, isImage: item.media_kind === 'image' }),
    [item.production_mode, item.media_kind],
  );
  const rule = resolveRule(
    formats.scriptRule(item.format, item.media_kind, item.production_mode),
    item,
  );
  const templates = formats.data?.frame_templates?.length
    ? formats.data.frame_templates
    : FALLBACK_FRAME_TEMPLATES;
  const spec = formats.getSpec(item.format, item.media_kind);
  const canvas = spec
    ? { width: spec.width, height: spec.height }
    : FALLBACK_CANVAS[item.format];

  const resource = scriptQuery.data ?? null;
  const [working, setWorking] = useState<EditorPackage | null>(null);
  const [baseline, setBaseline] = useState<ScriptPackage | null>(null);
  const [handwritten, setHandwritten] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [serverIssues, setServerIssues] = useState<ValidationIssue[] | null>(null);
  const loadedKey = useRef<string | null>(null);

  const load = useCallback(
    (next: ScriptResource | null) => {
      loadedKey.current = next ? `${next.version}:${next.created_at}` : 'none';
      setFieldErrors({});
      setServerIssues(null);
      if (next) {
        const pkg = derive(fromPayload(next.payload), ctx);
        setWorking(pkg);
        setBaseline(toPayload(pkg, ctx));
        setHandwritten(false);
      } else {
        setWorking(null);
        setBaseline(null);
        setHandwritten(false);
      }
    },
    [ctx],
  );

  // A new version from the server (save, restore, regeneration, reload) replaces the working copy.
  useEffect(() => {
    if (scriptQuery.data === undefined) return;
    const next = scriptQuery.data;
    const nextKey = next ? `${next.version}:${next.created_at}` : 'none';
    if (nextKey === loadedKey.current) return;
    if (!next && handwritten) return;
    load(next);
  }, [scriptQuery.data, load, handwritten]);

  const payload = useMemo(() => (working ? toPayload(working, ctx) : null), [working, ctx]);
  const dirty = handwritten || (!!payload && !!baseline && !samePayload(payload, baseline));

  const clientIssues = useMemo(
    () =>
      payload
        ? computeIssues(payload, {
            ...ctx,
            rule,
            templates,
            role: item.role,
            briefCta: briefCtaQuery.data ?? null,
          })
        : [],
    [payload, ctx, rule, templates, item.role, briefCtaQuery.data],
  );
  const issues: ValidationIssue[] =
    serverIssues ??
    (dirty || !resource ? clientIssues : (resource.validation?.issues ?? []));

  // --- edits ----------------------------------------------------------------------------------

  const edit = useCallback(
    (change: (pkg: EditorPackage) => EditorPackage, touched?: string) => {
      setWorking((prev) => (prev ? derive(change(prev), ctx) : prev));
      setServerIssues(null);
      if (touched) {
        setFieldErrors((prev) => {
          if (!prev[touched]) return prev;
          const { [touched]: _removed, ...rest } = prev;
          return rest;
        });
      }
    },
    [ctx],
  );

  const shotPath = (shotKey: string, field: string) => {
    const at = working?.shots.findIndex((s) => s.key === shotKey) ?? -1;
    return `shots.${at}.${field}`;
  };
  const framePath = (frameKey: string, field: string) => {
    const at = working?.frames.findIndex((f) => f.key === frameKey) ?? -1;
    return `frames.${at}.${field}`;
  };

  const actions = {
    setStory: (field: StoryField, value: string) =>
      edit((pkg) => ({ ...pkg, [field]: value }), field),
    setNote: (field: NoteField, value: string) =>
      edit(
        (pkg) => ({ ...pkg, design_notes: { ...pkg.design_notes, [field]: value } }),
        `design_notes.${field}`,
      ),
    setNoteList: (list: 'do' | 'dont', items: string[]) =>
      edit((pkg) => ({ ...pkg, design_notes: { ...pkg.design_notes, [list]: items } })),
    updateShot: (shotKey: string, patch: Partial<Omit<EditorShot, 'key' | 'index'>>) => {
      const field = Object.keys(patch)[0] ?? '';
      edit((pkg) => updateShotIn(pkg, shotKey, patch), shotPath(shotKey, field));
    },
    addShot: () =>
      edit((pkg) => {
        const type = ctx.mode === 'video' ? 'footage' : 'graphic';
        const allowed = rule.allowed_shot_types.includes(type)
          ? type
          : (rule.allowed_shot_types[0] ?? 'graphic');
        const shot = blankShot(allowed, ctx.mode === 'video' ? 3 : 0);
        let next = addShotTo(pkg, shot);
        // Motion: every shot needs a frame (E05-S01 table), so a new shot comes with one.
        if (ctx.mode === 'motion') {
          const min = rule.frame_duration_seconds?.min ?? 2;
          next = addFrameTo(next, blankFrame(shot.key, 'statement', min));
        }
        return next;
      }),
    deleteShot: (shotKey: string) => edit((pkg) => deleteShotFrom(pkg, shotKey)),
    moveShot: (from: number, to: number) => edit((pkg) => moveShotIn(pkg, from, to)),
    addFrame: (shotKey?: string) =>
      edit((pkg) => {
        const target = shotKey ?? pkg.shots[pkg.shots.length - 1]?.key ?? '';
        const shot = pkg.shots.find((s) => s.key === target);
        const duration =
          ctx.mode === 'motion'
            ? (rule.frame_duration_seconds?.min ?? 2)
            : Math.min(1, shot?.duration_seconds ?? 1);
        const template: FrameTemplateKey = 'statement';
        return addFrameTo(pkg, blankFrame(target, template, duration));
      }),
    updateFrame: (
      frameKey: string,
      patch: Partial<Omit<EditorFrame, 'key' | 'index' | 'shot_index'>>,
    ) => {
      const field = Object.keys(patch)[0] === 'shotKey' ? 'shot_index' : Object.keys(patch)[0];
      edit((pkg) => updateFrameIn(pkg, frameKey, patch), framePath(frameKey, field ?? ''));
    },
    moveFrame: (from: number, to: number) => edit((pkg) => moveFrameIn(pkg, from, to)),
    duplicateFrame: (frameKey: string) => edit((pkg) => duplicateFrameIn(pkg, frameKey)),
    deleteFrame: (frameKey: string) => edit((pkg) => deleteFrameFrom(pkg, frameKey)),
  };

  // --- lifecycle ------------------------------------------------------------------------------

  const startHandwritten = useCallback(() => {
    setWorking(emptyPackage(rule, ctx));
    setBaseline(null);
    setHandwritten(true);
    setFieldErrors({});
    setServerIssues(null);
  }, [rule, ctx]);

  const discardHandwritten = useCallback(() => {
    setHandwritten(false);
    load(null);
  }, [load]);

  /** Refetches the latest version and replaces the working copy (discarding edits). */
  const reloadLatest = useCallback(async () => {
    const result = await scriptQuery.refetch();
    if (result.data !== undefined) load(result.data);
    queryClient.invalidateQueries({ queryKey: scriptVersionsKey(accountId, item.id) });
  }, [scriptQuery, load, queryClient, accountId, item.id]);

  const accept = useCallback(
    (next: ScriptResource) => {
      queryClient.setQueryData(key, next);
      load(next);
      queryClient.invalidateQueries({ queryKey: scriptVersionsKey(accountId, item.id) });
    },
    [queryClient, key, load, accountId, item.id],
  );

  /** `PUT …/script/` with the working package. Throws the API error for the caller to show. */
  const save = useCallback(
    async (note: string) => {
      if (!payload) throw new Error('Nothing to save.');
      const result = await saveScript(item.id, {
        base_version: resource?.version ?? 0,
        note: note.trim() || undefined,
        payload,
      });
      accept(result);
      return result;
    },
    [payload, item.id, resource?.version, accept],
  );

  /** Restore: an old version's payload saved as a new version (E05-S03 rule 19). */
  const restore = useCallback(
    async (old: ScriptResource) => {
      const result = await saveScript(item.id, {
        base_version: old.latest_version,
        note: `Restored from version ${old.version}`,
        payload: old.payload,
      });
      accept(result);
      return result;
    },
    [item.id, accept],
  );

  const approve = useCallback(async () => {
    if (!resource) throw new Error('Nothing to approve.');
    const result = await approveScript(item.id, resource.version);
    accept(result.script);
    return result;
  }, [resource, item.id, accept]);

  /** Approve refused with rule problems: the alert shows the server's list (E05-S02 States). */
  const showServerIssues = useCallback((fields: FieldError[]) => {
    setServerIssues(
      fields.map((field) => ({
        code: field.code,
        path: stripPayload(field.path),
        message: field.message,
      })),
    );
  }, []);

  return {
    query: scriptQuery,
    resource,
    working,
    payload,
    dirty,
    handwritten,
    issues,
    fieldErrors,
    setFieldErrors,
    showServerIssues,
    ctx,
    rule,
    templates,
    canvas,
    actions,
    startHandwritten,
    discardHandwritten,
    reloadLatest,
    save,
    restore,
    approve,
  };
}

export type ScriptEditor = ReturnType<typeof useScriptEditor>;
