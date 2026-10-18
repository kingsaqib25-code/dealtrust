// Admin: PartnerCompany detail + update, and inviting partner users.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAuditAction } from '@/lib/audit';
import { auth as authService } from '@/lib/auth';

async function verifyAdmin(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return { error: 'Unauthorized', status: 401 as const };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
    return { error: 'Forbidden', status: 403 as const };
  }
  return { user };
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await verifyAdmin(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { id } = await context.params;

  const company = await prisma.partnerCompany.findUnique({
    where: { id },
    include: {
      users: { select: { id: true, name: true, email: true, status: true, createdAt: true } },
      _count: { select: { referrals: true } },
    },
  });

  if (!company) {
    return NextResponse.json({ error: 'Partner company not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, company });
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await verifyAdmin(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const admin = auth.user;
  const { id } = await context.params;

  const existing = await prisma.partnerCompany.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Partner company not found' }, { status: 404 });
  }

  const body = await request.json();
  const { name, contactName, contactEmail, commissionRate, status } = body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = String(name).trim();
  if (contactName !== undefined) data.contactName = contactName ? String(contactName).trim() : null;
  if (contactEmail !== undefined) {
    data.contactEmail = contactEmail ? String(contactEmail).toLowerCase().trim() : null;
  }
  if (commissionRate !== undefined && commissionRate !== null) {
    const n = Number(commissionRate);
    if (Number.isNaN(n) || n <= 0 || n > 100) {
      return NextResponse.json({ error: 'Invalid commissionRate' }, { status: 400 });
    }
    data.commissionRate = n > 1 ? n / 100 : n;
  }
  if (status !== undefined) {
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      return NextResponse.json({ error: 'status must be ACTIVE or SUSPENDED' }, { status: 400 });
    }
    data.status = status;
  }

  const company = await prisma.partnerCompany.update({ where: { id }, data });

  await logAuditAction({
    actorId: admin.id,
    action: 'partner_company.updated',
    objectType: 'PartnerCompany',
    objectId: company.id,
    payload: { before: { commissionRate: existing.commissionRate, status: existing.status }, after: data },
  });

  return NextResponse.json({ success: true, company });
}

// POST /api/admin/partner-companies/[id]/users — invite a login for the company.
export async function POST(request: NextRequest, context: Ctx) {
  const auth = await verifyAdmin(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const admin = auth.user;
  const { id } = await context.params;

  const company = await prisma.partnerCompany.findUnique({ where: { id } });
  if (!company) {
    return NextResponse.json({ error: 'Partner company not found' }, { status: 404 });
  }

  const body = await request.json();
  const { name, email, password } = body;
  if (!name || !email || !password) {
    return NextResponse.json(
      { error: 'name, email and password are required' },
      { status: 400 }
    );
  }
  if (String(password).length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    );
  }

  const result = await authService.register({
    email: String(email).toLowerCase().trim(),
    password: String(password),
    name: String(name).trim(),
    role: 'partner_company',
    partnerCompanyId: company.id,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  // Invited partner users are active immediately (admin-driven invite).
  await prisma.user.update({
    where: { id: result.user!.id },
    data: { status: 'ACTIVE' },
  });

  await logAuditAction({
    actorId: admin.id,
    action: 'partner_company.user_invited',
    objectType: 'User',
    objectId: result.user!.id,
    payload: { companyId: company.id, email: result.user!.email },
  });

  const { password: _pw, ...safeUser } = result.user!;
  return NextResponse.json({ success: true, user: safeUser }, { status: 201 });
}
