import { clsx } from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'gold' | 'success' | 'warning' | 'error';
  className?: string;
}

const variantClasses: Record<string, string> = {
  default: 'bg-white/10 text-white/80 border-white/10',
  gold: 'bg-gold/20 text-gold border-gold/30',
  success: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
