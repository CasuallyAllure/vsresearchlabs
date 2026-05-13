import { useCart } from '../../hooks/useCart';
import type { CartItem as CartItemType } from '../../types';

interface CartItemProps {
  item: CartItemType;
}

export function CartItem({ item }: CartItemProps) {
  const { remove, updateQuantity } = useCart();

  return (
    <div className="flex items-center gap-4 py-4 border-b border-white/5 last:border-0">
      {/* Image */}
      <div className="w-16 h-16 rounded-card-sm bg-base-700 overflow-hidden flex-shrink-0">
        {item.product.images?.[0] ? (
          <img
            src={item.product.images[0]}
            alt={item.product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-white/20 text-[10px]">{item.product.category}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm text-white font-medium truncate">{item.product.name}</h4>
        <p className="text-sm text-gold">
          ${(item.product.price_cents / 100).toFixed(2)}
        </p>
      </div>

      {/* Quantity controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
          className="w-7 h-7 rounded-full bg-white/5 text-white/60 hover:bg-white/10 hover:text-white flex items-center justify-center text-sm transition-colors"
        >
          −
        </button>
        <span className="w-7 text-center text-sm text-white">{item.quantity}</span>
        <button
          onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
          className="w-7 h-7 rounded-full bg-white/5 text-white/60 hover:bg-white/10 hover:text-white flex items-center justify-center text-sm transition-colors"
        >
          +
        </button>
      </div>

      {/* Remove */}
      <button
        onClick={() => remove(item.product.id)}
        className="text-white/30 hover:text-red-400 transition-colors ml-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
