/**
 * BroadcastView — compose one member campaign and mail it.
 *
 * The offer itself is an EXISTING coupon (Admin → Coupons owns creation,
 * expiry and one-use-per-account enforcement); this view quotes the code and
 * mails it. Recipients come from admin_campaign_recipients (088), which
 * excludes anyone who opted out of marketing, so the count shown is the count
 * that will be mailed. Sends go one-per-recipient through the admin-gated
 * send-member-offer function, claimed against email_log by campaign key — a
 * second run over the same key reports "already sent" instead of mailing twice.
 */

import { useMemo, useState } from 'react';
import { AdminFilterBar } from '../AdminFilterBar';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../components/admin/ConfirmModal';
import { MEMBER_DISCOUNT_PERCENT } from '../../../lib/memberPricing';
import { SEGMENT_OPTIONS, type RosterSegment } from '../useMembersData';
import { Chip, Panel, Tile } from './ui';
import { shortDate } from './format';
import {
  advertisedPercent, defaultCampaignKey, sendCampaign, tierFloorPercent,
  useCampaignRecipients, usePercentCoupons,
  type CampaignOffer, type OfferCoupon, type SendProgress,
} from './useBroadcast';

const NO_CODE = '';

/** Phrased, not numbered: a pro account's automatic rate is higher than a
 *  standard member's, so the mail must not pin one figure to it. */
const MEMBER_RATE_NOTE = 'automatic account discount';

const fieldCls =
  'w-full rounded-field border border-ink/12 bg-base-700 px-3 py-2 text-[13px] text-ink ' +
  'placeholder-ink/30 hover:border-ink/20 focus:border-gold/70 focus:outline-none focus:ring-2 focus:ring-gold/15 disabled:opacity-60';

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-[var(--space-2)] block text-[10px] uppercase tracking-[0.22em] text-ink/45">{children}</span>;
}

/** A neutral starting draft in the house register. The admin edits it before
 *  sending — nothing here is claimed about the compound or the buyer.
 *
 *  The quoted rate is the COMBINED one (code + automatic account rate), because
 *  that is what the member is actually charged. See advertisedPercent(). */
function composeDraft(coupon: OfferCoupon | null): { subject: string; body: string } {
  if (!coupon) {
    return {
      subject: 'A note from VS Research Labs',
      body: 'Hello,\n\n',
    };
  }
  const total = advertisedPercent(coupon.percent);
  const expires = coupon.expiresOn ? shortDate(coupon.expiresOn) : null;
  return {
    subject: `${total}% off for account holders`,
    body: [
      'Hello,',
      '',
      `Your account rate this week is ${total}% off the catalog — enter ${coupon.code} at checkout and it combines with the ${MEMBER_RATE_NOTE} your account already carries.`,
      coupon.oncePerContact ? 'The code is good for one order per account.' : 'The code applies at checkout.',
      expires ? `It stops working after ${expires}.` : '',
      'Bundles and wholesale pricing are excluded.',
      '',
      'Thank you,',
      'VS Research Labs',
    ].filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n'),
  };
}

export function BroadcastView() {
  const [segment, setSegment] = useState<RosterSegment>('all');
  const [search, setSearch] = useState('');
  const { rows, loading, error, unmigrated } = useCampaignRecipients(segment, search);
  const coupons = usePercentCoupons();
  const { confirm, modal } = useConfirm();

  const [code, setCode] = useState<string>(NO_CODE);
  const [subject, setSubject] = useState(() => composeDraft(null).subject);
  const [body, setBody] = useState(() => composeDraft(null).body);
  const [campaignKey, setCampaignKey] = useState(() => defaultCampaignKey(null));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const coupon = useMemo(() => coupons.find((c) => c.code === code) ?? null, [coupons, code]);

  /** Selecting a code re-drafts the copy and re-keys the campaign. Both stay
   *  editable afterwards — this is a starting point, not a template lock. */
  function pickCode(next: string) {
    const picked = coupons.find((c) => c.code === next) ?? null;
    const draft = composeDraft(picked);
    setCode(next);
    setSubject(draft.subject);
    setBody(draft.body);
    setCampaignKey(defaultCampaignKey(picked?.code ?? null));
  }

  const recipients = useMemo(() => rows.filter((r) => !excluded.has(r.contact)), [rows, excluded]);
  const proCount = useMemo(() => recipients.filter((r) => r.tier === 'pro').length, [recipients]);

  function toggle(contact: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(contact)) next.delete(contact); else next.add(contact);
      return next;
    });
  }

  async function handleSend() {
    setSendError(null);
    if (recipients.length === 0) { setSendError('No recipients selected.'); return; }
    if (!subject.trim() || !body.trim()) { setSendError('Subject and message are both required.'); return; }
    // The mail quotes the COMBINED rate — the code's own percent would
    // understate what the member is charged.
    const offer: CampaignOffer | null = coupon
      ? { code: coupon.code, percent: advertisedPercent(coupon.percent), expiresOn: coupon.expiresOn }
      : null;

    const ok = await confirm(
      `Email ${recipients.length} member${recipients.length === 1 ? '' : 's'}${offer ? ` with code ${offer.code}` : ''}? ` +
      `Members who already received campaign "${campaignKey}" are skipped automatically.`,
      { confirmLabel: 'Send' },
    );
    if (!ok) return;

    setSending(true);
    setProgress({ sent: 0, skipped: 0, optedOut: 0, failed: 0, total: recipients.length, done: false });
    await sendCampaign(recipients, { subject: subject.trim(), body: body.trim(), campaignKey, offer }, setProgress);
    setSending(false);
  }

  if (unmigrated) {
    return (
      <div className="research-surface-solid p-[var(--space-6)]">
        <p className="text-[13px] text-ink/55">
          Campaign data layer not migrated yet — apply migration 088 to enable this view.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

      <div className="mb-[var(--space-5)] grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-4">
        <Tile emphasis label="Recipients" value={String(recipients.length)} meta={['will be emailed']} />
        <Tile label="In segment" value={String(rows.length)} meta={['consenting members']} />
        <Tile label="Excluded" value={String(rows.length - recipients.length)} meta={['unticked here']} />
        <Tile
          label="Offer"
          value={coupon ? `${advertisedPercent(coupon.percent)}%` : '—'}
          meta={coupon
            ? [coupon.code, `${coupon.percent}% code + ${MEMBER_DISCOUNT_PERCENT}% account`]
            : ['no code']}
        />
      </div>

      <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-2">
        {/* ── Compose ─────────────────────────────────────────────────── */}
        <Panel caption="Compose">
          <label className="block">
            <Label>Discount code</Label>
            <select value={code} onChange={(e) => pickCode(e.target.value)} className={fieldCls} disabled={sending}>
              <option value={NO_CODE}>— No code (plain note) —</option>
              {coupons.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.percent}% {c.expiresOn ? `· ends ${c.expiresOn}` : '· no expiry'}
                </option>
              ))}
            </select>
          </label>
          {coupon ? (
            <p className="mt-[var(--space-2)] text-[11px] leading-relaxed text-ink/45">
              Members are charged <span className="text-ink/70">{advertisedPercent(coupon.percent)}%</span> —
              this {coupon.percent}% code adds to the automatic account rate, it does not replace it.
              {proCount > 0 && ` ${proCount} pro account${proCount === 1 ? '' : 's'} in this list carry a ${tierFloorPercent('pro')}% floor and land higher.`}
              {' '}
              {coupon.oncePerContact
                ? 'One use per contact is enforced on the code itself.'
                : 'This code is NOT once-per-contact — edit it under Coupons if the offer is meant to be single-use.'}
            </p>
          ) : (
            <p className="mt-[var(--space-2)] text-[11px] leading-relaxed text-ink/45">
              Codes are created and expired under Admin → Coupons. This view only quotes them.
            </p>
          )}

          <label className="mt-[var(--space-4)] block">
            <Label>Subject</Label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={fieldCls} disabled={sending} />
          </label>

          <label className="mt-[var(--space-4)] block">
            <Label>Message</Label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              maxLength={5000}
              className={`${fieldCls} resize-y font-mono text-[12px] leading-relaxed`}
              disabled={sending}
            />
          </label>

          <label className="mt-[var(--space-4)] block">
            <Label>Campaign key</Label>
            <input
              value={campaignKey}
              onChange={(e) => setCampaignKey(e.target.value.toLowerCase())}
              className={`${fieldCls} font-mono`}
              disabled={sending}
            />
          </label>
          <p className="mt-[var(--space-2)] text-[11px] leading-relaxed text-ink/45">
            The key is what stops a re-run from mailing anyone twice. Change it only to send the same people a genuinely new campaign.
          </p>

          {sendError && <p role="alert" className="mt-[var(--space-3)] text-[12px] text-red-400">{sendError}</p>}

          <div className="mt-[var(--space-4)] flex items-center gap-[var(--space-3)]">
            <Button type="button" variant="primary" size="sm" disabled={sending || loading} onClick={() => void handleSend()}>
              {sending ? 'Sending…' : `Send to ${recipients.length}`}
            </Button>
            {progress && (
              <span className="font-mono text-[11px] tabular-nums text-ink/55">
                {progress.sent} sent · {progress.skipped} already sent · {progress.optedOut} opted out · {progress.failed} failed
                {progress.done ? ' · done' : ` · of ${progress.total}`}
              </span>
            )}
          </div>
        </Panel>

        {/* ── Recipients ──────────────────────────────────────────────── */}
        <Panel caption="Recipients">
          <div className="mb-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-2)]">
            <AdminFilterBar label="" dense options={SEGMENT_OPTIONS} value={segment} onChange={setSegment} />
            <input
              type="search"
              placeholder="Name / email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-h-[36px] min-w-0 flex-1 rounded-full border border-ink/10 bg-base-700 px-[var(--space-3)] py-[5px] text-[12px] text-ink placeholder-ink/30 focus:border-ink/30 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setExcluded(excluded.size > 0 ? new Set() : new Set(rows.map((r) => r.contact)))}
              className="shrink-0 text-[10px] uppercase tracking-[0.2em] text-ink/50 transition-colors hover:text-ink"
            >
              {excluded.size > 0 ? 'Select all' : 'Select none'}
            </button>
          </div>

          {loading ? (
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-[12px] text-ink/40">
              No consenting members match this filter. Members who opted out of marketing are never listed.
            </p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-ink/[0.04] overflow-y-auto">
              {rows.map((r) => (
                <li key={r.contact} className="flex items-center gap-[var(--space-3)] py-[var(--space-2)]">
                  <input
                    type="checkbox"
                    checked={!excluded.has(r.contact)}
                    onChange={() => toggle(r.contact)}
                    disabled={sending}
                    aria-label={`Include ${r.contact}`}
                    className="h-4 w-4 shrink-0 accent-[color:var(--color-holo)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{r.name ?? r.contact}</span>
                    <span className="block truncate font-mono text-[10.5px] text-ink/45">
                      {r.contact} · joined {shortDate(r.joinedIso)}
                    </span>
                  </span>
                  {r.vip && <Chip tone="good">vip</Chip>}
                  <Chip tone="neutral">{r.segment}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {modal}
    </div>
  );
}
