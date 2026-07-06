/**
 * Button — the single governed button primitive for VS Research Labs.
 *
 * Encodes the strict register (see DESIGN.md §4): pill shape, color-only
 * hover (no lift, no sheen), one calm shadow, standardized size + letter
 * spacing. Every button on the site should be this component so the look can
 * never drift again.
 *
 * Variants:
 *   primary   — gold action (.cta-mint)
 *   secondary — ink outline (.cta-holo)
 *   ghost     — quiet text action
 *
 * Renders a <button> by default, a react-router <Link> when `to` is set, or an
 * <a> when `href` is set — so internal nav, external links, and actions all
 * share one look.
 */

import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-[var(--space-2)] rounded-full font-normal uppercase tracking-[0.14em] whitespace-nowrap leading-none select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-gold/45 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none';

// Slimmer, more refined proportions — leaner height, not chunky slabs.
const SIZES: Record<ButtonSize, string> = {
  sm: 'text-[10px] px-[16px] py-[7px]',
  md: 'text-[10.5px] px-[20px] py-[9px]',
  lg: 'text-[11px] px-[26px] py-[11px]',
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'cta-mint',
  secondary: 'cta-holo',
  ghost: 'bg-transparent text-ink/65 hover:text-ink transition-colors',
};

interface BaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
}

type ButtonAsButton = BaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> & {
    to?: undefined;
    href?: undefined;
  };

type ButtonAsLink = BaseProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseProps | 'href'> & {
    to: string;
    href?: undefined;
  };

type ButtonAsAnchor = BaseProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseProps> & {
    href: string;
    to?: undefined;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink | ButtonAsAnchor;

function classesFor(
  variant: ButtonVariant,
  size: ButtonSize,
  fullWidth: boolean | undefined,
  className: string | undefined,
): string {
  return twMerge(clsx(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className));
}

export function Button(props: ButtonProps) {
  const { variant = 'primary', size = 'md', fullWidth, className, children } = props;
  const cls = classesFor(variant, size, fullWidth, className);

  if (props.to != null) {
    const { variant: _v, size: _s, fullWidth: _f, className: _c, children: _ch, to, ...rest } = props;
    return (
      <Link to={to} className={cls} {...rest}>
        {children}
      </Link>
    );
  }

  if (props.href != null) {
    const { variant: _v, size: _s, fullWidth: _f, className: _c, children: _ch, href, ...rest } = props;
    return (
      <a href={href} className={cls} {...rest}>
        {children}
      </a>
    );
  }

  const { variant: _v, size: _s, fullWidth: _f, className: _c, children: _ch, ...rest } = props;
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
