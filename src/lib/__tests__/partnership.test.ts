// Baseline trust-critical tests: pure partnership logic.
// Run: npm test
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COMMISSION_RATE,
  normalizeRate,
  getCommissionRateForReferral,
  computeCommissionCents,
  validateStageTransition,
  STAGE_TRANSITIONS,
  DEAL_STAGES,
  daysBetween,
  getTransactionAging,
} from '@/lib/partnership';

describe('normalizeRate', () => {
  it('keeps fraction scale as-is', () => {
    expect(normalizeRate(0.3)).toBe(0.3);
  });
  it('converts legacy percent scale to fraction', () => {
    expect(normalizeRate(30)).toBe(0.3);
    expect(normalizeRate(20)).toBe(0.2);
  });
  it('falls back to default for null/undefined/NaN', () => {
    expect(normalizeRate(null)).toBe(DEFAULT_COMMISSION_RATE);
    expect(normalizeRate(undefined)).toBe(DEFAULT_COMMISSION_RATE);
    expect(normalizeRate(NaN)).toBe(DEFAULT_COMMISSION_RATE);
  });
});

describe('getCommissionRateForReferral', () => {
  it('prefers the partner company contracted rate', () => {
    expect(
      getCommissionRateForReferral({
        partnerCompany: { commissionRate: 0.3 },
        affiliate: { partnerGroup: { commissionRate: 0.2 } },
      })
    ).toBe(0.3);
  });
  it('falls back to partner group rate (either scale)', () => {
    expect(
      getCommissionRateForReferral({
        partnerCompany: null,
        affiliate: { partnerGroup: { commissionRate: 25 } },
      })
    ).toBe(0.25);
  });
  it('defaults to 30% when nothing is set', () => {
    expect(getCommissionRateForReferral({})).toBe(0.3);
    expect(DEFAULT_COMMISSION_RATE).toBe(0.3);
  });
});

describe('computeCommissionCents', () => {
  it('computes 30% of $10,000 as $3,000', () => {
    expect(computeCommissionCents(1_000_000, 0.3)).toBe(300_000);
  });
  it('rounds down fractional cents', () => {
    expect(computeCommissionCents(999, 0.3)).toBe(299); // 299.7 -> 299
  });
  it('returns 0 for non-positive inputs', () => {
    expect(computeCommissionCents(0, 0.3)).toBe(0);
    expect(computeCommissionCents(-100, 0.3)).toBe(0);
    expect(computeCommissionCents(1000, 0)).toBe(0);
  });
});

describe('deal pipeline transitions', () => {
  it('defines the full happy-path chain', () => {
    expect(DEAL_STAGES).toEqual([
      'REGISTERED',
      'ACKNOWLEDGED',
      'INTRO_DONE',
      'NEGOTIATING',
      'WON',
      'LOST',
    ]);
  });
  it('allows forward movement along the pipeline', () => {
    expect(validateStageTransition('REGISTERED', 'ACKNOWLEDGED')).toBe(true);
    expect(validateStageTransition('ACKNOWLEDGED', 'INTRO_DONE')).toBe(true);
    expect(validateStageTransition('INTRO_DONE', 'NEGOTIATING')).toBe(true);
    expect(validateStageTransition('NEGOTIATING', 'WON')).toBe(true);
  });
  it('allows bailing out to LOST from any live stage', () => {
    for (const s of ['REGISTERED', 'ACKNOWLEDGED', 'INTRO_DONE', 'NEGOTIATING']) {
      expect(validateStageTransition(s, 'LOST')).toBe(true);
    }
  });
  it('rejects skipping stages', () => {
    expect(validateStageTransition('REGISTERED', 'WON')).toBe(false);
    expect(validateStageTransition('REGISTERED', 'NEGOTIATING')).toBe(false);
    expect(validateStageTransition('ACKNOWLEDGED', 'WON')).toBe(false);
  });
  it('rejects backward movement', () => {
    expect(validateStageTransition('NEGOTIATING', 'ACKNOWLEDGED')).toBe(false);
    expect(validateStageTransition('WON', 'NEGOTIATING')).toBe(false);
  });
  it('treats WON and LOST as terminal', () => {
    expect(STAGE_TRANSITIONS.WON).toEqual([]);
    expect(STAGE_TRANSITIONS.LOST).toEqual([]);
    expect(validateStageTransition('WON', 'LOST')).toBe(false);
    expect(validateStageTransition('LOST', 'REGISTERED')).toBe(false);
  });
  it('rejects unknown stages', () => {
    expect(validateStageTransition('PENDING', 'APPROVED')).toBe(false);
    expect(validateStageTransition('REGISTERED', 'APPROVED')).toBe(false);
  });
});

describe('transaction aging', () => {
  it('computes days between dates', () => {
    const a = new Date('2026-01-01T00:00:00Z');
    const b = new Date('2026-01-11T00:00:00Z');
    expect(daysBetween(a, b)).toBe(10);
  });
  it('returns null when a date is missing', () => {
    expect(daysBetween(null, new Date())).toBe(null);
    expect(daysBetween(new Date(), undefined)).toBe(null);
  });
  it('reports collection lag for completed transactions', () => {
    const aging = getTransactionAging({
      invoiceDate: new Date('2026-01-01T00:00:00Z'),
      paidAt: new Date('2026-01-08T00:00:00Z'),
      status: 'COMPLETED',
    });
    expect(aging.collectionLagDays).toBe(7);
    expect(aging.daysSinceInvoice).toBe(7);
  });
  it('reports no collection lag before money clears', () => {
    const aging = getTransactionAging({
      invoiceDate: new Date('2026-01-01T00:00:00Z'),
      paidAt: null,
      status: 'INVOICED',
    });
    expect(aging.collectionLagDays).toBe(null);
    expect(aging.daysSinceInvoice).toBeGreaterThanOrEqual(0);
  });
});
