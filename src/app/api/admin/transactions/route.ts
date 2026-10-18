// Admin transactions.
// B2B trust model: a transaction records an invoice/expected payment.
// Commission accrues ONLY when money actually clears, via the collect
// endpoint (POST /api/admin/transactions/[id]/collect), which sets paidAt.
// paidAt is NEVER defaulted at creation.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAuditAction } from '@/lib/audit';
import {
  getCommissionRateForReferral,
  getTransactionAging,
} from '@/lib/partnership';

async function verifyAdmin(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return { error: 'Unauthorized', status: 401 as const };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
    return { error: 'Forbidden', status: 403 as const };
  }
  return { user };
}

// GET - Fetch all transactions (Admin only), with invoiced-vs-collected aging
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAdmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const referralId = searchParams.get('referralId');
    const affiliateId = searchParams.get('affiliateId');

    const where: any = {};
    if (referralId) where.referralId = referralId;
    if (affiliateId) where.affiliateId = affiliateId;

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        referral: true,
        affiliate: {
          include: {
            user: true,
            partnerGroup: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({
      success: true,
      transactions: transactions.map((txn: any) => {
        const affiliate = txn.affiliate as any;
        const aging = getTransactionAging(txn);
        return {
          id: txn.id,
          customerId: txn.customerId,
          customerName: txn.customerName,
          customerEmail: txn.customerEmail,
          amountCents: txn.amountCents,
          commissionCents: txn.commissionCents,
          commissionRate: txn.commissionRate,
          status: txn.status,
          description: txn.description,
          invoiceId: txn.invoiceId,
          invoiceDate: txn.invoiceDate,
          paymentMethod: txn.paymentMethod,
          paidAt: txn.paidAt,
          createdAt: txn.createdAt,
          // Invoiced-vs-collected aging (days). Commission accrues only when
          // status is COMPLETED (paidAt set).
          daysSinceInvoice: aging.daysSinceInvoice,
          collectionLagDays: aging.collectionLagDays,
          referral: {
            id: txn.referral.id,
            leadName: txn.referral.leadName,
            leadEmail: txn.referral.leadEmail,
            status: txn.referral.status,
          },
          affiliate: {
            id: affiliate.id,
            name: affiliate.user.name,
            email: affiliate.user.email,
            referralCode: affiliate.referralCode,
            partnerGroup: affiliate.partnerGroupId
              ? affiliate.partnerGroup?.name || 'Default'
              : 'Default',
          },
        };
      }),
    });
  } catch (error) {
    console.error('Get transactions API error:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}

// POST - Record a transaction (invoice/expected payment). Money is NOT
// considered collected here: status starts PENDING (or INVOICED when an
// invoice date is given), paidAt stays null, and NO commission accrues.
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAdmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const admin = auth.user;

    const body = await request.json();
    const { referralId, amount, description, invoiceId, invoiceDate, paymentMethod } = body;

    if (!referralId || !amount) {
      return NextResponse.json(
        { error: 'Referral ID and amount are required' },
        { status: 400 }
      );
    }

    const referral = await prisma.referral.findUnique({
      where: { id: referralId },
      include: {
        affiliate: { include: { partnerGroup: true } },
        partnerCompany: true,
      },
    });

    if (!referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }

    // Resolve the contracted rate now (informational); the collect endpoint
    // re-resolves the CURRENT rate when money clears.
    const commissionRate = getCommissionRateForReferral(referral as any);

    const amountCents = Math.floor(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
    }

    const transaction = await prisma.transaction.create({
      data: {
        referralId,
        affiliateId: referral.affiliateId,
        customerId: referral.subscriptionId,
        customerName: referral.leadName,
        customerEmail: referral.leadEmail,
        amountCents,
        commissionCents: 0, // accrues ONLY on collection
        commissionRate,
        status: invoiceDate ? 'INVOICED' : 'PENDING',
        description,
        invoiceId,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
        paymentMethod,
        paidAt: null, // set ONLY by the collect endpoint
        createdBy: admin.id,
      },
    });

    await logAuditAction({
      actorId: admin.id,
      action: 'transaction.created',
      objectType: 'Transaction',
      objectId: transaction.id,
      payload: {
        referralId,
        amountCents,
        status: transaction.status,
        invoiceId: invoiceId || null,
      },
    });

    return NextResponse.json(
      { success: true, transaction, message: 'Transaction recorded. No commission accrued until payment clears.' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create transaction API error:', error);
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
  }
}

// PUT - Update a transaction's descriptive fields. paidAt can NEVER be set
// here (use the collect endpoint). COMPLETED transactions are immutable
// (use the refund flow instead).
export async function PUT(request: NextRequest) {
  try {
    const auth = await verifyAdmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const admin = auth.user;

    const body = await request.json();
    const { id, status, description, invoiceId, invoiceDate, paymentMethod, paidAt } = body;

    if (!id) {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
    }
    if (paidAt !== undefined && paidAt !== null) {
      return NextResponse.json(
        { error: 'paidAt cannot be set directly. Use POST /api/admin/transactions/[id]/collect.' },
        { status: 400 }
      );
    }

    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }
    if (existing.status === 'COMPLETED') {
      return NextResponse.json(
        { error: 'Collected transactions are immutable. Use the refund flow to reverse.' },
        { status: 400 }
      );
    }

    if (status !== undefined && !['PENDING', 'INVOICED'].includes(status)) {
      return NextResponse.json(
        { error: "status can only be PENDING or INVOICED here (use collect/refund for the rest)" },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (description !== undefined) data.description = description;
    if (invoiceId !== undefined) data.invoiceId = invoiceId;
    if (invoiceDate !== undefined) data.invoiceDate = invoiceDate ? new Date(invoiceDate) : null;
    if (paymentMethod !== undefined) data.paymentMethod = paymentMethod;

    const transaction = await prisma.transaction.update({ where: { id }, data });

    await logAuditAction({
      actorId: admin.id,
      action: 'transaction.updated',
      objectType: 'Transaction',
      objectId: id,
      payload: { before: { status: existing.status }, after: data },
    });

    return NextResponse.json({ success: true, transaction, message: 'Transaction updated successfully' });
  } catch (error) {
    console.error('Update transaction API error:', error);
    return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 });
  }
}

// DELETE - Allowed only before money clears. COMPLETED transactions are
// immutable (use the refund flow). Deletions are audit-logged.
export async function DELETE(request: NextRequest) {
  try {
    const auth = await verifyAdmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const admin = auth.user;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
    }

    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }
    if (existing.status === 'COMPLETED') {
      await logAuditAction({
        actorId: admin.id,
        action: 'transaction.delete_blocked',
        objectType: 'Transaction',
        objectId: id,
        payload: { reason: 'Collected transactions are immutable' },
      });
      return NextResponse.json(
        { error: 'Gone: collected transactions are immutable. Use the refund flow to reverse.' },
        { status: 410 }
      );
    }

    await prisma.transaction.delete({ where: { id } });

    await logAuditAction({
      actorId: admin.id,
      action: 'transaction.deleted',
      objectType: 'Transaction',
      objectId: id,
      payload: { amountCents: existing.amountCents, status: existing.status },
    });

    return NextResponse.json({ success: true, message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Delete transaction API error:', error);
    return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
  }
}
