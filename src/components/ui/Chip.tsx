import { clsx } from 'clsx';

interface ChipProps {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

export function Chip({ children, active, onClick, className }: ChipProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex items-center px-4 py-1.5 rounded-full text-sm font-medium',
        'border transition-all duration-200',
        'active:scale-[0.97]',
        active
          ? 'bg-gold/20 text-gold border-gold/30'
          : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white/80',
        className
      )}
    >
      {children}
    </button>
  );
}
