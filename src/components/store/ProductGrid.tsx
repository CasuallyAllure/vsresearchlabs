import { useNavigate } from 'react-router-dom';
import { ProductCard } from './ProductCard';
import { Spinner } from '../ui/Spinner';
import type { Product } from '../../types';

interface ProductGridProps {
  products: Product[];
  loading: boolean;
  error: string | null;
}

export function ProductGrid({ products, loading, error }: ProductGridProps) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-24">
        <p className="text-red-400 text-sm">Failed to load products</p>
        <p className="text-white/30 text-xs mt-1">{error}</p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="text-center py-24">
        <p className="text-white/40 text-sm">No products found</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          onClick={() => navigate(`/product/${product.id}`)}
        />
      ))}
    </div>
  );
}
