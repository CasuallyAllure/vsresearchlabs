/**
 * AdminSystemHealth
 *
 * At-a-glance "is everything working?" board. Reads what we can
 * cheaply: database connectivity, Edge Function presence, build info,
 * and a freshness check on the audit log + customers tables.
 *
 * Deep observability (function logs, email delivery rates) lives in
 * the Supabase + Resend dashboards — direct links provided.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';

interface HealthState {
  supabaseUrl: string | null;
  supabaseConfigured: boolean;
  dbReachable: boolean | null;
  dbLatencyMs: number | null;
  isAdminOk: boolean | null;
  auditLogCount: number | null;
  customerCount: number | null;
  lastInquiryAt: string | null;
  buildEnv: string;
  error: string | null;
}

const SUPABASE_PROJECT_REF =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.match(/https:\/\/([^.]+)\./)?.[1] ?? null;

export function AdminSystemHealth() {
  const [state, setState] = useState<HealthState>({
    supabaseUrl: null,
    supabaseConfigured: false,
    dbReachable: null,
    dbLatencyMs: null,
    isAdminOk: null,
    auditLogCount: null,
    customerCount: null,
    lastInquiryAt: null,
    buildEnv: import.meta.env.MODE,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? null;
      const supabaseConfigured = !!supabase;

      if (!supabase) {
        if (!cancelled) {
          setState((s) => ({ ...s, supabaseUrl, supabaseConfigured: false, error: 'Backend not configured.' }));
        }
        return;
      }

      const started = performance.now();

      // Run all probes in parallel so the page doesn't feel laggy.
      const [adminRes, auditRes, custRes, inqRes] = await Promise.all([
        supabase.rpc('is_admin'),
        supabase.from('audit_log').select('id', { count: 'exact', head: true }),
        supabase.from('customers').select('id', { count: 'exact', head: true }),
        supabase.from('inquiries').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);

      const latency = Math.round(performance.now() - started);

      if (cancelled) return;
      setState({
        supabaseUrl,
        supabaseConfigured,
        dbReachable: !adminRes.error && !auditRes.error && !custRes.error,
        dbLatencyMs: latency,
        isAdminOk: adminRes.data === true,
        auditLogCount: auditRes.count ?? null,
        customerCount: custRes.count ?? null,
        lastInquiryAt: (inqRes.data as { created_at: string } | null)?.created_at ?? null,
        buildEnv: import.meta.env.MODE,
        error: null,
      });
    }
    probe();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AdminLayout>
      <header className="mb-[var(--space-6)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
          System Health
        </p>
        <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] leading-[1.1] tracking-[-0.01em] text-ink">
          <span className="font-light text-ink/85">Is everything </span>
          <span className="font-medium text-ink">working.</span>
        </h2>
      </header>

      {state.error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{state.error}</p>}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-4)] mb-[var(--space-8)]">
        <HealthCard
          title="Frontend ↔ Supabase configured"
          ok={state.supabaseConfigured}
          detail={state.supabaseUrl ?? 'VITE_SUPABASE_URL is missing'}
        />
        <HealthCard
          title="Database reachable"
          ok={state.dbReachable}
          detail={state.dbLatencyMs !== null ? `Round-trip ${state.dbLatencyMs}ms` : 'Probing…'}
        />
        <HealthCard
          title="Admin role verified for this session"
          ok={state.isAdminOk}
          detail={state.isAdminOk ? 'is_admin() returned true' : 'is_admin() returned false — sign in as an admin'}
        />
        <HealthCard
          title="Audit log writing"
          ok={state.auditLogCount !== null && state.auditLogCount > 0 ? true : state.auditLogCount === 0 ? null : false}
          detail={
            state.auditLogCount === null
              ? 'Cannot read audit_log'
              : state.auditLogCount === 0
                ? 'No events recorded yet — fire any admin action to populate'
                : `${state.auditLogCount.toLocaleString()} events recorded`
          }
        />
        <HealthCard
          title="Customer directory"
          ok={state.customerCount !== null ? true : null}
          detail={
            state.customerCount === null
              ? 'Cannot read customers'
              : `${state.customerCount.toLocaleString()} customer record(s) on file`
          }
        />
        <HealthCard
          title="Inquiry intake"
          ok={state.lastInquiryAt !== null ? true : null}
          detail={
            state.lastInquiryAt
              ? `Last inquiry ${formatRelative(state.lastInquiryAt)}`
              : 'No inquiries on file yet'
          }
        />
      </section>

      <section className="research-surface-solid p-[var(--space-5)] mb-[var(--space-8)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-3)]">
          Build
        </p>
        <dl className="grid grid-cols-2 gap-[var(--space-3)] text-[12px]">
          <dt className="text-ink/45 text-[10px] uppercase tracking-[0.22em]">Environment</dt>
          <dd className="font-mono text-ink/85">{state.buildEnv}</dd>
          <dt className="text-ink/45 text-[10px] uppercase tracking-[0.22em]">Supabase project ref</dt>
          <dd className="font-mono text-ink/85">{SUPABASE_PROJECT_REF ?? '—'}</dd>
          <dt className="text-ink/45 text-[10px] uppercase tracking-[0.22em]">Frontend URL</dt>
          <dd className="font-mono text-ink/85 break-all">{typeof window !== 'undefined' ? window.location.origin : '—'}</dd>
        </dl>
      </section>

      <section className="research-surface-solid p-[var(--space-5)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-3)]">
          External dashboards
        </p>
        <ul className="text-[12.5px] text-ink/75 space-y-[var(--space-2)]">
          <li>
            <strong className="text-ink/55 text-[10px] uppercase tracking-[0.18em] mr-2">Edge Function logs</strong>
            {SUPABASE_PROJECT_REF ? (
              <a
                href={`https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/functions`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-holo-light/85 underline underline-offset-4 decoration-holo/30"
              >
                Supabase Dashboard →
              </a>
            ) : 'configure VITE_SUPABASE_URL'}
          </li>
          <li>
            <strong className="text-ink/55 text-[10px] uppercase tracking-[0.18em] mr-2">Email delivery</strong>
            <a
              href="https://resend.com/emails"
              target="_blank"
              rel="noopener noreferrer"
              className="text-holo-light/85 underline underline-offset-4 decoration-holo/30"
            >
              Resend Dashboard →
            </a>
          </li>
          <li>
            <strong className="text-ink/55 text-[10px] uppercase tracking-[0.18em] mr-2">Hosting / deploys</strong>
            <a
              href="https://dash.cloudflare.com/?to=/:account/pages/view/vsresearchlabs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-holo-light/85 underline underline-offset-4 decoration-holo/30"
            >
              Cloudflare Pages →
            </a>
          </li>
        </ul>
      </section>
    </AdminLayout>
  );
}

interface HealthCardProps {
  title: string;
  ok: boolean | null;          // true = green, false = red, null = neutral / pending
  detail: string;
}

function HealthCard({ title, ok, detail }: HealthCardProps) {
  const dot =
    ok === true  ? { bg: '#2E7D5B', glow: 'rgba(124,217,146,0.40)' } :
    ok === false ? { bg: '#B23A3A', glow: 'rgba(255,122,122,0.40)' } :
                   { bg: 'rgba(255,255,255,0.35)', glow: 'rgba(255,255,255,0.10)' };

  return (
    <div className="research-surface-solid p-[var(--space-4)]">
      <div className="flex items-start gap-[var(--space-3)]">
        <span
          aria-hidden="true"
          className="inline-block h-[10px] w-[10px] rounded-full shrink-0 mt-1.5"
          style={{
            backgroundColor: dot.bg,
            boxShadow: `0 0 8px ${dot.glow}, inset 0 0 0 0.5px rgba(255,255,255,0.25)`,
          }}
        />
        <div className="min-w-0">
          <p className="text-[12.5px] text-ink tracking-tight">{title}</p>
          <p className="mt-1 text-[11px] text-ink/55 leading-relaxed">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toISOString().slice(0, 10);
}
