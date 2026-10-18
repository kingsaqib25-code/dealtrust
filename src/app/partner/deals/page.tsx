'use client';

// Partner deal pipeline: leads grouped by stage. Stage list will grow in
// work item 4 (full pipeline stages + history); this view reads them live.
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Lead {
  id: string;
  leadName: string;
  leadEmail: string;
  company: string;
  status: string;
  createdAt: string;
}

const STAGE_ORDER = ['REGISTERED', 'ACKNOWLEDGED', 'INTRO_DONE', 'NEGOTIATING', 'WON', 'LOST'];

export default function PartnerDeals() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/partner/referrals', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setLeads(d.referrals);
      })
      .finally(() => setLoading(false));
  }, []);

  const grouped: Record<string, Lead[]> = {};
  for (const l of leads) {
    grouped[l.status] = grouped[l.status] || [];
    grouped[l.status].push(l);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Deal Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Every stage change is timestamped and recorded — see the full history per lead.
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {STAGE_ORDER.map((stage) => (
            <Card key={stage}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm font-medium">
                  {stage.replace('_', ' ')}
                  <Badge variant="secondary">{(grouped[stage] || []).length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(grouped[stage] || []).map((l) => (
                  <div key={l.id} className="rounded-lg border p-3">
                    <div className="text-sm font-medium">{l.leadName}</div>
                    <div className="text-xs text-muted-foreground">{l.company || l.leadEmail}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Registered {new Date(l.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
                {(grouped[stage] || []).length === 0 && (
                  <p className="text-xs text-muted-foreground">Empty</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
