// B2B partnership-portal shared logic.
//
// Conventions:
//  - AFFILIATE  = the referrer side (us). Existing affiliate-marketing features
//                 (click tracking, coupons, cookie durations) are left dormant.
//  - PARTNER_COMPANY = the client company receiving referred leads.
//  - Commission rates are stored/used as FRACTIONS (0.30 = 30%).
//    Legacy PartnerGroup.commissionRate values were stored as PERCENT (e.g. 20
//    meaning 20%); normalizeRate() handles both scales.

import { prisma } from './prisma';
import { logAuditAction } from './audit';

/** Default commission rate (fraction) when no company/group rate is set. */
export const DEFAULT_COMMISSION_RATE = 0.30;

/**
 * Normalize a commission rate to a fraction.
 * Accepts fraction scale (0.30) and legacy percent scale (30).
 */
export function normalizeRate(rate: number | null | undefined): number {
  if (rate === null || rate === undefined || Number.isNaN(rate)) {
    return DEFAULT_COMMISSION_RATE;
  }
  // Legacy percent scale, e.g. 30 -> 0.30
  if (rate > 1) return rate / 100;
  return rate;
}

/**
 * Resolve the effective commission rate for a referral.
 * Precedence: partner company's contracted rate -> affiliate's partner group
 * rate -> default 30%.
 */
export function getCommissionRateForReferral(referral: {
  partnerCompany?: { commissionRate?: number | null } | null;
  affiliate?: { partnerGroup?: { commissionRate?: number | null } | null } | null;
}): number {
  const companyRate = referral.partnerCompany?.commissionRate;
  if (companyRate !== null && companyRate !== undefined) {
    return normalizeRate(companyRate);
  }
  const groupRate = referral.affiliate?.partnerGroup?.commissionRate;
  if (groupRate !== null && groupRate !== undefined) {
    return normalizeRate(groupRate);
  }
  return DEFAULT_COMMISSION_RATE;
}

/** Pure: commission in cents for a collected amount. Always rounds down. */
export function computeCommissionCents(amountCents: number, rate: number): number {
  if (amountCents <= 0 || rate <= 0) return 0;
  return Math.floor(amountCents * rate);
}

// ───────────────────────────────────────────────
// Deal pipeline stages
// REGISTERED -> ACKNOWLEDGED -> INTRO_DONE -> NEGOTIATING -> WON / LOST
// ───────────────────────────────────────────────

export const DEAL_STAGES = [
  'REGISTERED',
  'ACKNOWLEDGED',
  'INTRO_DONE',
  'NEGOTIATING',
  'WON',
  'LOST',
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

/** Allowed forward transitions. WON/LOST are terminal. */
export const STAGE_TRANSITIONS: Record<DealStage, DealStage[]> = {
  REGISTERED: ['ACKNOWLEDGED', 'LOST'],
  ACKNOWLEDGED: ['INTRO_DONE', 'LOST'],
  INTRO_DONE: ['NEGOTIATING', 'LOST'],
  NEGOTIATING: ['WON', 'LOST'],
  WON: [],
  LOST: [],
};

/** Pure: is this stage transition allowed? */
export function validateStageTransition(from: string, to: string): boolean {
  const allowed = (STAGE_TRANSITIONS as Record<string, string[]>)[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/** Stages meaning "accepted by the partner" (acknowledged or further). */
export const STAGES_ACCEPTED: DealStage[] = ['ACKNOWLEDGED', 'INTRO_DONE', 'NEGOTIATING', 'WON'];

/** Human labels for pipeline stages (used by UIs). */
export const STAGE_META: Record<DealStage, { label: string; hint: string }> = {
  REGISTERED: { label: 'Registered', hint: 'Lead registered, awaiting partner acknowledgment' },
  ACKNOWLEDGED: { label: 'Acknowledged', hint: 'Partner confirmed the lead in writing' },
  INTRO_DONE: { label: 'Intro Done', hint: 'Introduction made to the client' },
  NEGOTIATING: { label: 'Negotiating', hint: 'Commercial discussion in progress' },
  WON: { label: 'Won', hint: 'Deal closed' },
  LOST: { label: 'Lost', hint: 'Lead rejected or deal lost' },
};

interface TransitionArgs {
  referralId: string;
  toStage: DealStage;
  actorId: string;
  note?: string;
}

/**
 * Move a referral to a new pipeline stage.
 * Validates the transition, writes a ReferralStageHistory row and an audit
 * log entry. Throws on invalid transitions or missing referrals.
 */
export async function transitionReferralStage(args: TransitionArgs) {
  const { referralId, toStage, actorId, note } = args;

  const referral = await prisma.referral.findUnique({ where: { id: referralId } });
  if (!referral) {
    throw new Error('Referral not found');
  }

  const fromStage = referral.status as DealStage;
  if (fromStage === toStage) {
    return referral; // idempotent no-op
  }
  if (!validateStageTransition(fromStage, toStage)) {
    throw new Error(`Invalid stage transition: ${fromStage} -> ${toStage}`);
  }

  const updated = await prisma.referral.update({
    where: { id: referralId },
    data: {
      status: toStage,
      reviewedBy: actorId,
      reviewedAt: new Date(),
      ...(note ? { reviewNotes: note } : {}),
    },
  });

  await prisma.referralStageHistory.create({
    data: {
      referralId,
      fromStage,
      toStage,
      actorId,
      note: note || null,
    },
  });

  await logAuditAction({
    actorId,
    action: 'referral.stage_transition',
    objectType: 'Referral',
    objectId: referralId,
    payload: { fromStage, toStage, note: note || null },
  });

  return updated;
}

/** Pure: whole days between two dates, or null if either is missing. */
export function daysBetween(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

/**
 * Invoiced-vs-collected aging for a transaction.
 * - daysSinceInvoice: invoice age (to collection, or to now if uncollected)
 * - collectionLagDays: invoice -> payment lag (only when collected)
 */
export function getTransactionAging(t: {
  invoiceDate?: Date | null;
  paidAt?: Date | null;
  status?: string;
  createdAt?: Date;
}): { daysSinceInvoice: number | null; collectionLagDays: number | null } {
  const now = new Date();
  const end = t.status === 'COMPLETED' ? t.paidAt ?? null : now;
  // Fall back to createdAt when no invoice date was recorded.
  const start = t.invoiceDate ?? t.createdAt ?? null;
  return {
    daysSinceInvoice: daysBetween(start, end),
    collectionLagDays: daysBetween(t.invoiceDate ?? null, t.paidAt ?? null),
  };
}

// ───────────────────────────────────────────────
// Partner-company scoping helpers (API routes)
// ───────────────────────────────────────────────

/** Load the partner company for a user, or null if not a partner user. */
export async function getPartnerCompanyForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { partnerCompany: true },
  });
  if (!user || user.role !== 'PARTNER_COMPANY' || !user.partnerCompany) {
    return null;
  }
  return user.partnerCompany;
}

/**
 * Guard for /api/partner/* routes. Returns the company on success, or a
 * NextResponse-ready error descriptor on failure.
 */
export async function requirePartnerCompany(userId: string | null) {
  if (!userId) {
    return { error: 'Authentication required', status: 401 as const };
  }
  const company = await getPartnerCompanyForUser(userId);
  if (!company) {
    return { error: 'Partner company access required', status: 403 as const };
  }
  return { company };
}
