import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  variant?: 'centered' | 'bottom-sheet';
  className?: string;
}

export function Modal({ open, onClose, children, variant = 'centered', className }: ModalProps) {
  // Lock body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Content */}
          <motion.div
            className={clsx(
              variant === 'centered' && 'flex items-center justify-center min-h-full p-4',
              variant === 'bottom-sheet' && 'flex items-end min-h-full'
            )}
          >
            <motion.div
              className={clsx(
                'relative z-10 glass-card p-6',
                variant === 'centered' && 'max-w-lg w-full',
                variant === 'bottom-sheet' && 'w-full rounded-b-none max-h-[80vh] overflow-auto',
                className
              )}
              initial={
                variant === 'centered'
                  ? { scale: 0.95, opacity: 0 }
                  : { y: '100%', opacity: 0 }
              }
              animate={
                variant === 'centered'
                  ? { scale: 1, opacity: 1 }
                  : { y: 0, opacity: 1 }
              }
              exit={
                variant === 'centered'
                  ? { scale: 0.95, opacity: 0 }
                  : { y: '100%', opacity: 0 }
              }
              transition={
                variant === 'centered'
                  ? { type: 'spring', damping: 20, stiffness: 300 }
                  : { type: 'spring', damping: 25, stiffness: 200 }
              }
            >
              {children}
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
