'use client';

// Partner leads view: every lead registered FOR this company, with the
// immutable registration timestamp and an in-system Acknowledge action.
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Lead {
  id: string;
  leadName: string;
  leadEmail: string;
  leadPhone?: string | null;
  company: string;
  estimatedValue: number;
  notes?: string | null;
  status: string;
  createdAt: string;
  acknowledgedAt?: string | null;
}

const stageVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  REGISTERED: 'secondary',
  ACKNOWLEDGED: 'default',
  WON: 'default',
  LOST: 'outline',
};

export default function PartnerLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch('/api/partner/referrals', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setLeads(d.referrals);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const acknowledge = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/partner/referrals/${id}/acknowledge`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Registered Leads</h1>
        <p className="text-sm text-muted-foreground">
          Leads are immutable once registered. The registration timestamp is the proof of attribution.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">All leads for your company</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leads registered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Lead</th>
                    <th className="py-2 pr-4">Company</th>
                    <th className="py-2 pr-4">Registered</th>
                    <th className="py-2 pr-4">Stage</th>
                    <th className="py-2 pr-4">Est. value</th>
                    <th className="py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{l.leadName}</div>
                        <div className="text-xs text-muted-foreground">{l.leadEmail}</div>
                      </td>
                      <td className="py-3 pr-4">{l.company || '-'}</td>
                      <td className="py-3 pr-4 text-xs">
                        {new Date(l.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={stageVariant[l.status] || 'outline'}>{l.status}</Badge>
                      </td>
                      <td className="py-3 pr-4">
                        {l.estimatedValue ? `$${l.estimatedValue.toLocaleString()}` : '-'}
                      </td>
                      <td className="py-3">
                        {l.status === 'REGISTERED' ? (
                          <Button
                            size="sm"
                            disabled={busy === l.id}
                            onClick={() => acknowledge(l.id)}
                          >
                            {busy === l.id ? 'Working...' : 'Acknowledge'}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {l.acknowledgedAt
                              ? `Acked ${new Date(l.acknowledgedAt).toLocaleDateString()}`
                              : '-'}
                          </span>
                        )}
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
