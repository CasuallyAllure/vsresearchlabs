/**
 * BottomNav
 * Phase 3 — VS Research Labs App Shell
 * Reconciliation Pass B — Chrome neutralization.
 *
 * Fixed bottom navigation. Visible on mobile only — hidden at `lg`+
 * because desktop has sufficient in-content navigation surfaces and
 * a persistent floor-bar on desktop reads as consumer-app convention.
 *
 * Surface posture: frosted black with a single hairline top border.
 * backdrop-blur-sm matches GlobalHeader for shell cohesion. Active
 * state is white-only — gold reserved for primary inquiry actions.
 */

import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

export type NavRole = 'guest' | 'owner';

interface BottomNavTab {
  to: string;
  label: string;
  icon: ReactNode;
  match?: (pathname: string) => boolean;
}

const HomeIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />
  </svg>
);

const FlaskIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 3h6" />
    <path d="M10 3v6.5L4.5 19a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9.5V3" />
    <path d="M7 14h10" />
  </svg>
);

const MicroscopeIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 18h8" />
    <path d="M3 22h18" />
    <path d="M14 22a7 7 0 1 0 0-14" />
    <path d="M9 14h2" />
    <path d="M9 12a2 2 0 0 1-2-2V6h4v4a2 2 0 0 1-2 2Z" />
    <path d="M12 6 8.5 2.5a2.12 2.12 0 0 0-3 3L9 9" />
  </svg>
);

const MailIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

const guestTabs: BottomNavTab[] = [
  {
    to: '/',
    label: 'Home',
    icon: HomeIcon,
    match: (p) => p === '/',
  },
  {
    to: '/research-supplies',
    label: 'Research Supplies',
    icon: FlaskIcon,
    match: (p) => p.startsWith('/research-supplies'),
  },
  {
    to: '/laboratory-equipment',
    label: 'Laboratory Equipment',
    icon: MicroscopeIcon,
    match: (p) => p.startsWith('/laboratory-equipment'),
  },
  {
    to: '/contact',
    label: 'Contact',
    icon: MailIcon,
    match: (p) => p.startsWith('/contact'),
  },
];

const tabsByRole: Record<NavRole, BottomNavTab[]> = {
  guest: guestTabs,
  owner: guestTabs,
};

interface BottomNavProps {
  role?: NavRole;
}

export function BottomNav({ role = 'guest' }: BottomNavProps) {
  const location = useLocation();
  const tabs = tabsByRole[role];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-sm border-t border-white/[0.06] lg:hidden"
      data-role={role}
      aria-label="Primary"
    >
      <div className="mx-auto w-full max-w-[1100px]">
        <ul className="flex items-stretch justify-around h-14 px-[var(--space-2)]">
          {tabs.map((tab) => {
            const isActive = tab.match
              ? tab.match(location.pathname)
              : location.pathname === tab.to;

            return (
              <li key={tab.to} className="flex-1">
                <Link
                  to={tab.to}
                  className={[
                    'relative h-full w-full flex flex-col items-center justify-center gap-1',
                    'text-[10px] uppercase tracking-[0.2em] font-light transition-colors duration-150 text-center',
                    'focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/20',
                    isActive ? 'text-white' : 'text-white/55 hover:text-white/80',
                  ].join(' ')}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span>{tab.icon}</span>
                  <span className="px-1 leading-tight">{tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
