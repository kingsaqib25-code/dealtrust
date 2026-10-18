// Partner portal: list leads registered FOR this company + acknowledge action.
// Acknowledge = the partner's written confirmation of a REGISTERED lead
// (moves it to ACKNOWLEDGED). Only the owning company can acknowledge.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePartnerCompany } from '@/lib/partnership';

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  const scope = await requirePartnerCompany(userId);
  if ('error' in scope) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }
  const company = scope.company;

  const { searchParams } = new URL(request.url);
  const stage = searchParams.get('stage');

  const referrals = await prisma.referral.findMany({
    where: {
      partnerCompanyId: company.id,
      ...(stage ? { status: stage as any } : {}),
    },
    include: {
      stageHistory: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    success: true,
    referrals: referrals.map((r: any) => ({
      id: r.id,
      leadName: r.leadName,
      leadEmail: r.leadEmail,
      leadPhone: r.leadPhone,
      company: (r.metadata as any)?.company || '',
      estimatedValue: Number((r.metadata as any)?.estimated_value) || 0,
      notes: r.notes,
      status: r.status,
      createdAt: r.createdAt, // immutable registration timestamp — the proof
      acknowledgedAt: r.reviewedAt,
      stageHistory: r.stageHistory.map((h: any) => ({
        fromStage: h.fromStage,
        toStage: h.toStage,
        actorId: h.actorId,
        note: h.note,
        createdAt: h.createdAt,
      })),
    })),
  });
}
