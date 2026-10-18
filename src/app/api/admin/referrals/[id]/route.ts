import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAuditAction } from '@/lib/audit';
import { transitionReferralStage, type DealStage } from '@/lib/partnership';


export async function PUT(
  request: NextRequest, 
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const userId = request.headers.get('x-user-id')!;
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action, reviewNotes } = body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action' },
        { status: 400 }
      );
    }

    const referral = await prisma.referral.findUnique({
      where: { id: params.id },
      include: {
        affiliate: {
          include: { partnerGroup: true }
        }
      }
    });

    if (!referral) {
      return NextResponse.json(
        { error: 'Referral not found' },
        { status: 404 }
      );
    }

    // Get estimated value from referral metadata
    const metadata = referral.metadata as Record<string, any> || {};
    const estimatedValueCents = Number(metadata?.estimated_value) * 100 || 10000;

    // B2B pipeline: approve/reject are validated stage transitions
    // (REGISTERED -> ACKNOWLEDGED / any -> LOST) with history + audit.
    const toStage = (action === 'approve' ? 'ACKNOWLEDGED' : 'LOST') as DealStage;
    let updatedReferral;
    try {
      updatedReferral = await transitionReferralStage({
        referralId: params.id,
        toStage,
        actorId: user.id,
        note: reviewNotes || (action === 'approve' ? 'Approved by admin' : 'Rejected by admin'),
      });
    } catch (err: any) {
      const msg = err?.message || 'Failed to process referral';
      const status = msg.startsWith('Invalid stage transition') ? 409 : 400;
      return NextResponse.json({ error: msg }, { status });
    }

    // B2B item 3: commission accrues ONLY when client money actually clears
    // (via the transaction collect endpoint). Approving a lead no longer
    // creates conversions/commissions on estimated value.

    return NextResponse.json({
      success: true,
      message: `Referral moved to ${toStage} successfully`,
      referral: updatedReferral
    });

  } catch (error) {
    console.error('Referral approval error:', error);
    return NextResponse.json(
      { error: 'Failed to process referral' },
      { status: 500 }
    );
  }
}

// Add PATCH method for updating referral/customer details
export async function PATCH(
  request: NextRequest, 
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const userId = request.headers.get('x-user-id')!;
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action, leadName, leadEmail, status, reviewNotes } = body;

    // Check if referral exists
    const referral = await prisma.referral.findUnique({
      where: { id: params.id },
      include: { affiliate: { include: { partnerGroup: true } } }
    });

    if (!referral) {
      return NextResponse.json(
        { error: 'Referral not found' },
        { status: 404 }
      );
    }

    // If action is provided, handle approve/reject as pipeline transitions.
    if (action && ['approve', 'reject'].includes(action)) {
      const toStage = (action === 'approve' ? 'ACKNOWLEDGED' : 'LOST') as DealStage;
      let updatedReferral;
      try {
        updatedReferral = await transitionReferralStage({
          referralId: params.id,
          toStage,
          actorId: user.id,
          note: reviewNotes || (action === 'approve' ? 'Approved by admin' : 'Rejected by admin'),
        });
      } catch (err: any) {
        const msg = err?.message || 'Failed to process referral';
        const httpStatus = msg.startsWith('Invalid stage transition') ? 409 : 400;
        return NextResponse.json({ error: msg }, { status: httpStatus });
      }

      // B2B item 3: commission accrues ONLY when client money actually clears
      // (via the transaction collect endpoint) — never on estimated value.

      return NextResponse.json({
        success: true,
        message: `Referral moved to ${toStage} successfully`,
        referral: updatedReferral
      });
    }

    // Otherwise, handle customer detail updates
    const updateData: any = {};

    if (leadName !== undefined) updateData.leadName = leadName;
    if (leadEmail !== undefined) {
      const normalized = leadEmail.toLowerCase().trim();
      // B2B dedupe guard: renaming a lead onto an already-registered email
      // for the same company is blocked (would violate the unique index).
      if (normalized !== referral.leadEmail) {
        const clash = await prisma.referral.findFirst({
          where: {
            id: { not: params.id },
            partnerCompanyId: referral.partnerCompanyId,
            leadEmail: normalized,
          },
          select: { id: true },
        });
        if (clash) {
          return NextResponse.json(
            { error: 'Another lead with this email is already registered for the same company' },
            { status: 409 }
          );
        }
      }
      updateData.leadEmail = normalized;
    }
    // B2B pipeline: explicit stage moves go through validated transitions
    // (history + audit). Field edits (name/email) stay a direct update.
    let updatedReferral;
    if (status !== undefined) {
      const toStage = String(status).toUpperCase() as DealStage;
      try {
        updatedReferral = await transitionReferralStage({
          referralId: params.id,
          toStage,
          actorId: user.id,
          note: reviewNotes || 'Stage updated by admin',
        });
      } catch (err: any) {
        const msg = err?.message || 'Failed to update stage';
        const httpStatus = msg.startsWith('Invalid stage transition') ? 409 : 400;
        return NextResponse.json({ error: msg }, { status: httpStatus });
      }
      // Apply any simultaneous field edits on top of the transition.
      if (updateData.leadName !== undefined || updateData.leadEmail !== undefined) {
        updatedReferral = await prisma.referral.update({
          where: { id: params.id },
          data: {
            ...(updateData.leadName !== undefined ? { leadName: updateData.leadName } : {}),
            ...(updateData.leadEmail !== undefined ? { leadEmail: updateData.leadEmail } : {}),
          },
        });
      }
    } else {
      updatedReferral = await prisma.referral.update({
        where: { id: params.id },
        data: updateData
      });
    }

    // Tamper-evident: every lead edit is audit-logged with before/after.
    await logAuditAction({
      actorId: user.id,
      action: 'referral.updated',
      objectType: 'Referral',
      objectId: params.id,
      payload: {
        before: {
          leadName: referral.leadName,
          leadEmail: referral.leadEmail,
          status: referral.status,
        },
        after: {
          leadName: updatedReferral.leadName,
          leadEmail: updatedReferral.leadEmail,
          status: updatedReferral.status,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Customer updated successfully',
      referral: updatedReferral
    });

  } catch (error) {
    console.error('Update referral error:', error);
    return NextResponse.json(
      { error: 'Failed to update referral' },
      { status: 500 }
    );
  }
}

// DELETE is BLOCKED: leads are immutable (B2B item 2). A referral is the
// timestamped proof of attribution and must never be deletable — by API,
// by admin UI, or by cascade (schema uses onDelete: Restrict).
// Deletion attempts are audit-logged.
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const userId = request.headers.get('x-user-id')!;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    await logAuditAction({
      actorId: user.id,
      action: 'referral.delete_blocked',
      objectType: 'Referral',
      objectId: params.id,
      payload: { reason: 'Leads are immutable and cannot be deleted' },
    });

    return NextResponse.json(
      { error: 'Gone: referrals (leads) are immutable and cannot be deleted' },
      { status: 410 }
    );

  } catch (error) {
    console.error('Delete referral error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}