// Admin: PartnerCompany CRUD (list + create).
// Partner companies are the B2B clients that receive referred leads.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAuditAction } from '@/lib/audit';

async function verifyAdmin(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return { error: 'Unauthorized', status: 401 as const };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
    return { error: 'Forbidden', status: 403 as const };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  const auth = await verifyAdmin(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const companies = await prisma.partnerCompany.findMany({
    include: {
      _count: { select: { referrals: true, users: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, companies });
}

export async function POST(request: NextRequest) {
  const auth = await verifyAdmin(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const admin = auth.user;

  const body = await request.json();
  const { name, contactName, contactEmail, commissionRate } = body;

  if (!name || !String(name).trim()) {
    return NextResponse.json(
      { error: 'Company name is required' },
      { status: 400 }
    );
  }

  // commissionRate is a fraction (0.30 = 30%). Accept percent scale too.
  let rate = 0.30;
  if (commissionRate !== undefined && commissionRate !== null) {
    const n = Number(commissionRate);
    if (Number.isNaN(n) || n <= 0 || n > 100) {
      return NextResponse.json(
        { error: 'commissionRate must be a positive number (fraction like 0.30 or percent like 30)' },
        { status: 400 }
      );
    }
    rate = n > 1 ? n / 100 : n;
  }

  const company = await prisma.partnerCompany.create({
    data: {
      name: String(name).trim(),
      contactName: contactName ? String(contactName).trim() : null,
      contactEmail: contactEmail ? String(contactEmail).toLowerCase().trim() : null,
      commissionRate: rate,
    },
  });

  await logAuditAction({
    actorId: admin.id,
    action: 'partner_company.created',
    objectType: 'PartnerCompany',
    objectId: company.id,
    payload: { name: company.name, commissionRate: rate },
  });

  return NextResponse.json({ success: true, company }, { status: 201 });
}
