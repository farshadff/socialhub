/**
 * Development mock for E03 selection (feed sources, feed items, candidates, ranking, proposal,
 * confirm) until the E03 backend exists. Shapes follow docs/epics/E03-content-selection exactly,
 * so pages need no change when the real API arrives: delete this file and mock/content.ts.
 *
 * Loaded only by `npm start` (MOCK is not `none`). State lives in memory per dev-server process.
 * Plans and slots are real E01 data when that API answers; this mock only invents slots for the
 * proposal, keyed by the plan ID the panel sends.
 *
 * `/api/v1/jobs/:id/` is answered only for jobs this mock started; every other job falls through
 * to the real API.
 */
import type { Request, Response } from 'express';

type Next = () => void;
type Json = Record<string, any>;

const now = () => new Date();
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3600_000);
const addDays = (d: Date, days: number) => addHours(d, days * 24);

let requestCounter = 0;
function fail(
  res: Response,
  status: number,
  code: string,
  extra: { message?: string; fields?: Json[]; details?: Json } = {},
) {
  requestCounter += 1;
  const requestId = `mock-${requestCounter.toString(16).padStart(6, '0')}`;
  res.setHeader('X-Request-ID', requestId);
  res.status(status).json({
    error: {
      code,
      message: extra.message ?? code,
      fields: extra.fields ?? [],
      request_id: requestId,
      retryable: false,
      details: extra.details ?? {},
    },
  });
}

function page<T>(req: Request, rows: T[], defaultSize = 20) {
  const size = Number(req.query.page_size ?? defaultSize) || defaultSize;
  const number = Number(req.query.page ?? 1) || 1;
  return {
    count: rows.length,
    next: number * size < rows.length ? `?page=${number + 1}` : null,
    previous: number > 1 ? `?page=${number - 1}` : null,
    results: rows.slice((number - 1) * size, number * size),
  };
}

const list = (value: unknown): string[] =>
  typeof value === 'string' && value ? value.split(',') : [];

// ---------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------

type Slot = {
  id: number;
  plan: number;
  scheduled_at: string;
  format: 'reel' | 'story' | 'feed_post';
  role: string | null;
  status: 'open' | 'reserved' | 'scheduled' | 'published' | 'skipped';
  content_item: { id: number; title: string; status: string } | null;
};

type MockJob = {
  id: string;
  kind: string;
  account: number;
  target_type: string;
  target_id: string;
  created_at: Date;
  duration_ms: number;
  steps: [number, string][];
  /** Applies the job's effects once; returns the result or throws a code to fail with. */
  finish: () => Json;
  done?: { status: 'succeeded' | 'failed'; result: Json | null; error_code: string | null; error_detail: string | null; at: Date };
};

export type E03Store = {
  nextId: number;
  seededAccounts: Set<number>;
  sources: Json[];
  items: Json[];
  candidates: Json[];
  slots: Slot[];
  plansSeeded: Set<number>;
  rankedPlans: Set<number>;
  jobs: Map<string, MockJob>;
  idempotency: Map<string, { body: string; response: Json }>;
  contentItems: Json[];
  events: Json[];
};

const g = globalThis as unknown as { __socialhubE03Mock?: E03Store };

export function e03Store(): E03Store {
  if (!g.__socialhubE03Mock) {
    g.__socialhubE03Mock = {
      nextId: 1000,
      seededAccounts: new Set(),
      sources: [],
      items: [],
      candidates: [],
      slots: [],
      plansSeeded: new Set(),
      rankedPlans: new Set(),
      jobs: new Map(),
      idempotency: new Map(),
      contentItems: [],
      events: [],
    };
  }
  return g.__socialhubE03Mock;
}

export const nextId = () => {
  const store = e03Store();
  store.nextId += 1;
  return store.nextId;
};

const MOCK_USER = { id: 5, name: 'Sara' };
export const mockUser = () => MOCK_USER;

function seedAccount(account: number) {
  const store = e03Store();
  if (store.seededAccounts.has(account)) return;
  store.seededAccounts.add(account);
  const t = now();
  const blog = {
    id: nextId(),
    account,
    kind: 'rss',
    name: 'Company blog',
    url: 'https://example.com/blog/rss.xml',
    config: { auto_eligible: true, max_age_days: 14 },
    active: true,
    last_synced_at: iso(addHours(t, -1)),
    last_status: 'ok',
    created_at: iso(addDays(t, -3)),
    updated_at: iso(addHours(t, -1)),
  };
  const catalogue = {
    id: nextId(),
    account,
    kind: 'json_api',
    name: 'Product catalogue',
    url: 'https://api.example.com/v1/products?sort=-created',
    config: {
      auto_eligible: true,
      max_age_days: 30,
      items_path: 'data.items',
      fields: {
        external_id: 'id',
        title: 'name',
        summary: 'description',
        url: 'links.web',
        image_url: 'images.0.url',
        published_at: 'created_at',
      },
      auth_header_env: 'SOCIALHUB_FEED_CATALOGUE_AUTH',
      auth_header_present: true,
    },
    active: true,
    last_synced_at: iso(addHours(t, -1)),
    last_status: 'error:http_401',
    created_at: iso(addDays(t, -2)),
    updated_at: iso(addHours(t, -1)),
  };
  store.sources.push(blog, catalogue);
  const blogItems: [string, string, number, string][] = [
    ['How we cut delivery time by 30%', 'A look at the three changes in our warehouse process that shortened the average delivery from five days to three and a half.', 2, 'eligible'],
    ['Our warehouse in numbers', 'Key figures from the autumn logistics report.', 4, 'eligible'],
    ['Five questions customers ask about returns', 'The answers our support team gives most often, in one place.', 6, 'eligible'],
    ['Meet the team: night shift', 'Who keeps orders moving after 22:00, and what their shift looks like.', 9, 'ignored'],
    ['Packaging that survives the post', 'We tested six box types; two of them survived every drop test.', 12, 'eligible'],
    ['Summer sale results', 'What sold, what did not, and what we learned for next year.', 40, 'new'],
  ];
  for (const [title, summary, ageDays, status] of blogItems) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    store.items.push({
      id: nextId(),
      account,
      source: { id: blog.id, name: blog.name, kind: blog.kind },
      external_id: `https://example.com/blog/${slug}`,
      title,
      summary,
      url: `https://example.com/blog/${slug}`,
      image_url: '',
      published_at: iso(addDays(t, -ageDays)),
      status,
      content_item: null,
      created_at: iso(addDays(t, -ageDays)),
      updated_at: iso(addDays(t, -ageDays)),
    });
  }
}

function sourceView(source: Json) {
  const store = e03Store();
  const counts = { new: 0, eligible: 0, ignored: 0, used: 0 } as Record<string, number>;
  for (const item of store.items) {
    if (item.source.id === source.id) counts[item.status] += 1;
  }
  return { ...source, item_counts: counts };
}

function seedPlan(plan: number, account: number) {
  const store = e03Store();
  if (store.plansSeeded.has(plan)) return;
  store.plansSeeded.add(plan);
  // Slots from tomorrow onward at 08:30 and 15:30 UTC, matching the story examples.
  const base = now();
  base.setUTCHours(0, 0, 0, 0);
  const layout: [number, number, Slot['format'], string | null][] = [
    [1, 8.5, 'story', 'engage'],
    [1, 15.5, 'reel', 'educate'],
    [2, 8.5, 'story', null],
    [3, 15.5, 'feed_post', 'build_trust'],
    [4, 15.5, 'reel', 'attract'],
    [5, 8.5, 'story', 'convert'],
    [6, 15.5, 'feed_post', 'educate'],
  ];
  for (const [day, hour, format, role] of layout) {
    store.slots.push({
      id: nextId(),
      plan,
      scheduled_at: iso(addHours(addDays(base, day), hour)),
      format,
      role,
      status: 'open',
      content_item: null,
    });
  }
  // One slot already has content, so "Already selected" has something to show.
  const first = store.slots.find((s) => s.plan === plan);
  if (first) {
    const item = createContentItem({
      account,
      plan,
      slot: first,
      candidate: null,
      title: 'Ask us anything: shipping',
      role: first.role,
      actor: MOCK_USER,
      status: 'briefed',
    });
    first.status = 'reserved';
    first.content_item = { id: item.id, title: item.title, status: item.status };
  }
  // Items further along the pipeline, so the content board has something in every column.
  const pipeline: [number, Slot['format'], string, string, Json][] = [
    [-2, 'feed_post', 'published', 'Behind the scenes: packing day', {}],
    [0, 'reel', 'scheduled', 'Three ways to reuse a shipping box', {}],
    [2, 'story', 'in_review', 'Poll: which colour next?', { hold_reason: 'Check escalated: logo too small' }],
    [3, 'reel', 'in_check', 'Desk lamp in 15 seconds', {}],
    [4, 'feed_post', 'needs_revision', 'Customer story: Leila’s studio', { revision_count: 1 }],
    [5, 'reel', 'in_production', 'How a parcel travels', { active_job: 'production' }],
    [6, 'story', 'scripted', 'Weekend opening hours', {}],
  ];
  for (const [day, format, status, title, extra] of pipeline) {
    const slot: Slot = {
      id: nextId(),
      plan,
      scheduled_at: iso(addHours(addDays(base, day), 12)),
      format,
      role: 'educate',
      status: status === 'published' ? 'published' : status === 'scheduled' ? 'scheduled' : 'reserved',
      content_item: null,
    };
    store.slots.push(slot);
    const item = createContentItem({ account, plan, slot, candidate: null, title, role: slot.role, actor: MOCK_USER, status });
    if (extra.hold_reason) item.hold_reason = extra.hold_reason;
    if (extra.revision_count) item.revision_count = extra.revision_count;
    if (extra.active_job) {
      item.active_job = {
        id: uuid(),
        kind: 'production.render',
        status: 'running',
        progress: 40,
        message: 'Rendering frames',
      };
    }
    if (status === 'published') {
      item.publication = {
        id: nextId(),
        status: 'published',
        scheduled_at: slot.scheduled_at,
        permalink: 'https://www.instagram.com/p/Cz0mock0001/',
      };
    }
    slot.content_item = { id: item.id, title: item.title, status: item.status };
  }
}

// ---------------------------------------------------------------------------------------------
// Content items (shared with mock/content.ts)
// ---------------------------------------------------------------------------------------------

const MEDIA_DEFAULTS: Record<string, [string, string]> = {
  feed_post: ['image', 'design'],
  story: ['image', 'design'],
  reel: ['video', 'motion'],
};

export function slotRef(slot: Slot | null) {
  if (!slot) return null;
  const { id, scheduled_at, format, role, status } = slot;
  return { id, scheduled_at, format, role, status };
}

export function addEvent(itemId: number, event: Json) {
  e03Store().events.push({
    id: nextId(),
    item: itemId,
    type: 'status_changed',
    from_status: null,
    to_status: null,
    actor: null,
    message: '',
    data: {},
    created_at: iso(now()),
    ...event,
  });
}

function localLabel(isoValue: string) {
  return new Date(isoValue).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export function createContentItem(args: {
  account: number;
  plan: number;
  slot: Slot;
  candidate: Json | null;
  title: string;
  role: string | null;
  actor: Json | null;
  status?: string;
}) {
  const store = e03Store();
  const [mediaKind, mode] = MEDIA_DEFAULTS[args.slot.format];
  const t = iso(now());
  const item: Json = {
    id: nextId(),
    account: args.account,
    title: args.title,
    format: args.slot.format,
    media_kind: mediaKind,
    production_mode: mode,
    role: args.role,
    status: args.status ?? 'selected',
    hold_reason: '',
    revision_count: 0,
    cancelled_reason: '',
    plan_id: args.plan,
    slot_id: args.slot.id,
    candidate_id: args.candidate?.id ?? null,
    active_job: null,
    thumbnail_url: null,
    publication: null,
    created_by: args.actor,
    created_at: t,
    updated_at: t,
  };
  store.contentItems.push(item);
  addEvent(item.id, {
    type: 'status_changed',
    to_status: 'selected',
    actor: args.actor,
    message: `Selected for the ${args.slot.format.replace('_', ' ')} slot on ${localLabel(args.slot.scheduled_at)}`,
    data: {
      candidate_id: args.candidate?.id ?? null,
      slot_id: args.slot.id,
      rank: args.candidate?.rank ?? null,
      total_score: args.candidate?.total_score ?? null,
    },
  });
  if (item.status !== 'selected') {
    addEvent(item.id, {
      type: 'status_changed',
      from_status: 'selected',
      to_status: item.status,
      actor: args.actor,
      message: 'Brief approved',
    });
  }
  return item;
}

export function findSlot(id: number | null) {
  return e03Store().slots.find((s) => s.id === id) ?? null;
}

export function findCandidate(id: number | null) {
  return e03Store().candidates.find((c) => c.id === id) ?? null;
}

/** Releases a cancelled item's slot and, when asked, its candidate and source (E03-S04 rule 15). */
export function releaseForCancel(item: Json, releaseCandidate: boolean) {
  const slot = findSlot(item.slot_id);
  if (slot) {
    slot.status = new Date(slot.scheduled_at) > now() ? 'open' : 'skipped';
    slot.content_item = null;
  }
  if (releaseCandidate) {
    const candidate = findCandidate(item.candidate_id);
    if (candidate) {
      candidate.status = 'candidate';
      candidate.proposed_slot = null;
      if (candidate.feed_item) {
        const feed = e03Store().items.find((i) => i.id === candidate.feed_item.id);
        if (feed) {
          feed.status = 'eligible';
          candidate.feed_item.status = 'eligible';
        }
      }
      renumber(candidate.plan);
      buildProposal(candidate.plan);
    }
  }
  return slot;
}

// ---------------------------------------------------------------------------------------------
// Ranking and proposal (E03-S02 rule 24, E03-S03 rules 1-7)
// ---------------------------------------------------------------------------------------------

const MIN_SCORE = 40;

function renumber(plan: number) {
  const store = e03Store();
  const ranked = store.candidates
    .filter((c) => c.plan === plan && (c.status === 'candidate' || c.status === 'proposed') && c.ranked_at)
    .sort(
      (a, b) =>
        Number(b.total_score) - Number(a.total_score) ||
        b.evidence_score - a.evidence_score ||
        b.freshness_score - a.freshness_score ||
        a.id - b.id,
    );
  ranked.forEach((c, index) => {
    c.rank = index + 1;
  });
  for (const c of store.candidates) {
    if (c.plan === plan && c.status === 'rejected') c.rank = null;
  }
}

function fit(slot: Slot, candidate: Json) {
  const formats: string[] = candidate.suggested_formats;
  let formatPoints = 1;
  if (formats.length > 0) {
    const index = formats.indexOf(slot.format);
    formatPoints = index === -1 ? 0 : 3 - index;
  }
  const rolePoints = slot.role === null ? 1 : slot.role === candidate.suggested_role ? 2 : 0;
  return {
    format_points: Math.max(formatPoints, 0),
    role_points: rolePoints,
    format_match: formatPoints > 0,
    role_match: slot.role !== null && slot.role === candidate.suggested_role,
  };
}

function buildProposal(plan: number) {
  const store = e03Store();
  for (const c of store.candidates) {
    if (c.plan === plan && c.status === 'proposed') {
      c.status = 'candidate';
      c.proposed_slot = null;
    }
  }
  const free = store.slots
    .filter((s) => s.plan === plan && s.status === 'open' && new Date(s.scheduled_at) > now())
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const eligible = store.candidates
    .filter(
      (c) =>
        c.plan === plan &&
        c.status === 'candidate' &&
        !c.duplicate_of &&
        c.rank !== null &&
        Number(c.total_score) >= MIN_SCORE,
    )
    .sort((a, b) => a.rank - b.rank);
  for (const candidate of eligible) {
    let best: Slot | null = null;
    let bestPoints = -1;
    for (const slot of free) {
      const f = fit(slot, candidate);
      if (!f.format_match) continue;
      const points = f.format_points + f.role_points;
      if (points > bestPoints) {
        best = slot;
        bestPoints = points;
      }
    }
    if (best) {
      candidate.status = 'proposed';
      candidate.proposed_slot = { id: best.id, scheduled_at: best.scheduled_at, format: best.format, role: best.role };
      free.splice(free.indexOf(best), 1);
    }
    if (free.length === 0) break;
  }
}

const TREND_SEEDS: Json[] = [
  {
    title: 'Five-minute desk setup',
    summary:
      'Short routines for tidying a work desk are spreading across home-office accounts.\nSearch interest doubled this week after two large creators posted their versions.',
    formats: ['reel', 'story'],
    role: 'educate',
    scores: [72, 85, 76],
    rationale:
      "Teaches a small, repeatable routine, which matches the week's saves goal and the home-office segment. Fits a 30-second reel.",
    sources: [
      { title: 'Desk reset routine — 1.2M views', url: 'https://www.instagram.com/reel/Cx1a2b3c4d5/' },
      { title: 'Why tidy desks are trending again', url: 'https://example.org/articles/tidy-desks' },
    ],
  },
  {
    title: 'Unboxing without the mess',
    summary: 'Creators show how they recycle packaging straight after unboxing.',
    formats: ['reel'],
    role: 'attract',
    scores: [64, 70, 81],
    rationale: 'Visual and quick to film; fits a reach goal.',
    sources: [{ title: 'Zero-waste unboxing compilation', url: 'https://example.org/videos/unboxing' }],
  },
  {
    title: 'Gift guides under 20',
    summary: 'Budget gift lists are rising as December approaches.',
    formats: ['feed_post', 'story'],
    role: 'convert',
    scores: [58, 62, 90],
    rationale: 'Seasonal and product-led; good for a carousel feed post.',
    sources: [{ title: 'Search interest: gifts under 20', url: 'https://example.org/trends/gifts' }],
  },
];

function rankPlan(plan: number, account: number) {
  const store = e03Store();
  seedAccount(account);
  seedPlan(plan, account);
  const t = iso(now());
  const existing = store.candidates.filter((c) => c.plan === plan);
  let created = 0;
  let rescored = 0;
  const make = (base: Json) => {
    const prior = existing.find((c) => c.kind === base.kind && c.title === base.title);
    if (prior) {
      rescored += 1;
      Object.assign(prior, { ranked_at: t, updated_at: t });
      return;
    }
    created += 1;
    store.candidates.push({
      id: nextId(),
      account,
      plan,
      topic: null,
      feed_item: null,
      repurpose_task: null,
      duplicate_of: null,
      rank: null,
      status: 'candidate',
      proposed_slot: null,
      ranked_at: t,
      created_at: t,
      updated_at: t,
      ...base,
    });
  };
  const total = (e: number, gf: number, f: number) => (0.45 * e + 0.4 * gf + 0.15 * f).toFixed(2);
  TREND_SEEDS.forEach((seed, index) => {
    const [e, gf, f] = seed.scores;
    make({
      kind: 'trend',
      topic: { id: 70 + index, title: seed.title, status: 'shortlisted' },
      title: seed.title,
      summary: seed.summary,
      suggested_formats: seed.formats,
      suggested_role: seed.role,
      sources: seed.sources,
      evidence_score: e,
      goal_fit_score: gf,
      freshness_score: f,
      total_score: total(e, gf, f),
      rationale: seed.rationale,
    });
  });
  const feedItems = store.items.filter((i) => i.account === account && i.status === 'eligible');
  feedItems.forEach((item, index) => {
    const e = 75 - index * 4;
    const gf = 80 - index * 7;
    const f = 66 + (index % 3) * 5;
    const duplicate = item.title === 'Our warehouse in numbers';
    const score = Number(total(e, gf, f)) * (duplicate ? 0.5 : 1);
    make({
      kind: 'feed_item',
      feed_item: { id: item.id, title: item.title, status: item.status },
      title: item.title,
      summary: item.summary,
      suggested_formats: index % 2 === 0 ? ['feed_post'] : ['reel', 'feed_post'],
      suggested_role: index % 2 === 0 ? 'build_trust' : 'attract',
      sources: [{ title: item.title, url: item.url }],
      evidence_score: e,
      goal_fit_score: gf,
      freshness_score: f,
      total_score: score.toFixed(2),
      rationale: duplicate
        ? "Relevant proof content, but it repeats the figures used in last week's feed post."
        : 'First-party news that supports the trust goal for this week.',
      duplicate_of: duplicate ? { id: 38, title: 'Warehouse numbers at a glance', status: 'published' } : null,
    });
  });
  make({
    kind: 'repurpose',
    repurpose_task: { id: 9, status: 'in_selection', source_publication: { id: 31, permalink: 'https://www.instagram.com/p/Cw9z8y7x6w5/' } },
    title: 'Repurpose: Three packing mistakes',
    summary: 'Last month\'s carousel reached twice the usual audience. Turn it into a reel.',
    suggested_formats: ['reel'],
    suggested_role: 'educate',
    sources: [{ title: 'Three packing mistakes (original post)', url: 'https://www.instagram.com/p/Cw9z8y7x6w5/' }],
    evidence_score: 80,
    goal_fit_score: 78,
    freshness_score: 60,
    total_score: total(80, 78, 60),
    rationale: 'A proven post in a new format; strong evidence from its own metrics.',
  });
  store.rankedPlans.add(plan);
  renumber(plan);
  buildProposal(plan);
  const planCandidates = store.candidates.filter((c) => c.plan === plan);
  return {
    candidates: planCandidates.filter((c) => c.status !== 'selected').length,
    created,
    rescored,
    removed: 0,
    not_scored: 0,
    duplicates: planCandidates.filter((c) => c.duplicate_of).length,
    proposed: planCandidates.filter((c) => c.status === 'proposed').length,
    auto_confirmed: 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

function uuid() {
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

function startJob(job: Omit<MockJob, 'id' | 'created_at'>) {
  const full: MockJob = { ...job, id: uuid(), created_at: now() };
  e03Store().jobs.set(full.id, full);
  return full;
}

function jobView(job: MockJob) {
  const elapsed = now().getTime() - job.created_at.getTime();
  if (!job.done && elapsed >= job.duration_ms) {
    try {
      job.done = { status: 'succeeded', result: job.finish(), error_code: null, error_detail: null, at: now() };
    } catch (error) {
      const [code, detail] = String((error as Error).message).split('|');
      job.done = { status: 'failed', result: null, error_code: code, error_detail: detail ?? null, at: now() };
    }
  }
  let status = 'queued';
  let progress = 0;
  let message = 'Waiting to start';
  if (job.done) {
    status = job.done.status;
    progress = job.done.status === 'succeeded' ? 100 : progress;
    message = job.done.status === 'succeeded' ? 'Done' : 'Failed';
  } else if (elapsed > 400) {
    status = 'running';
    for (const [at, text] of job.steps) {
      if (elapsed / job.duration_ms >= at / 100) {
        progress = at;
        message = text;
      }
    }
  }
  return {
    id: job.id,
    kind: job.kind,
    account: job.account,
    queue: 'default',
    status,
    progress,
    message,
    target_type: job.target_type,
    target_id: job.target_id,
    result: job.done?.result ?? null,
    error_code: job.done?.error_code ?? null,
    error_detail: job.done?.error_detail ?? null,
    created_by: MOCK_USER,
    request_id: null,
    created_at: iso(job.created_at),
    started_at: elapsed > 400 ? iso(new Date(job.created_at.getTime() + 400)) : null,
    finished_at: job.done ? iso(job.done.at) : null,
  };
}

function activeJobFor(kind: string, targetType: string, targetId: string) {
  for (const job of e03Store().jobs.values()) {
    if (job.kind === kind && job.target_type === targetType && job.target_id === targetId) {
      const view = jobView(job);
      if (view.status === 'queued' || view.status === 'running') return view;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Feed sync
// ---------------------------------------------------------------------------------------------

function syncSource(source: Json) {
  const store = e03Store();
  const t = now();
  if (source.kind === 'json_api' && source.config.auth_header_env && source.name === 'Product catalogue') {
    source.last_synced_at = iso(t);
    source.last_status = 'error:http_401';
    throw new Error('feed_sync_failed|http_401');
  }
  const existing = store.items.filter((i) => i.source.id === source.id).length;
  const fresh = existing === 0 ? 3 : 1;
  let eligible = 0;
  for (let n = 0; n < fresh; n += 1) {
    const auto = source.config.auto_eligible !== false;
    const status = auto ? 'eligible' : 'new';
    if (status === 'eligible') eligible += 1;
    const number = existing + n + 1;
    store.items.unshift({
      id: nextId(),
      account: source.account,
      source: { id: source.id, name: source.name, kind: source.kind },
      external_id: `${source.url}#${number}`,
      title: `${source.name}: update ${number}`,
      summary: `Item ${number} read from ${source.name} by the development mock.`,
      url: source.url,
      image_url: '',
      published_at: iso(addHours(t, -n)),
      status,
      content_item: null,
      created_at: iso(t),
      updated_at: iso(t),
    });
  }
  source.last_synced_at = iso(t);
  source.last_status = 'ok';
  source.updated_at = iso(t);
  return { created: fresh, updated: 0, unchanged: existing, skipped: 0, eligible, status: 'ok' };
}

// ---------------------------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------------------------

type FieldError = { path: string; code: string; message: string };

function validateSource(body: Json, current: Json | null, account: number): FieldError[] {
  const store = e03Store();
  const errors: FieldError[] = [];
  const kind = current?.kind ?? body.kind;
  if (current && body.kind !== undefined && body.kind !== current.kind) {
    errors.push({ path: 'kind', code: 'immutable', message: 'Kind cannot change.' });
  }
  const name = (body.name ?? current?.name ?? '').trim();
  if (!name) errors.push({ path: 'name', code: 'required', message: 'Required.' });
  else if (name.length > 80) errors.push({ path: 'name', code: 'max_length', message: 'Too long.' });
  else if (
    store.sources.some(
      (s) => s.account === account && s.id !== current?.id && s.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    errors.push({ path: 'name', code: 'unique', message: 'Name already used.' });
  }
  if (kind !== 'manual') {
    const url: string = body.url ?? current?.url ?? '';
    if (!url) errors.push({ path: 'url', code: 'required', message: 'Required.' });
    else if (!/^https?:\/\//.test(url) || url.length > 500) {
      errors.push({ path: 'url', code: 'invalid', message: 'Invalid.' });
    }
  }
  const config = body.config ?? current?.config ?? {};
  if (kind === 'json_api') {
    if (!config.fields?.external_id) {
      errors.push({ path: 'config.fields.external_id', code: 'required', message: 'Required.' });
    }
    if (!config.fields?.title) {
      errors.push({ path: 'config.fields.title', code: 'required', message: 'Required.' });
    }
    if (config.auth_header_env && !String(config.auth_header_env).startsWith('SOCIALHUB_FEED_')) {
      errors.push({ path: 'config.auth_header_env', code: 'invalid', message: 'Invalid.' });
    }
  }
  if (config.max_age_days !== undefined && (config.max_age_days < 1 || config.max_age_days > 365)) {
    errors.push({ path: 'config.max_age_days', code: 'max_value', message: 'Out of range.' });
  }
  if (!current) {
    const count = store.sources.filter((s) => s.account === account).length;
    if (count >= 20 || (kind === 'manual' && store.sources.some((s) => s.account === account && s.kind === 'manual'))) {
      errors.push({ path: 'account', code: 'limit_reached', message: 'Limit reached.' });
    }
  }
  return errors;
}

const FEED_TRANSITIONS: Record<string, string[]> = {
  new: ['eligible', 'ignored'],
  eligible: ['ignored'],
  ignored: ['eligible'],
  used: ['eligible'],
};

const CANDIDATE_TRANSITIONS: Record<string, string[]> = {
  candidate: ['rejected'],
  proposed: ['rejected'],
  rejected: ['candidate'],
  selected: [],
};

function accountOf(req: Request, res: Response): number | null {
  const raw = req.query.account ?? req.body?.account;
  const account = Number(raw);
  if (!Number.isInteger(account) || account <= 0) {
    fail(res, 400, 'validation_error', {
      fields: [{ path: 'account', code: 'required', message: 'Required.' }],
    });
    return null;
  }
  seedAccount(account);
  return account;
}

function planIdOf(req: Request, res: Response): number | null {
  const plan = Number(req.query.plan ?? req.body?.plan);
  if (!Number.isInteger(plan) || plan <= 0) {
    fail(res, 400, 'validation_error', {
      fields: [{ path: 'plan', code: 'required', message: 'Required.' }],
    });
    return null;
  }
  return plan;
}

const proposalCandidate = (c: Json) => ({
  id: c.id,
  kind: c.kind,
  title: c.title,
  rank: c.rank,
  total_score: c.total_score,
  suggested_formats: c.suggested_formats,
  suggested_role: c.suggested_role,
  duplicate_of: c.duplicate_of,
});

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

export default {
  'GET /api/v1/feeds/sources/': (req: Request, res: Response) => {
    const account = accountOf(req, res);
    if (account === null) return;
    const kinds = list(req.query.kind);
    let rows = e03Store().sources.filter((s) => s.account === account);
    if (kinds.length) rows = rows.filter((s) => kinds.includes(s.kind));
    if (req.query.active !== undefined) rows = rows.filter((s) => String(s.active) === req.query.active);
    rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    res.json(page(req, rows.map(sourceView), 100));
  },

  'POST /api/v1/feeds/sources/': (req: Request, res: Response) => {
    const account = accountOf(req, res);
    if (account === null) return;
    const body = req.body ?? {};
    if (!['rss', 'json_api'].includes(body.kind)) {
      return fail(res, 400, 'validation_error', {
        fields: [{ path: 'kind', code: 'invalid_choice', message: 'Invalid.' }],
      });
    }
    const errors = validateSource(body, null, account);
    if (errors.length) return fail(res, 400, 'validation_error', { fields: errors });
    const t = iso(now());
    const config = { auto_eligible: true, max_age_days: 14, ...(body.config ?? {}) };
    if (body.kind === 'json_api') {
      config.items_path = config.items_path ?? '';
      config.auth_header_present = Boolean(config.auth_header_env);
    }
    const source = {
      id: nextId(),
      account,
      kind: body.kind,
      name: body.name.trim(),
      url: body.url ?? '',
      config,
      active: body.active ?? true,
      last_synced_at: null,
      last_status: null,
      created_at: t,
      updated_at: t,
    };
    e03Store().sources.push(source);
    res.status(201).json(sourceView(source));
  },

  'PATCH /api/v1/feeds/sources/:id/': (req: Request, res: Response) => {
    const source = e03Store().sources.find((s) => s.id === Number(req.params.id));
    if (!source) return fail(res, 404, 'not_found');
    const body = req.body ?? {};
    const errors = validateSource(body, source, source.account);
    if (errors.length) return fail(res, 400, 'validation_error', { fields: errors });
    if (body.name !== undefined) source.name = body.name.trim();
    if (body.url !== undefined) source.url = body.url;
    if (body.active !== undefined) source.active = body.active;
    if (body.config !== undefined) {
      source.config = { auto_eligible: true, max_age_days: 14, ...body.config };
      if (source.kind === 'json_api') {
        source.config.auth_header_present = Boolean(source.config.auth_header_env);
      }
    }
    source.updated_at = iso(now());
    res.json(sourceView(source));
  },

  'DELETE /api/v1/feeds/sources/:id/': (req: Request, res: Response) => {
    const store = e03Store();
    const source = store.sources.find((s) => s.id === Number(req.params.id));
    if (!source) return fail(res, 404, 'not_found');
    if (source.kind === 'manual') return fail(res, 409, 'state_conflict');
    const itemIds = new Set(store.items.filter((i) => i.source.id === source.id).map((i) => i.id));
    const referenced = store.candidates.filter((c) => c.feed_item && itemIds.has(c.feed_item.id)).length;
    if (referenced) return fail(res, 409, 'state_conflict', { details: { candidates: referenced } });
    store.items = store.items.filter((i) => !itemIds.has(i.id));
    store.sources = store.sources.filter((s) => s.id !== source.id);
    res.status(204).end();
  },

  'POST /api/v1/feeds/sources/:id/sync/': (req: Request, res: Response) => {
    const source = e03Store().sources.find((s) => s.id === Number(req.params.id));
    if (!source) return fail(res, 404, 'not_found');
    if (source.kind === 'manual') {
      return fail(res, 400, 'validation_error', {
        fields: [{ path: 'kind', code: 'not_syncable', message: 'Manual sources do not sync.' }],
      });
    }
    const running = activeJobFor('feeds.sync', 'feed_source', String(source.id));
    if (running) return fail(res, 409, 'job_in_progress', { details: { job: running } });
    const job = startJob({
      kind: 'feeds.sync',
      account: source.account,
      target_type: 'feed_source',
      target_id: String(source.id),
      duration_ms: 3000,
      steps: [
        [20, 'Fetching the feed'],
        [60, 'Reading items'],
        [90, 'Saving items'],
      ],
      finish: () => syncSource(source),
    });
    res.status(202).json({ job: jobView(job) });
  },

  'GET /api/v1/feeds/items/': (req: Request, res: Response) => {
    const account = accountOf(req, res);
    if (account === null) return;
    const statuses = list(req.query.status);
    const search = String(req.query.search ?? '').toLowerCase();
    let rows = e03Store().items.filter((i) => i.account === account);
    if (req.query.source) rows = rows.filter((i) => i.source.id === Number(req.query.source));
    if (statuses.length) rows = rows.filter((i) => statuses.includes(i.status));
    if (search) rows = rows.filter((i) => i.title.toLowerCase().includes(search));
    const order = String(req.query.ordering ?? '-published_at');
    rows = [...rows].sort((a, b) => {
      if (order === '-created_at') return b.created_at.localeCompare(a.created_at);
      const av = a.published_at ?? '';
      const bv = b.published_at ?? '';
      if (!av || !bv) return av ? -1 : bv ? 1 : 0;
      return order === 'published_at' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    res.json(page(req, rows));
  },

  'POST /api/v1/feeds/items/': (req: Request, res: Response) => {
    const account = accountOf(req, res);
    if (account === null) return;
    const store = e03Store();
    const body = req.body ?? {};
    const title = String(body.title ?? '').trim();
    if (title.length < 3 || title.length > 300) {
      return fail(res, 400, 'validation_error', {
        fields: [{ path: 'title', code: title ? 'min_length' : 'required', message: 'Invalid.' }],
      });
    }
    let manual = store.sources.find((s) => s.account === account && s.kind === 'manual');
    const t = iso(now());
    if (!manual) {
      manual = {
        id: nextId(),
        account,
        kind: 'manual',
        name: 'Manual items',
        url: '',
        config: { auto_eligible: true, max_age_days: 14 },
        active: true,
        last_synced_at: null,
        last_status: null,
        created_at: t,
        updated_at: t,
      };
      store.sources.push(manual);
    }
    const item = {
      id: nextId(),
      account,
      source: { id: manual.id, name: manual.name, kind: 'manual' },
      external_id: `manual-${uuid()}`,
      title,
      summary: body.summary ?? '',
      url: body.url ?? '',
      image_url: body.image_url ?? '',
      published_at: body.published_at ?? null,
      status: 'eligible',
      content_item: null,
      created_at: t,
      updated_at: t,
    };
    store.items.unshift(item);
    res.status(201).json(item);
  },

  'PATCH /api/v1/feeds/items/:id/': (req: Request, res: Response) => {
    const item = e03Store().items.find((i) => i.id === Number(req.params.id));
    if (!item) return fail(res, 404, 'not_found');
    const body = req.body ?? {};
    const textFields = ['title', 'summary', 'url', 'image_url', 'published_at'];
    if (item.source.kind !== 'manual') {
      const sent = textFields.filter((f) => body[f] !== undefined);
      if (sent.length) {
        return fail(res, 400, 'validation_error', {
          fields: sent.map((f) => ({ path: f, code: 'read_only', message: 'Read only.' })),
        });
      }
    }
    if (body.status !== undefined && body.status !== item.status) {
      const allowed = FEED_TRANSITIONS[item.status] ?? [];
      if (!allowed.includes(body.status)) {
        return fail(res, 409, 'invalid_transition', {
          details: { status: item.status, allowed_statuses: allowed },
        });
      }
      if (item.status === 'used' && item.content_item && item.content_item.status !== 'cancelled') {
        return fail(res, 409, 'invalid_transition', {
          details: { status: item.status, allowed_statuses: [], content_item: item.content_item },
        });
      }
      item.status = body.status;
    }
    for (const f of textFields) if (body[f] !== undefined) item[f] = body[f];
    item.updated_at = iso(now());
    res.json(item);
  },

  'POST /api/v1/selection/rank/': (req: Request, res: Response) => {
    const plan = planIdOf(req, res);
    if (plan === null) return;
    const account = Number(req.query.account ?? req.body?.account ?? 0) || guessAccount(plan);
    const running = activeJobFor('selection.rank', 'plan', String(plan));
    if (running) return fail(res, 409, 'job_in_progress', { details: { job: running } });
    const job = startJob({
      kind: 'selection.rank',
      account,
      target_type: 'plan',
      target_id: String(plan),
      duration_ms: 5000,
      steps: [
        [10, 'Collecting candidates'],
        [25, 'Scoring evidence and freshness'],
        [30, 'Scoring goal fit (batch 1 of 2)'],
        [60, 'Scoring goal fit (batch 2 of 2)'],
        [90, 'Ranking'],
        [95, 'Building proposal'],
      ],
      finish: () => rankPlan(plan, account),
    });
    res.status(202).json({ job: jobView(job) });
  },

  'GET /api/v1/candidates/': (req: Request, res: Response) => {
    const account = accountOf(req, res);
    if (account === null) return;
    const plan = planIdOf(req, res);
    if (plan === null) return;
    seedPlan(plan, account);
    const statuses = list(req.query.status);
    const kinds = list(req.query.kind);
    let rows = e03Store().candidates.filter((c) => c.plan === plan);
    if (statuses.length) rows = rows.filter((c) => statuses.includes(c.status));
    if (kinds.length) rows = rows.filter((c) => kinds.includes(c.kind));
    if (req.query.duplicate === 'true') rows = rows.filter((c) => c.duplicate_of);
    if (req.query.duplicate === 'false') rows = rows.filter((c) => !c.duplicate_of);
    const order = String(req.query.ordering ?? 'rank');
    rows = [...rows].sort((a, b) => {
      if (order === '-total_score') return Number(b.total_score) - Number(a.total_score);
      if (a.rank === null && b.rank === null) return a.id - b.id;
      if (a.rank === null) return 1;
      if (b.rank === null) return -1;
      return a.rank - b.rank;
    });
    res.json(page(req, rows));
  },

  'PATCH /api/v1/candidates/:id/': (req: Request, res: Response) => {
    const candidate = findCandidate(Number(req.params.id));
    if (!candidate) return fail(res, 404, 'not_found');
    const body = req.body ?? {};
    const extra = Object.keys(body).filter((k) => k !== 'status');
    if (extra.length) {
      return fail(res, 400, 'validation_error', {
        fields: extra.map((f) => ({ path: f, code: 'read_only', message: 'Read only.' })),
      });
    }
    const allowed = CANDIDATE_TRANSITIONS[candidate.status] ?? [];
    if (!allowed.includes(body.status)) {
      return fail(res, 409, 'invalid_transition', {
        details: { status: candidate.status, allowed_statuses: allowed },
      });
    }
    candidate.status = body.status;
    candidate.proposed_slot = null;
    candidate.updated_at = iso(now());
    renumber(candidate.plan);
    buildProposal(candidate.plan);
    res.json(candidate);
  },

  'GET /api/v1/selection/proposal/': (req: Request, res: Response) => {
    const account = accountOf(req, res);
    if (account === null) return;
    const plan = planIdOf(req, res);
    if (plan === null) return;
    seedPlan(plan, account);
    const store = e03Store();
    const slots = store.slots
      .filter((s) => s.plan === plan)
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    const candidates = store.candidates.filter((c) => c.plan === plan);
    const future = (s: Slot) => new Date(s.scheduled_at) > now();
    const assignments = candidates
      .filter((c) => c.status === 'proposed' && c.proposed_slot)
      .map((c) => ({ c, slot: findSlot(c.proposed_slot.id) as Slot }))
      .filter(({ slot }) => slot && slot.status === 'open' && future(slot))
      .sort((a, b) => a.slot.scheduled_at.localeCompare(b.slot.scheduled_at))
      .map(({ c, slot }) => ({ slot: slotRef(slot), candidate: proposalCandidate(c), fit: fit(slot, c) }));
    const assignedSlots = new Set(assignments.map((a) => a.slot?.id));
    const openSlots = slots.filter((s) => s.status === 'open' && future(s));
    const warnings: string[] = [];
    const rankedAt = candidates.map((c) => c.ranked_at).filter(Boolean).sort().pop() ?? null;
    if (!rankedAt) warnings.push('never_ranked');
    if (openSlots.length === 0) warnings.push('no_open_slots');
    res.json({
      plan: { id: plan, status: 'active', week_start: slots[0]?.scheduled_at.slice(0, 10) ?? null, week_end: slots[slots.length - 1]?.scheduled_at.slice(0, 10) ?? null },
      ranked_at: rankedAt,
      autopilot: false,
      assignments,
      unfilled_slots: openSlots.filter((s) => !assignedSlots.has(s.id)).map(slotRef),
      unassigned_candidates: candidates
        .filter((c) => c.status === 'candidate')
        .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
        .slice(0, 50)
        .map(proposalCandidate),
      reserved_slots: slots
        .filter((s) => s.status !== 'open' && s.content_item)
        .map((s) => ({ ...slotRef(s), content_item: s.content_item })),
      warnings,
    });
  },

  'POST /api/v1/selection/confirm/': (req: Request, res: Response) => {
    const store = e03Store();
    const body = req.body ?? {};
    const key = String(req.headers['idempotency-key'] ?? '');
    const bodyText = JSON.stringify(body);
    if (key) {
      const stored = store.idempotency.get(key);
      if (stored) {
        if (stored.body !== bodyText) {
          return fail(res, 409, 'state_conflict', { details: { reason: 'idempotency_key_reused' } });
        }
        res.setHeader('Idempotency-Replayed', 'true');
        return res.status(201).json(stored.response);
      }
    }
    const plan = planIdOf(req, res);
    if (plan === null) return;
    const assignments: { candidate: number; slot: number }[] = body.assignments ?? [];
    if (assignments.length < 1 || assignments.length > 50) {
      return fail(res, 400, 'validation_error', {
        fields: [{ path: 'assignments', code: assignments.length ? 'max_length' : 'min_length', message: 'Invalid.' }],
      });
    }
    const errors: FieldError[] = [];
    const seenC = new Set<number>();
    const seenS = new Set<number>();
    assignments.forEach((a, i) => {
      const c = findCandidate(a.candidate);
      const s = findSlot(a.slot);
      if (seenC.has(a.candidate)) errors.push({ path: `assignments.${i}.candidate`, code: 'duplicate', message: 'Repeated.' });
      if (seenS.has(a.slot)) errors.push({ path: `assignments.${i}.slot`, code: 'duplicate', message: 'Repeated.' });
      seenC.add(a.candidate);
      seenS.add(a.slot);
      if (!c || c.plan !== plan) errors.push({ path: `assignments.${i}.candidate`, code: 'does_not_exist', message: 'Unknown.' });
      else if (c.status === 'selected' || c.status === 'rejected') errors.push({ path: `assignments.${i}.candidate`, code: 'not_selectable', message: 'Not selectable.' });
      if (!s || s.plan !== plan) errors.push({ path: `assignments.${i}.slot`, code: 'does_not_exist', message: 'Unknown.' });
      else if (s.status !== 'open') errors.push({ path: `assignments.${i}.slot`, code: 'slot_not_open', message: 'Not open.' });
      else if (new Date(s.scheduled_at) <= now()) errors.push({ path: `assignments.${i}.slot`, code: 'slot_in_past', message: 'In the past.' });
    });
    if (errors.length) return fail(res, 400, 'validation_error', { fields: errors });
    const created = assignments.map(({ candidate: cid, slot: sid }) => {
      const c = findCandidate(cid) as Json;
      const s = findSlot(sid) as Slot;
      const item = createContentItem({
        account: c.account,
        plan,
        slot: s,
        candidate: c,
        title: c.title,
        role: s.role ?? c.suggested_role ?? null,
        actor: MOCK_USER,
      });
      s.status = 'reserved';
      s.content_item = { id: item.id, title: item.title, status: item.status };
      c.status = 'selected';
      c.proposed_slot = { id: s.id, scheduled_at: s.scheduled_at, format: s.format, role: s.role };
      if (c.feed_item) {
        const feed = store.items.find((i) => i.id === c.feed_item.id);
        if (feed) {
          feed.status = 'used';
          feed.content_item = { id: item.id, status: item.status };
          c.feed_item.status = 'used';
        }
      }
      if (c.topic) c.topic.status = 'used';
      if (c.repurpose_task) c.repurpose_task.status = 'used';
      return {
        id: item.id,
        title: item.title,
        format: item.format,
        media_kind: item.media_kind,
        production_mode: item.production_mode,
        role: item.role,
        status: item.status,
        slot: { id: s.id, scheduled_at: s.scheduled_at },
        candidate: c.id,
      };
    });
    buildProposal(plan);
    const response = {
      plan,
      created,
      open_slots_remaining: store.slots.filter((s) => s.plan === plan && s.status === 'open').length,
    };
    if (key) store.idempotency.set(key, { body: bodyText, response });
    res.status(201).json(response);
  },

  'GET /api/v1/jobs/:id/': (req: Request, res: Response, next: Next) => {
    const job = e03Store().jobs.get(String(req.params.id));
    if (!job) return next();
    res.json(jobView(job));
  },
};

/** The account a plan was first seen with, for rank requests that send only `plan`. */
function guessAccount(plan: number): number {
  const store = e03Store();
  const fromCandidate = store.candidates.find((c) => c.plan === plan)?.account;
  if (fromCandidate) return fromCandidate;
  const fromItem = store.contentItems.find((i) => i.plan_id === plan)?.account;
  return fromItem ?? [...store.seededAccounts][0] ?? 1;
}
