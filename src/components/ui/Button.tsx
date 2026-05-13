import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-card-sm font-medium transition-all duration-200 active:scale-[0.98] active:duration-100 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-gradient-gold text-black font-semibold hover:opacity-90',
        secondary: 'bg-white/10 text-white border border-white/10 hover:bg-white/15',
        ghost: 'text-white/70 hover:text-white hover:bg-white/5',
        danger: 'bg-red-500/20 text-red-400 border border-red-500/20 hover:bg-red-500/30',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  children: React.ReactNode;
}

export function Button({ children, variant, size, className, ...props }: ButtonProps) {
  return (
    <button
      className={twMerge(clsx(buttonVariants({ variant, size }), className))}
      {...props}
    >
      {children}
    </button>
  );
}
