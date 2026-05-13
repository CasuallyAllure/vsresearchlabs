import { useState } from 'react';
import { FilterBar } from '../components/store/FilterBar';
import { ProductGrid } from '../components/store/ProductGrid';
import { useProducts } from '../hooks/useProducts';

export function Store() {
  const [category, setCategory] = useState<string | undefined>(undefined);
  const { products, loading, error } = useProducts(category);

  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-light text-white mb-2">Store</h1>
        <p className="text-white/40 text-sm">Browse our full catalog of research-grade accessories</p>
      </div>

      <div className="mb-8">
        <FilterBar activeCategory={category} onCategoryChange={setCategory} />
      </div>

      <ProductGrid products={products} loading={loading} error={error} />
    </div>
  );
}
