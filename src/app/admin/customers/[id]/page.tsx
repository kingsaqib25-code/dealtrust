'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  IndianRupee,
  User,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  Save,
  Link2,
  FileText,
  Shield,
  Loader2,
  Lock,
} from 'lucide-react';

interface Referral {
  id: string;
  leadEmail: string;
  leadName: string;
  leadPhone: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
  estimatedValue: number;
  company: string;
  affiliate: {
    id: string;
    name: string;
    email: string;
    referralCode: string;
    partnerGroup: string;
    partnerGroupId: string | null;
    commissionRate: number;
  };
  partnerCompany?: { id: string; name: string } | null;
  stageHistory?: {
    fromStage: string | null;
    toStage: string;
    actorId: string;
    note: string | null;
    createdAt: string;
  }[];
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ElementType }> = {
  REGISTERED: { label: 'Registered', variant: 'secondary', icon: Clock },
  ACKNOWLEDGED: { label: 'Acknowledged', variant: 'default', icon: CheckCircle2 },
  INTRO_DONE: { label: 'Intro Done', variant: 'default', icon: CheckCircle2 },
  NEGOTIATING: { label: 'Negotiating', variant: 'default', icon: Clock },
  WON: { label: 'Won', variant: 'default', icon: CheckCircle2 },
  LOST: { label: 'Lost', variant: 'destructive', icon: XCircle },
};

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [referral, setReferral] = useState<Referral | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Editable fields
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');

  useEffect(() => {
    fetchReferral();
  }, [id]);

  const fetchReferral = async () => {
    try {
      const res = await fetch('/api/admin/referrals');
      const data = await res.json();
      if (data.success) {
        const found = data.referrals.find((r: Referral) => r.id === id);
        if (found) {
          setReferral(found);
          setEditName(found.leadName);
          setEditEmail(found.leadEmail);
        }
      }
    } catch (error) {
      console.error('Failed to fetch referral:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/referrals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadName: editName,
          leadEmail: editEmail,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        await fetchReferral();
      }
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (action: 'approve' | 'reject') => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/referrals/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewNotes: reviewNotes || undefined }),
      });
      if (res.ok) {
        await fetchReferral();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Action failed');
      }
    } catch (error) {
      console.error('Failed:', error);
    } finally {
      setActionLoading(false);
    }
  };

  // B2B pipeline: move the lead to any allowed next stage.
  const NEXT_STAGES: Record<string, string[]> = {
    REGISTERED: ['ACKNOWLEDGED', 'LOST'],
    ACKNOWLEDGED: ['INTRO_DONE', 'LOST'],
    INTRO_DONE: ['NEGOTIATING', 'LOST'],
    NEGOTIATING: ['WON', 'LOST'],
    WON: [],
    LOST: [],
  };

  const handleStageChange = async (toStage: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/referrals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: toStage, reviewNotes: reviewNotes || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await fetchReferral();
      } else {
        alert(data.error || 'Stage change failed');
      }
    } catch (error) {
      console.error('Failed:', error);
    } finally {
      setActionLoading(false);
    }
  };

  // NOTE: leads are immutable — the delete action was removed (B2B item 2).
  // The API returns 410 Gone for DELETE /api/admin/referrals/[id].

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <Skeleton className="h-[400px] md:col-span-2" />
          <Skeleton className="h-[400px]" />
        </div>
      </div>
    );
  }

  if (!referral) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.push('/admin/customers')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Customers
        </Button>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <User className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">Customer not found</h3>
          <p className="text-sm text-muted-foreground">This referral lead may have been deleted</p>
        </div>
      </div>
    );
  }

  const cfg = statusConfig[referral.status] || statusConfig.REGISTERED;
  const StatusIcon = cfg.icon;
  const estimatedCommission = Math.round(referral.estimatedValue * referral.affiliate.commissionRate);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/admin/customers')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary/10 text-lg">
                {referral.leadName?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{referral.leadName}</h1>
              <p className="text-sm text-muted-foreground">{referral.leadEmail}</p>
            </div>
          </div>
          <Badge variant={cfg.variant} className="ml-2">
            <StatusIcon className="mr-1 h-3 w-3" />
            {cfg.label}
          </Badge>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-muted bg-muted/40 px-3 py-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Protected lead — immutable record, cannot be deleted
          </span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Left Column - Details & Edit */}
        <div className="space-y-6 md:col-span-2">
          {/* Lead Details Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Lead Details
                  </CardTitle>
                  <CardDescription>View and edit customer information</CardDescription>
                </div>
                <Button onClick={handleSave} disabled={saving} size="sm">
                  {saved ? (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                      Saved
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      {saving ? 'Saving...' : 'Save'}
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="leadName">Full Name</Label>
                  <Input
                    id="leadName"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="leadEmail">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="leadEmail"
                      type="email"
                      className="pl-9"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Phone</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-9" value={referral.leadPhone || '—'} readOnly disabled />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Company</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-9" value={referral.company || '—'} readOnly disabled />
                  </div>
                </div>
              </div>
              {referral.notes && (
                <div className="grid gap-2">
                  <Label>Notes</Label>
                  <div className="rounded-md border bg-muted/50 p-3 text-sm">{referral.notes}</div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Review Actions Card - only for REGISTERED */}
          {referral.status === 'REGISTERED' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Review Lead
                </CardTitle>
                <CardDescription>Approve or reject this referral lead</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="reviewNotes">Review Notes (optional)</Label>
                  <Textarea
                    id="reviewNotes"
                    placeholder="Add notes about this review decision..."
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="flex gap-3">
                  <Button
                    onClick={() => handleAction('approve')}
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Approve Lead
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleAction('reject')}
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="mr-2 h-4 w-4" />
                    )}
                    Reject Lead
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column - Sidebar Info */}
        <div className="space-y-6">
          {/* Value Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Financial Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Estimated Value</span>
                <span className="flex items-center gap-1 font-semibold">
                  <IndianRupee className="h-3.5 w-3.5" />
                  {referral.estimatedValue.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Commission Rate</span>
                <span className="font-semibold">{(referral.affiliate.commissionRate * 100).toFixed(0)}%</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Est. Commission</span>
                <span className="flex items-center gap-1 text-lg font-bold text-primary">
                  <IndianRupee className="h-4 w-4" />
                  {estimatedCommission.toLocaleString('en-IN')}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Referring Partner Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Referring Partner
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="text-xs bg-blue-100 text-blue-700">
                    {referral.affiliate.name?.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">{referral.affiliate.name}</p>
                  <p className="text-xs text-muted-foreground">{referral.affiliate.email}</p>
                </div>
              </div>
              <Separator />
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Referral Code</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                    {referral.affiliate.referralCode}
                  </code>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Partner Group</span>
                  <Badge variant="outline" className="text-xs">{referral.affiliate.partnerGroup}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* B2B Pipeline: advance the lead through validated stages */}
          {(NEXT_STAGES[referral.status] || []).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Deal Pipeline</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  Current stage: <strong>{referral.status.replace('_', ' ')}</strong>. Every move is
                  timestamped and recorded.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(NEXT_STAGES[referral.status] || []).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={s === 'LOST' ? 'destructive' : 'outline'}
                      disabled={actionLoading}
                      onClick={() => handleStageChange(s)}
                    >
                      Move to {s.replace('_', ' ')}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Timeline Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-blue-100 p-1">
                    <FileText className="h-3 w-3 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Lead Submitted</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(referral.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                      {' at '}
                      {new Date(referral.createdAt).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
                {/* B2B: append-only stage history — every transition, who/when */}
                {(referral.stageHistory || []).map((h, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-full bg-muted p-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {h.fromStage ? `${h.fromStage.replace('_', ' ')} → ` : ''}
                        {h.toStage.replace('_', ' ')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(h.createdAt).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {h.note ? ` — ${h.note}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 rounded-full p-1 ${
                    referral.status === 'WON'
                      ? 'bg-green-100'
                      : referral.status === 'LOST'
                        ? 'bg-red-100'
                        : 'bg-yellow-100'
                  }`}>
                    <StatusIcon className={`h-3 w-3 ${
                      referral.status === 'WON'
                        ? 'text-green-600'
                        : referral.status === 'LOST'
                          ? 'text-red-600'
                          : 'text-yellow-600'
                    }`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {cfg.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {referral.status === 'REGISTERED'
                        ? 'Needs partner acknowledgment'
                        : 'Stage recorded with timestamp'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
