import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAuditAction } from '@/lib/audit';
import { transitionReferralStage, type DealStage } from '@/lib/partnership';


export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!;
    
    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 401 }
      );
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Access denied. Admin role required.' },
        { status: 403 }
      );
    }

    // Get all referrals with affiliate information
    const referrals = await prisma.referral.findMany({
      include: {
        affiliate: {
          include: {
            user: true
          }
        },
        partnerCompany: {
          select: { id: true, name: true }
        },
        stageHistory: {
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    // Get all partner groups for commission rate lookup
    const partnerGroups = await prisma.partnerGroup.findMany();
    const partnerGroupMap = new Map(
      partnerGroups.map(pg => [pg.id, { name: pg.name, rate: pg.commissionRate }])
    );

    return NextResponse.json({
      success: true,
      referrals: referrals.map(referral => {
        const metadata = referral.metadata as any;
        const affiliate = referral.affiliate as any;
        const pgId = affiliate.partnerGroupId;
        const pgData = pgId ? partnerGroupMap.get(pgId) : null;
        const rAny = referral as any;
        const history = Array.isArray(rAny.stageHistory) ? rAny.stageHistory : [];

        return {
          id: referral.id,
          leadEmail: referral.leadEmail,
          leadName: referral.leadName,
          leadPhone: referral.leadPhone,
          status: referral.status,
          notes: referral.notes,
          createdAt: referral.createdAt,
          estimatedValue: Number(metadata?.estimated_value) || 0,
          company: metadata?.company || '',
          partnerCompany: rAny.partnerCompany || null,
          stageHistory: history.map((h: any) => ({
            fromStage: h.fromStage,
            toStage: h.toStage,
            actorId: h.actorId,
            note: h.note,
            createdAt: h.createdAt,
          })),
          affiliate: {
            id: affiliate.id,
            name: affiliate.user.name,
            email: affiliate.user.email,
            referralCode: affiliate.referralCode,
            partnerGroup: pgData?.name || 'Default',
            partnerGroupId: pgId,
            commissionRate: pgData?.rate || 0.20
          }
        };
      })
    });

  } catch (error) {
    console.error('Admin referrals API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch referrals' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!;
    
    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 401 }
      );
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Access denied. Admin role required.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { referralIds, action } = body; // action: 'approve' | 'reject'

    if (!referralIds || !Array.isArray(referralIds) || referralIds.length === 0) {
      return NextResponse.json(
        { error: 'Referral IDs array is required' },
        { status: 400 }
      );
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    // B2B pipeline: approve/reject are stage transitions with validation,
    // per-lead history, and audit logging (no bulk updateMany — each lead's
    // transition is validated and recorded individually).
    const toStage: DealStage = action === 'approve' ? 'ACKNOWLEDGED' : 'LOST';
    let updatedCount = 0;
    const skipped: string[] = [];

    for (const referralId of referralIds) {
      try {
        await transitionReferralStage({
          referralId,
          toStage,
          actorId: user.id,
          note: action === 'approve' ? 'Approved by admin' : 'Rejected by admin',
        });
        updatedCount++;
      } catch (err: any) {
        // Invalid transition (e.g. already terminal) or missing lead.
        skipped.push(referralId);
      }
    }

    await logAuditAction({
      actorId: user.id,
      action: action === 'approve' ? 'referral.batch_approved' : 'referral.batch_rejected',
      objectType: 'Referral',
      objectId: 'batch',
      payload: { toStage, requested: referralIds.length, updated: updatedCount, skipped },
    });

    return NextResponse.json({
      success: true,
      message: `${updatedCount} referrals moved to ${toStage}${skipped.length ? ` (${skipped.length} skipped: invalid transition)` : ''}`,
      updatedCount,
      skipped,
    });

  } catch (error) {
    console.error('Batch referral API error:', error);
    return NextResponse.json(
      { error: 'Failed to process referrals' },
      { status: 500 }
    );
  }
}