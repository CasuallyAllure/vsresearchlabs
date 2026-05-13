import { clsx } from 'clsx';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  glow?: boolean;
}

export function GlassCard({ children, className, onClick, glow }: GlassCardProps) {
  return (
    <div
      className={clsx(
        'glass-card',
        glow && 'animate-glow',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
