// POST /api/admin/transactions/[id]/collect
// Marks client money as actually CLEARED. This is the ONLY place where
// paidAt is set and the ONLY place where commission accrues.
//
// Flow: PENDING/INVOICED -> COMPLETED (paidAt = now), then
//   commissionCents = amountCents * contracted rate (company -> group -> 30%)
//   + Conversion (APPROVED) + Commission (PENDING, matures per hold days)
// so the existing mature -> approve -> payout flow picks it up.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAuditAction } from '@/lib/audit';
import {
  getCommissionRateForReferral,
  computeCommissionCents,
} from '@/lib/partnership';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const admin = await prisma.user.findUnique({ where: { id: userId } });
    if (!admin || admin.role !== 'ADMIN' || admin.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await context.params;

    const transaction = await prisma.transaction.findUnique({
      where: { id },
      include: {
        referral: {
          include: {
            affiliate: { include: { partnerGroup: true } },
            partnerCompany: true,
          },
        },
      },
    });

    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }
    if (transaction.status === 'COMPLETED') {
      return NextResponse.json(
        { error: 'Transaction is already collected', transaction },
        { status: 409 }
      );
    }
    if (!['PENDING', 'INVOICED'].includes(transaction.status)) {
      return NextResponse.json(
        { error: `Only PENDING/INVOICED transactions can be collected (current: ${transaction.status})` },
        { status: 409 }
      );
    }

    // Resolve the CURRENT contracted rate: company -> partner group -> 30%.
    const rate = getCommissionRateForReferral(transaction.referral as any);
    const commissionCents = computeCommissionCents(transaction.amountCents, rate);
    const collectedAt = new Date();

    // Commission hold period (existing mature flow consumes maturesAt).
    const settings = await prisma.programSettings.findFirst();
    const holdDays = settings?.commissionHoldDays ?? 30;
    const maturesAt = new Date(collectedAt.getTime() + holdDays * 86400000);

    const updated = await prisma.transaction.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        paidAt: collectedAt,
        commissionRate: rate,
        commissionCents,
      },
    });

    // Record the collection as a conversion for downstream reporting.
    const conversion = await prisma.conversion.create({
      data: {
        affiliateId: transaction.affiliateId,
        referralId: transaction.referralId,
        eventType: 'PURCHASE',
        amountCents: transaction.amountCents,
        status: 'APPROVED',
        currency: 'USD',
        eventMetadata: {
          transactionId: transaction.id,
          collectedAt: collectedAt.toISOString(),
          commissionCents,
          commissionRate: rate,
        },
      },
    });

    // Accrue the commission. Status PENDING + maturesAt feeds the existing
    // /api/admin/commissions/mature cron flow, then payouts as usual.
    const commission = await prisma.commission.create({
      data: {
        affiliateId: transaction.affiliateId,
        conversionId: conversion.id,
        userId: transaction.referral.affiliate.userId,
        rate,
        amountCents: commissionCents,
        status: 'PENDING',
        maturesAt,
      },
    });

    await logAuditAction({
      actorId: admin.id,
      action: 'transaction.collected',
      objectType: 'Transaction',
      objectId: transaction.id,
      payload: {
        amountCents: transaction.amountCents,
        commissionCents,
        commissionRate: rate,
        paidAt: collectedAt.toISOString(),
        commissionId: commission.id,
      },
    });

    // Notify the referrer (us) that money cleared and commission accrued.
    try {
      const affiliateUser = await prisma.user.findUnique({
        where: { id: transaction.referral.affiliate.userId },
      });
      if (affiliateUser?.email) {
        const { emailService } = await import('@/lib/email');
        await emailService.sendTransactionCreatedEmail(affiliateUser.email, {
          affiliateName: affiliateUser.name || 'Partner',
          customerName: transaction.referral.leadName,
          amountCents: transaction.amountCents,
          commissionCents,
          commissionRate: rate,
          transactionId: transaction.id,
        });
      }
    } catch (emailError) {
      console.error('Failed to send collection email:', emailError);
    }

    return NextResponse.json({
      success: true,
      message: 'Payment collected. Commission accrued.',
      transaction: updated,
      commission: { id: commission.id, amountCents: commissionCents, rate, maturesAt },
    });
  } catch (error) {
    console.error('Collect transaction API error:', error);
    return NextResponse.json({ error: 'Failed to collect transaction' }, { status: 500 });
  }
}
