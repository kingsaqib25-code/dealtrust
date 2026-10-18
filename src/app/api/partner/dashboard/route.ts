// Partner portal: dashboard KPIs, scoped to the caller's own company.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePartnerCompany, computeCommissionCents, normalizeRate } from '@/lib/partnership';

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  const scope = await requirePartnerCompany(userId);
  if ('error' in scope) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }
  const company = scope.company;
  const rate = normalizeRate(company.commissionRate);

  const [leads, transactions] = await Promise.all([
    prisma.referral.findMany({
      where: { partnerCompanyId: company.id },
      select: { id: true, status: true },
    }),
    prisma.transaction.findMany({
      where: { referral: { partnerCompanyId: company.id } },
      select: { amountCents: true, commissionCents: true, status: true, paidAt: true },
    }),
  ]);

  const byStage: Record<string, number> = {};
  for (const l of leads) byStage[l.status] = (byStage[l.status] || 0) + 1;

  const collected = transactions.filter((t) => t.status === 'COMPLETED');
  const collectedCents = collected.reduce((s, t) => s + t.amountCents, 0);
  const commissionAccruedCents = collected.reduce((s, t) => s + t.commissionCents, 0);
  const pendingCollectionCents = transactions
    .filter((t) => t.status !== 'COMPLETED' && t.status !== 'REFUNDED' && t.status !== 'FAILED')
    .reduce((s, t) => s + t.amountCents, 0);

  return NextResponse.json({
    success: true,
    company: { id: company.id, name: company.name, commissionRate: rate },
    kpis: {
      totalLeads: leads.length,
      byStage,
      activeDeals: (byStage['ACKNOWLEDGED'] || 0) + (byStage['INTRO_DONE'] || 0) + (byStage['NEGOTIATING'] || 0),
      wonDeals: byStage['WON'] || 0,
      collectedCents,
      commissionAccruedCents,
      pendingCollectionCents,
      // What the partner would owe us on uncollected pipeline value (informational).
      projectedCommissionCents: computeCommissionCents(pendingCollectionCents, rate),
    },
  });
}
