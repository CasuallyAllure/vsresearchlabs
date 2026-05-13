import { motion } from 'framer-motion';
import { GlassCard } from '../ui/GlassCard';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useCart } from '../../hooks/useCart';
import type { Product } from '../../types';

interface ProductCardProps {
  product: Product;
  onClick?: () => void;
}

export function ProductCard({ product, onClick }: ProductCardProps) {
  const add = useCart((s) => s.add);

  return (
    <motion.div whileHover={{ scale: 1.02 }} transition={{ duration: 0.2 }}>
      <GlassCard
        className="p-0 overflow-hidden group cursor-pointer"
        onClick={onClick}
      >
        {/* Image */}
        <div className="relative aspect-square bg-base-700 rounded-t-card overflow-hidden">
          {product.images?.[0] ? (
            <img
              src={product.images[0]}
              alt={product.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-white/20 text-sm">{product.category}</span>
            </div>
          )}

          {/* Category badge */}
          {product.category && (
            <div className="absolute top-3 right-3">
              <Badge variant="gold">{product.category}</Badge>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-5">
          <h3 className="text-white font-medium mb-1 truncate">{product.name}</h3>
          <p className="text-gold font-semibold mb-4">
            ${(product.price_cents / 100).toFixed(2)}
          </p>

          <Button
            variant="ghost"
            size="sm"
            className="w-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            onClick={(e) => {
              e.stopPropagation();
              add(product);
            }}
          >
            Add to Cart
          </Button>
        </div>
      </GlassCard>
    </motion.div>
  );
}
