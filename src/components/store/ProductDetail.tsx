import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useCart } from '../../hooks/useCart';
import { GlassCard } from '../ui/GlassCard';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { DisclaimerBanner } from '../landing/DisclaimerBanner';
import type { Product } from '../../types';

export function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const add = useCart((s) => s.add);
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);

  useEffect(() => {
    async function fetchProduct() {
      if (!id) return;
      setLoading(true);
      if (!supabase) {
        setProduct(null);
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('products')
        .select('id, name, description, price_cents, category, images, in_stock, created_at')
        .eq('id', id)
        .single();

      setProduct(data as unknown as Product);
      setLoading(false);
    }

    fetchProduct();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="text-center py-32">
        <p className="text-white/40">Product not found</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        {/* Images */}
        <div className="space-y-4">
          <GlassCard className="p-0 overflow-hidden">
            <div className="aspect-square bg-base-700 flex items-center justify-center">
              {product.images?.[selectedImage] ? (
                <img
                  src={product.images[selectedImage]}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-white/20 text-sm">{product.category}</span>
              )}
            </div>
          </GlassCard>

          {/* Thumbnail strip */}
          {product.images && product.images.length > 1 && (
            <div className="flex gap-2">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedImage(i)}
                  className={`w-16 h-16 rounded-card-sm overflow-hidden border ${
                    selectedImage === i
                      ? 'border-gold'
                      : 'border-white/10 hover:border-white/20'
                  } transition-colors`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="space-y-6">
          {product.category && (
            <Badge variant="gold">{product.category}</Badge>
          )}

          <h1 className="text-3xl md:text-4xl font-light text-white">{product.name}</h1>

          <p className="text-2xl text-gold font-semibold">
            ${(product.price_cents / 100).toFixed(2)}
          </p>

          {product.description && (
            <p className="text-white/50 leading-relaxed">{product.description}</p>
          )}

          {/* Quantity */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-white/40">Quantity</span>
            <div className="flex items-center glass-card !rounded-card-sm !p-0">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
              >
                −
              </button>
              <span className="w-10 text-center text-white font-medium">{quantity}</span>
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
              >
                +
              </button>
            </div>
          </div>

          {/* CTA */}
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!product.in_stock}
            onClick={() => {
              for (let i = 0; i < quantity; i++) {
                add(product);
              }
            }}
          >
            {product.in_stock ? 'Add to Cart' : 'Out of Stock'}
          </Button>

          {/* Stock status */}
          {!product.in_stock && (
            <p className="text-sm text-red-400">This product is currently unavailable.</p>
          )}
        </div>
      </div>

      {/* Disclaimer on product page */}
      <div className="mt-16">
        <DisclaimerBanner />
      </div>
    </div>
  );
}
