// Partner portal: money transparency — transactions on this company's leads.
// Read-only. Shows invoiced vs collected amounts and accrued commission.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePartnerCompany } from '@/lib/partnership';

function daysBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  const scope = await requirePartnerCompany(userId);
  if ('error' in scope) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }
  const company = scope.company;

  const transactions = await prisma.transaction.findMany({
    where: { referral: { partnerCompanyId: company.id } },
    include: { referral: { select: { id: true, leadName: true, leadEmail: true, status: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const now = new Date();
  return NextResponse.json({
    success: true,
    transactions: transactions.map((t: any) => ({
      id: t.id,
      description: t.description,
      invoiceId: t.invoiceId,
      amountCents: t.amountCents,
      commissionCents: t.commissionCents,
      commissionRate: t.commissionRate,
      status: t.status,
      invoiceDate: t.invoiceDate,
      paidAt: t.paidAt,
      createdAt: t.createdAt,
      // Invoiced-vs-collected aging (days).
      daysSinceInvoice: daysBetween(t.invoiceDate, t.status === 'COMPLETED' ? t.paidAt : now),
      collectionLagDays: daysBetween(t.invoiceDate, t.paidAt),
      referral: t.referral,
    })),
  });
}
