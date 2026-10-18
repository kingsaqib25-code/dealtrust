// Affiliate (referrer): list ACTIVE partner companies to register a lead for.
// Minimal fields only — the referrer picks the company at registration time.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || (user.role !== 'AFFILIATE' && user.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const companies = await prisma.partnerCompany.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ success: true, companies });
}
