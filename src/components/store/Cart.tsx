import { AnimatePresence, motion } from 'framer-motion';
import { useCart } from '../../hooks/useCart';
import { CartItem } from './CartItem';
import { Button } from '../ui/Button';
import { createCheckoutSession } from '../../lib/stripe';

interface CartProps {
  open: boolean;
  onClose: () => void;
}

export function Cart({ open, onClose }: CartProps) {
  const { items, total, clear } = useCart();

  const handleCheckout = async () => {
    if (items.length === 0) return;

    try {
      await createCheckoutSession(
        items.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
        })),
        `${window.location.origin}/order/success`,
        `${window.location.origin}/cart`
      );
    } catch (err) {
      console.error('Checkout error:', err);
    }
  };

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

          {/* Bottom sheet */}
          <motion.div
            className="absolute bottom-0 left-0 right-0 bg-base-800 border-t border-white/10 rounded-t-card max-h-[80vh] flex flex-col"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <h2 className="text-lg font-medium text-white">Your Cart</h2>
              <button
                onClick={onClose}
                className="text-white/40 hover:text-white transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-auto px-6">
              {items.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-white/30 text-sm">Your cart is empty</p>
                </div>
              ) : (
                items.map((item) => (
                  <CartItem key={item.product.id} item={item} />
                ))
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="border-t border-white/5 px-6 py-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Subtotal</span>
                  <span className="text-xl text-gold font-semibold">
                    ${(total() / 100).toFixed(2)}
                  </span>
                </div>
                <div className="flex gap-3">
                  <Button variant="ghost" size="md" onClick={clear} className="flex-shrink-0">
                    Clear
                  </Button>
                  <Button variant="primary" size="lg" className="flex-1" onClick={handleCheckout}>
                    Checkout
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
