# Partnership Portal — Adaptation STATUS

Base: DealTrust v1.1.0 (MIT) — LICENSE kept intact at `LICENSE`.
Goal: adapt the affiliate-marketing codebase into a B2B referral-partnership portal
(AFFILIATE = the referrer/us; new PARTNER_COMPANY role = the client company receiving leads).

## Setup
- [x] Cloned https://github.com/DealTrust/DealTrust into `~/workspace/partnership-portal/dealtrust/`
- [x] `npm ci` — OK (deps installed)
- [x] `npx prisma generate` — OK
- Quirks:
  - `package.json` references `tsx prisma/seed.ts` (`db:seed`) but **no `prisma/seed.ts` exists** in the repo — seeding is broken upstream; not needed for our work.
  - Repo ships a stale `prisma/dev.db` (SQLite file) but schema provider is `postgresql` — dev.db is unused; ignored.
  - No live PostgreSQL in this environment (no docker); schema validated with `prisma validate`,
    `prisma generate`, and `prisma migrate diff --from-empty` (SQL generation check). No `db push` run.
  - Many routes use `(prisma as any).transaction` because the generated client in the repo snapshot
    predates the Transaction model — regenerating fixed typing; cleaned up opportunistically.

## Work items
- [x] 1. PARTNER-COMPANY ROLE + ENTITY — Role.PARTNER_COMPANY, PartnerCompany model
  (name/contact/commissionRate fraction default 0.30/status), User.partnerCompanyId,
  Referral.partnerCompanyId. Middleware guards /partner/* + /api/partner/* (partner or admin).
  /api/auth/me returns company context; register() supports partner_company invites.
  Admin APIs: partner-companies CRUD + invite user. Partner APIs: dashboard KPIs,
  referrals (+ acknowledge action), transactions (read-only). Partner portal UI:
  layout, dashboard, leads, deal pipeline, transactions. tsc clean. (No ESLint in repo;
  `next lint` was removed in Next 16 — tsc is the lint gate.)
- [x] 2. LEAD IMMUTABILITY + DEDUPE — onDelete: Cascade removed on all lead relations
  (Referral.affiliate, ReferralClick/Conversion/Transaction -> Referral now Restrict).
  Admin referral DELETE replaced with 410 Gone + audit-logged attempt. @@unique
  ([partnerCompanyId, leadEmail]) on Referral + 409 dedupe checks in affiliate
  registration and admin email-edit. Every registration/edit writes an audit log
  entry (who/when/before/after). tsc clean; SQL diff generates the unique index.
- [x] 3. COMMISSION-ON-COLLECTED REWORK — Transaction POST now records PENDING/INVOICED
  with paidAt ALWAYS null (never defaulted); new POST /api/admin/transactions/[id]/collect
  is the ONLY place paidAt is set and commission accrues (Conversion APPROVED + Commission
  PENDING with maturesAt per hold days, feeding the existing mature->payout flow). Rate
  resolved via getCommissionRateForReferral: company contract rate -> partner group -> 30%.
  Added invoiceDate + INVOICED status; GET exposes invoiced-vs-collected aging
  (daysSinceInvoice, collectionLagDays). PUT cannot set paidAt; COMPLETED txns immutable
  (DELETE blocked with 410). Removed commission-on-approve from referral approval.
  tsc clean.
- [x] 4. DEAL PIPELINE — ReferralStatus replaced: REGISTERED -> ACKNOWLEDGED -> INTRO_DONE
  -> NEGOTIATING -> WON / LOST (terminal). New ReferralStageHistory model (append-only,
  from/to/actor/note/timestamp, Restrict on delete). transitionReferralStage() helper
  validates + writes history + audit. Admin batch/[id] approve-reject and PATCH status
  all route through it. UI updated: admin customers list/detail (stage configs, pipeline
  advance buttons, history timeline, delete UI removed), affiliate referrals page
  (badges/stats/filters + company selector on the lead form — the old form also sent
  snake_case keys the API never accepted, fixed to camelCase), dashboard/reports mapped
  to new stages. Dormant tracking routes (track/conversion, r/[code]) kept, mapped
  minimally (REGISTERED/WON). tsc clean.
- [x] 5. AUDIT COVERAGE — all trust-critical routes now audit: referral register/edit/
  transitions/delete-attempts, transaction CRUD + collect, payouts + auto-payouts,
  commission maturation, refunds, partner-company CRUD + invites, partner-group
  create/update (commission rates — added, was missing), partner acknowledge.
  Uses logAuditAction helper (new) or pre-existing direct auditLog writes.
  tsc clean.
- [x] 6. BASELINE TESTS — vitest 3 added (`npm test`). 26 tests, all passing:
  src/lib/__tests__/partnership.test.ts (20): normalizeRate (incl. legacy percent scale),
  getCommissionRateForReferral precedence (company -> group -> 30%), computeCommissionCents
  (incl. 30% of $10k = $3k, floor rounding), validateStageTransition (forward chain,
  LOST bail-out, no skipping, no backward moves, terminal WON/LOST, unknown stages),
  transaction aging.
  src/app/api/__tests__/trust.test.ts (6, Prisma mocked): referral DELETE -> 410 with
  zero delete calls + blocked-attempt audit; duplicate lead email -> 409, no create;
  new lead -> REGISTERED + normalized email + stage-history seed; transaction POST ->
  PENDING/paidAt null/commission 0 with no commission accrual; collect -> COMPLETED +
  paidAt stamped + exactly 30% commission created once; re-collect -> 409, no double
  accrual.
- Production `next build`: SUCCEEDED (EXIT 0) — all routes compile, incl. new /partner/*
  pages and /api/partner/* + /api/admin/partner-companies/* + collect endpoint.

## Notes / decisions

## Notes / decisions
- Affiliate-marketing features (click tracking, coupons, cookie durations, conversions API) left
  dormant and untouched per instructions.
- `partnerCompanyId` on Referral is nullable in the schema (migration-safe for legacy rows) but
  REQUIRED in the B2B lead-registration API. Dedupe unique index is (partnerCompanyId, leadEmail);
  legacy NULL-company rows are unaffected by the index (Postgres treats NULLs as distinct).
- 2026-10-10 (screenshot session): found + fixed auth middleware bug — /api/auth/me skipped
  verification and headers were set on the response instead of the request, so every
  authenticated page bounced to /login. Fixed in src/middleware.ts (request-header injection,
  /api/auth/me + /partner/* + /api/partner/* through verification, partner role guard).
  Also fixed seedDatabase() storing plaintext 'password' (createUser expects bcrypt hash) —
  admin@example.com login now works on fresh seed. Fixed ₹NaN display in Top Partners
  (guard for undefined totalRevenue). 26/26 vitest + tsc clean after all fixes.
