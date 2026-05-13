import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Link } from 'react-router-dom';
import { GlassCard } from '../ui/GlassCard';
import { Button } from '../ui/Button';

gsap.registerPlugin(ScrollTrigger);

// Featured product placeholders (replaced by real data when connected to Supabase)
const featuredProducts = [
  {
    id: '1',
    name: 'Precision Pen Case',
    price: '$34.99',
    image: '',
    category: 'Pen Cases',
  },
  {
    id: '2',
    name: 'Research Carry Case',
    price: '$49.99',
    image: '',
    category: 'Carry Cases',
  },
  {
    id: '3',
    name: 'Sterile Accessory Kit',
    price: '$24.99',
    image: '',
    category: 'Accessories',
  },
];

export function ProductPreview() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.product-preview-card', {
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 80%',
          end: 'bottom 60%',
          toggleActions: 'play none none reverse',
        },
        y: 60,
        opacity: 0,
        duration: 0.6,
        stagger: 0.15,
        ease: 'power3.out',
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-24 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-gold text-xs tracking-[0.3em] uppercase font-medium mb-3">
            Featured Products
          </p>
          <h2 className="text-3xl md:text-4xl font-light text-white">
            Built for the Lab
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {featuredProducts.map((product) => (
            <GlassCard key={product.id} className="product-preview-card p-0 overflow-hidden group">
              {/* Image placeholder */}
              <div className="aspect-square bg-base-700 flex items-center justify-center rounded-t-card">
                <span className="text-white/20 text-sm">{product.category}</span>
              </div>

              <div className="p-6">
                <span className="text-xs text-white/40 uppercase tracking-wider">
                  {product.category}
                </span>
                <h3 className="text-lg font-medium text-white mt-1 mb-2">
                  {product.name}
                </h3>
                <p className="text-gold font-semibold mb-4">{product.price}</p>
                <Link to="/store">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                  >
                    View Product
                  </Button>
                </Link>
              </div>
            </GlassCard>
          ))}
        </div>
      </div>
    </section>
  );
}
