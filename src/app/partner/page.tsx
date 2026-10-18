'use client';

// Partner dashboard: KPIs scoped to the partner's own company.
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Kpis {
  totalLeads: number;
  byStage: Record<string, number>;
  activeDeals: number;
  wonDeals: number;
  collectedCents: number;
  commissionAccruedCents: number;
  pendingCollectionCents: number;
  projectedCommissionCents: number;
}

const fmt = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PartnerDashboard() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [company, setCompany] = useState<{ name: string; commissionRate: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/partner/dashboard', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setKpis(d.kpis);
          setCompany(d.company);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!kpis) return <p className="text-sm text-destructive">Failed to load dashboard.</p>;

  const cards: { title: string; value: string; sub?: string }[] = [
    { title: 'Total Leads Registered', value: String(kpis.totalLeads), sub: 'all time, timestamped' },
    { title: 'Active Deals', value: String(kpis.activeDeals), sub: 'acknowledged / intro / negotiating' },
    { title: 'Won Deals', value: String(kpis.wonDeals) },
    { title: 'Revenue Collected', value: fmt(kpis.collectedCents), sub: 'cleared client payments' },
    {
      title: 'Commission Accrued',
      value: fmt(kpis.commissionAccruedCents),
      sub: `at ${(company ? company.commissionRate * 100 : 30).toFixed(0)}% on collected revenue`,
    },
    { title: 'Awaiting Collection', value: fmt(kpis.pendingCollectionCents), sub: 'invoiced, not yet cleared' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Partnership Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {company?.name} — every figure below is computed from timestamped, auditable records.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{c.value}</div>
              {c.sub && <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Leads by Stage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(kpis.byStage).map(([stage, n]) => (
              <span key={stage} className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
                {stage}: {n}
              </span>
            ))}
            {Object.keys(kpis.byStage).length === 0 && (
              <p className="text-xs text-muted-foreground">No leads registered yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
