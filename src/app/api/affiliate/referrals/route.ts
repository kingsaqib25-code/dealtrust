import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAuditAction } from '@/lib/audit';

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!;

    // Get user from database

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        affiliate: true
      }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 401 }
      );
    }

    if (user.role !== 'AFFILIATE') {
      return NextResponse.json(
        { error: 'Access denied. Affiliate role required.' },
        { status: 403 }
      );
    }

    if (!user.affiliate) {
      return NextResponse.json(
        { error: 'Affiliate profile not found' },
        { status: 404 }
      );
    }

    const body = await request.json();

    // Validate with Zod
    const { success, data, error: validationError } = await import('@/lib/validations').then(m => m.referralSchema.safeParse(body));

    if (!success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validationError.issues },
        { status: 400 }
      );
    }

    const { leadName, leadEmail, company, notes, estimatedValue, partnerCompanyId } = data;

    const normalizedEmail = leadEmail.toLowerCase().trim();

    // B2B: every lead must be registered FOR a partner company.
    if (!partnerCompanyId) {
      return NextResponse.json(
        { error: 'partnerCompanyId is required' },
        { status: 400 }
      );
    }

    const partnerCompany = await prisma.partnerCompany.findUnique({
      where: { id: partnerCompanyId },
    });
    if (!partnerCompany || partnerCompany.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Partner company not found or not active' },
        { status: 400 }
      );
    }

    // B2B dedupe: the same lead email cannot be registered twice for the same
    // partner company. The DB unique index is the final guard; this check
    // gives a clean 409 instead of a constraint error.
    const existing = await prisma.referral.findFirst({
      where: {
        partnerCompanyId: partnerCompany.id,
        leadEmail: normalizedEmail,
      },
      select: { id: true, status: true, createdAt: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: 'This lead is already registered for this partner company',
          existingReferral: {
            id: existing.id,
            status: existing.status,
            registeredAt: existing.createdAt,
          },
        },
        { status: 409 }
      );
    }

    // Create the referral. createdAt is the immutable proof-of-registration
    // timestamp — leads are never deleted. Initial stage: REGISTERED.
    const referral = await prisma.referral.create({
      data: {
        affiliateId: user.affiliate.id,
        partnerCompanyId: partnerCompany.id,
        leadName: leadName.trim(),
        leadEmail: normalizedEmail,
        status: 'REGISTERED',
        metadata: {
          company: company || '',
          notes: notes || '',
          source: 'manual',
          estimated_value: estimatedValue || 0,
        },
      }
    });

    // Seed the append-only stage history (null -> REGISTERED).
    await prisma.referralStageHistory.create({
      data: {
        referralId: referral.id,
        fromStage: null,
        toStage: 'REGISTERED',
        actorId: user.id,
        note: 'Lead registered',
      },
    });

    // Tamper-evident: every lead registration is audit-logged (who/when/what).
    await logAuditAction({
      actorId: user.id,
      action: 'referral.registered',
      objectType: 'Referral',
      objectId: referral.id,
      payload: {
        leadName: referral.leadName,
        leadEmail: referral.leadEmail,
        partnerCompanyId: partnerCompany.id,
        partnerCompanyName: partnerCompany.name,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Referral submitted successfully',
      referral,
    });
  } catch (error) {
    console.error('Submit referral API error:', error);
    return NextResponse.json(
      { error: 'Failed to submit referral' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!;

    // Get user from database

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        affiliate: true
      }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 401 }
      );
    }

    if (user.role !== 'AFFILIATE') {
      return NextResponse.json(
        { error: 'Access denied. Affiliate role required.' },
        { status: 403 }
      );
    }

    if (!user.affiliate) {
      return NextResponse.json(
        { error: 'Affiliate profile not found' },
        { status: 404 }
      );
    }

    const referrals = await prisma.referral.findMany({
      where: { affiliateId: user.affiliate.id },
      orderBy: { createdAt: 'desc' }
    });

    // Map referrals to include estimatedValue from metadata
    const mappedReferrals = referrals.map((ref: any) => {
      const metadata = ref.metadata as any;
      return {
        ...ref,
        estimatedValue: Number(metadata?.estimated_value) || 0,
        company: metadata?.company || '',
      };
    });

    return NextResponse.json({
      success: true,
      referrals: mappedReferrals,
    });
  } catch (error) {
    console.error('Get referrals API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch referrals' },
      { status: 500 }
    );
  }
}