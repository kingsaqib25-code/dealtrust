'use client';

// Partner transactions view: invoiced vs collected money on their leads,
// with aging and the commission accrued at the contracted rate.
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Txn {
  id: string;
  description?: string | null;
  invoiceId?: string | null;
  amountCents: number;
  commissionCents: number;
  commissionRate: number;
  status: string;
  invoiceDate?: string | null;
  paidAt?: string | null;
  createdAt: string;
  daysSinceInvoice: number | null;
  collectionLagDays: number | null;
  referral: { leadName: string; leadEmail: string; status: string };
}

const fmt = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PartnerTransactions() {
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/partner/transactions', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setTxns(d.transactions);
      })
      .finally(() => setLoading(false));
  }, []);

  const collected = txns.filter((t) => t.status === 'COMPLETED')
    .reduce((s, t) => s + t.amountCents, 0);
  const commission = txns.filter((t) => t.status === 'COMPLETED')
    .reduce((s, t) => s + t.commissionCents, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Transactions</h1>
        <p className="text-sm text-muted-foreground">
          Collected {fmt(collected)} across {txns.length} transactions — commission accrued {fmt(commission)}.
          Commission accrues only when client money actually clears.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">All transactions on your leads</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : txns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Lead</th>
                    <th className="py-2 pr-4">Description</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Commission</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Invoice age</th>
                    <th className="py-2">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{t.referral.leadName}</div>
                        <div className="text-xs text-muted-foreground">{t.invoiceId || ''}</div>
                      </td>
                      <td className="py-3 pr-4">{t.description || '-'}</td>
                      <td className="py-3 pr-4 font-medium">{fmt(t.amountCents)}</td>
                      <td className="py-3 pr-4">
                        {fmt(t.commissionCents)}
                        <span className="text-xs text-muted-foreground"> ({(t.commissionRate * 100).toFixed(0)}%)</span>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={t.status === 'COMPLETED' ? 'default' : 'secondary'}>{t.status}</Badge>
                      </td>
                      <td className="py-3 pr-4 text-xs">
                        {t.daysSinceInvoice !== null ? `${t.daysSinceInvoice}d` : '-'}
                      </td>
                      <td className="py-3 text-xs">
                        {t.paidAt ? new Date(t.paidAt).toLocaleDateString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
