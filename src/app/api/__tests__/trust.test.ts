// Baseline trust-critical route tests (Prisma mocked).
// 1. Leads are immutable: DELETE /api/admin/referrals/[id] -> 410, never deletes.
// 2. Commission accrues ONLY on collection: transaction POST creates no
//    commission; the collect endpoint accrues exactly amount * rate.
// 3. Dedupe: registering the same lead email twice for a company -> 409.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = {
  user: { findUnique: vi.fn() },
  partnerCompany: { findUnique: vi.fn() },
  referral: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  referralStageHistory: { create: vi.fn() },
  transaction: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  programSettings: { findFirst: vi.fn() },
  conversion: { create: vi.fn() },
  commission: { create: vi.fn() },
  auditLog: { create: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/audit', () => ({ logAuditAction: vi.fn() }));

const adminUser = { id: 'admin1', role: 'ADMIN', status: 'ACTIVE' };
const affiliateUser = {
  id: 'aff1',
  role: 'AFFILIATE',
  status: 'ACTIVE',
  affiliate: { id: 'affRec1', userId: 'aff1', partnerGroupId: null },
};
const company = { id: 'comp1', name: 'Eco-Green', commissionRate: 0.3, status: 'ACTIVE' };

function req(url: string, method: string, body?: unknown, userId = 'admin1') {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(adminUser);
});

describe('lead immutability', () => {
  it('DELETE /api/admin/referrals/[id] returns 410 and never deletes', async () => {
    const { DELETE } = await import('@/app/api/admin/referrals/[id]/route');
    const res = await DELETE(
      req('http://x/api/admin/referrals/r1', 'DELETE'),
      { params: Promise.resolve({ id: 'r1' }) }
    );
    expect(res.status).toBe(410);
    expect(mockPrisma.referral.delete).not.toHaveBeenCalled();
    const { logAuditAction } = await import('@/lib/audit');
    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'referral.delete_blocked', objectId: 'r1' })
    );
  });
});

describe('dedupe on lead registration', () => {
  it('rejects a duplicate lead email for the same company with 409', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(affiliateUser);
    mockPrisma.partnerCompany.findUnique.mockResolvedValue(company);
    mockPrisma.referral.findFirst.mockResolvedValue({
      id: 'existing1',
      status: 'REGISTERED',
      createdAt: new Date(),
    });

    const { POST } = await import('@/app/api/affiliate/referrals/route');
    const res = await POST(
      req('http://x/api/affiliate/referrals', 'POST', {
        leadName: 'John Doe',
        leadEmail: 'john@example.com',
        partnerCompanyId: 'comp1',
      }, 'aff1')
    );
    expect(res.status).toBe(409);
    expect(mockPrisma.referral.create).not.toHaveBeenCalled();
  });

  it('registers a new lead as REGISTERED with normalized email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(affiliateUser);
    mockPrisma.partnerCompany.findUnique.mockResolvedValue(company);
    mockPrisma.referral.findFirst.mockResolvedValue(null);
    mockPrisma.referral.create.mockImplementation(async ({ data }: any) => ({ id: 'new1', ...data }));
    mockPrisma.referralStageHistory.create.mockResolvedValue({});

    const { POST } = await import('@/app/api/affiliate/referrals/route');
    const res = await POST(
      req('http://x/api/affiliate/referrals', 'POST', {
        leadName: 'Jane Doe',
        leadEmail: 'Jane@Example.COM',
        partnerCompanyId: 'comp1',
      }, 'aff1')
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockPrisma.referral.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadEmail: 'jane@example.com', // normalized
          status: 'REGISTERED',
          partnerCompanyId: 'comp1',
        }),
      })
    );
    // stage history seeded (null -> REGISTERED)
    expect(mockPrisma.referralStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStage: null, toStage: 'REGISTERED' }),
      })
    );
  });
});

describe('commission on collected revenue only', () => {
  const referralRow = {
    id: 'ref1',
    affiliateId: 'affRec1',
    affiliate: { userId: 'aff1', partnerGroup: null },
    partnerCompany: { commissionRate: 0.3 },
  };

  it('transaction POST records PENDING with paidAt=null and accrues nothing', async () => {
    mockPrisma.referral.findUnique.mockResolvedValue(referralRow);
    mockPrisma.transaction.create.mockImplementation(async ({ data }: any) => ({ id: 't1', ...data }));

    const { POST } = await import('@/app/api/admin/transactions/route');
    const res = await POST(
      req('http://x/api/admin/transactions', 'POST', {
        referralId: 'ref1',
        amount: 10000, // $10,000
        description: 'Website build',
      })
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          paidAt: null, // NEVER defaulted
          commissionCents: 0, // accrues only on collection
        }),
      })
    );
    expect(mockPrisma.commission.create).not.toHaveBeenCalled();
    expect(mockPrisma.conversion.create).not.toHaveBeenCalled();
  });

  it('collect accrues exactly 30% commission and stamps paidAt', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: 't1',
      status: 'PENDING',
      amountCents: 1_000_000, // $10,000
      affiliateId: 'affRec1',
      referralId: 'ref1',
      referral: referralRow,
    });
    mockPrisma.programSettings.findFirst.mockResolvedValue({ commissionHoldDays: 30 });
    mockPrisma.transaction.update.mockImplementation(async ({ data }: any) => ({ id: 't1', ...data }));
    mockPrisma.conversion.create.mockResolvedValue({ id: 'conv1' });
    mockPrisma.commission.create.mockImplementation(async ({ data }: any) => ({ id: 'com1', ...data }));
    mockPrisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'admin1' ? adminUser : null // no affiliate user -> skip email
    );

    const { POST } = await import('@/app/api/admin/transactions/[id]/collect/route');
    const res = await POST(
      req('http://x/api/admin/transactions/t1/collect', 'POST'),
      { params: Promise.resolve({ id: 't1' }) }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // paidAt stamped (not null), status COMPLETED
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          commissionCents: 300_000, // 30% of $10,000
          commissionRate: 0.3,
        }),
      })
    );
    const updateData = mockPrisma.transaction.update.mock.calls[0][0].data;
    expect(updateData.paidAt).toBeInstanceOf(Date);
    // commission accrued exactly once, on the collected amount
    expect(mockPrisma.commission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountCents: 300_000, rate: 0.3, status: 'PENDING' }),
      })
    );
  });

  it('collect on an already-collected transaction is rejected (no double accrual)', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: 't1',
      status: 'COMPLETED',
      paidAt: new Date(),
      amountCents: 1_000_000,
      referral: referralRow,
    });

    const { POST } = await import('@/app/api/admin/transactions/[id]/collect/route');
    const res = await POST(
      req('http://x/api/admin/transactions/t1/collect', 'POST'),
      { params: Promise.resolve({ id: 't1' }) }
    );
    expect(res.status).toBe(409);
    expect(mockPrisma.commission.create).not.toHaveBeenCalled();
    expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
  });
});
