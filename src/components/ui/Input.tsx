import { clsx } from 'clsx';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className, id, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm text-text-secondary">
          {label}
        </label>
      )}
      <input
        id={id}
        className={clsx(
          'h-10 px-4 rounded-card-sm',
          'bg-white/5 border border-white/10',
          'text-white placeholder:text-white/30',
          'backdrop-blur-glass',
          'focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30',
          'transition-all duration-200',
          className
        )}
        {...props}
      />
    </div>
  );
}
