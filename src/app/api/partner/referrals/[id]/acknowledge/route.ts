// POST /api/partner/referrals/[id]/acknowledge
// The partner company's written confirmation of a REGISTERED lead.
// Moves REGISTERED -> ACKNOWLEDGED. Scoped: only the owning company.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePartnerCompany, transitionReferralStage } from '@/lib/partnership';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const userId = request.headers.get('x-user-id');
  const scope = await requirePartnerCompany(userId);
  if ('error' in scope) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }
  const company = scope.company;
  const { id } = await context.params;

  // Scope check: the lead must belong to THIS company.
  const referral = await prisma.referral.findFirst({
    where: { id, partnerCompanyId: company.id },
  });
  if (!referral) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const updated = await transitionReferralStage({
      referralId: id,
      toStage: 'ACKNOWLEDGED',
      actorId: userId!,
      note: body?.note || 'Acknowledged by partner company',
    });
    return NextResponse.json({
      success: true,
      message: 'Lead acknowledged',
      referral: { id: updated.id, status: updated.status },
    });
  } catch (err: any) {
    const msg = err?.message || 'Failed to acknowledge lead';
    const status = msg.startsWith('Invalid stage transition') ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
