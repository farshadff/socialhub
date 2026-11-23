/**
 * Candidates, ranking, proposal and confirm (E03-S02, E03-S03). Types mirror the API JSON in
 * the stories.
 */
import type { CandidateKind, ItemStatus, SlotRef } from './content';
import type { Format, MediaKind, ProductionMode, Role } from './formats';
import { api, type Page } from './http';
import type { Job } from './jobs';
import type { PlanStatus } from './plans';

export type { CandidateKind } from './content';

export type CandidateStatus = 'candidate' | 'proposed' | 'selected' | 'rejected';

export const CANDIDATE_STATUSES: CandidateStatus[] = [
  'candidate',
  'proposed',
  'selected',
  'rejected',
];

export const CANDIDATE_KINDS: CandidateKind[] = [
  'trend',
  'feed_item',
  'repurpose',
];

export type CandidateSourceLink = { title: string; url: string };

export type DuplicateRef = { id: number; title: string; status: ItemStatus };

export type Candidate = {
  id: number;
  account: number;
  plan: number;
  kind: CandidateKind;
  topic: { id: number; title: string; status: string } | null;
  feed_item: { id: number; title: string; status: string } | null;
  repurpose_task: {
    id: number;
    status: string;
    source_publication: { id: number; permalink: string | null };
  } | null;
  title: string;
  summary: string;
  suggested_formats: Format[];
  suggested_role: Role | null;
  sources: CandidateSourceLink[];
  evidence_score: number | null;
  goal_fit_score: number | null;
  freshness_score: number | null;
  /** Decimal as a string, for example "77.80"; null until scored. */
  total_score: string | null;
  rationale: string;
  duplicate_of: DuplicateRef | null;
  rank: number | null;
  status: CandidateStatus;
  proposed_slot: Pick<SlotRef, 'id' | 'scheduled_at' | 'format' | 'role'> | null;
  ranked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateListParams = {
  account: number;
  plan: number;
  status?: CandidateStatus[];
  kind?: CandidateKind[];
  duplicate?: boolean;
  ordering?: 'rank' | '-total_score' | '-ranked_at';
  page?: number;
  page_size?: number;
};

export const listCandidates = (params: CandidateListParams) =>
  api.get<Page<Candidate>>('/candidates/', params);

export const updateCandidate = (
  id: number,
  body: { status: 'rejected' | 'candidate' },
) => api.patch<Candidate>(`/candidates/${id}/`, body);

/** Result of a successful `selection.rank` job. */
export type RankResult = {
  candidates: number;
  created: number;
  rescored: number;
  removed: number;
  not_scored: number;
  duplicates: number;
  proposed: number;
  auto_confirmed: number;
  warnings?: string[];
};

export const startRanking = (plan: number) =>
  api.post<{ job: Job }>('/selection/rank/', { plan });

export type ProposalCandidate = {
  id: number;
  kind: CandidateKind;
  title: string;
  rank: number | null;
  total_score: string | null;
  suggested_formats: Format[];
  suggested_role: Role | null;
  duplicate_of: DuplicateRef | null;
};

export type ProposalSlot = SlotRef;

export type ProposalFit = {
  format_points: number;
  role_points: number;
  format_match: boolean;
  role_match: boolean;
};

export type ProposalWarning = 'slots_changed' | 'never_ranked' | 'no_open_slots';

export type Proposal = {
  plan: { id: number; status: PlanStatus; week_start: string; week_end: string };
  ranked_at: string | null;
  autopilot: boolean;
  assignments: {
    slot: ProposalSlot;
    candidate: ProposalCandidate;
    fit: ProposalFit;
  }[];
  unfilled_slots: ProposalSlot[];
  unassigned_candidates: ProposalCandidate[];
  reserved_slots: (ProposalSlot & {
    content_item: { id: number; title: string; status: ItemStatus } | null;
  })[];
  warnings: (ProposalWarning | string)[];
};

export const getProposal = (params: { account: number; plan: number }) =>
  api.get<Proposal>('/selection/proposal/', params);

export type Assignment = { candidate: number; slot: number };

export type ConfirmResponse = {
  plan: number;
  created: {
    id: number;
    title: string;
    format: Format;
    media_kind: MediaKind;
    production_mode: ProductionMode;
    role: Role | null;
    status: ItemStatus;
    slot: { id: number; scheduled_at: string };
    candidate: number;
  }[];
  open_slots_remaining: number;
};

export const confirmSelection = (
  body: { plan: number; assignments: Assignment[] },
  idempotencyKey: string,
) =>
  api.post<ConfirmResponse>('/selection/confirm/', body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });

/** `GET /plans/current/` (E01): the account's current plan, or 404 when there is none. */
export type CurrentPlan = {
  id: number;
  account: number;
  week_start: string;
  week_end: string;
  status: PlanStatus;
  title: string;
};

export const getCurrentPlan = (account: number) =>
  api.get<CurrentPlan>('/plans/current/', { account });
