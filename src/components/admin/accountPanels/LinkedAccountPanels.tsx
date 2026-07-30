/**
 * LinkedAccountPanels — the "Linked portal account" section for the customer
 * detail page: the three management panels stacked, gated on the profile
 * lookup, owning the confirm modal. Byte-for-byte the original
 * CustomerAccountPanels root, now composed from the shared pieces so the
 * /admin/members rows can reuse the very same panels + RPCs in their own
 * layout.
 */

import { useConfirm } from '../ConfirmModal';
import { InlineError, MutedNote, PanelCaption } from './atoms';
import { NOT_MIGRATED_NOTE } from './shared';
import { useLinkedProfile, type ProfileLookup } from './useLinkedProfile';
import { ProfileFlagsPanel } from './ProfileFlagsPanel';
import { RewardsPanel } from './RewardsPanel';
import { DiscountsPanel } from './DiscountsPanel';

interface LinkedAccountPanelsProps {
  /** Which key resolves the customer_profiles row (CRM id or auth user id). */
  lookup: ProfileLookup;
  /** CRM contact (email) — shown as identity context in Profile flags. */
  contact: string;
}

export function LinkedAccountPanels({ lookup, contact }: LinkedAccountPanelsProps) {
  const { confirm, modal } = useConfirm();
  const { state, profile, loadError, reload } = useLinkedProfile(lookup);

  return (
    <section className="mb-[var(--space-8)]">
      <PanelCaption>Linked portal account</PanelCaption>

      {state === 'loading' && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {state === 'none' && <MutedNote>No portal account linked.</MutedNote>}

      {state === 'unmigrated' && <MutedNote>{NOT_MIGRATED_NOTE}</MutedNote>}

      {state === 'error' && loadError && <InlineError>{loadError}</InlineError>}

      {state === 'ready' && profile && (
        <div className="flex flex-col gap-[var(--space-5)]">
          <ProfileFlagsPanel profile={profile} contact={contact} confirm={confirm} onSaved={reload} />
          <RewardsPanel userId={profile.user_id} confirm={confirm} />
          <DiscountsPanel userId={profile.user_id} accountType={profile.account_type} tier={profile.tier} confirm={confirm} />
        </div>
      )}

      {modal}
    </section>
  );
}
