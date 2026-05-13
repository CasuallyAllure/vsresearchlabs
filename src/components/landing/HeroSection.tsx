import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';

export function HeroSection() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.from('.hero-overline', {
        opacity: 0,
        y: 20,
        duration: 0.6,
        delay: 0.2,
      })
        .from('.hero-headline', {
          opacity: 0,
          y: 20,
          duration: 0.7,
        }, '-=0.2')
        .from('.hero-subtext', {
          opacity: 0,
          y: 20,
          duration: 0.6,
        }, '-=0.2')
        .from('.hero-cta', {
          opacity: 0,
          y: 20,
          duration: 0.5,
        }, '-=0.1')
        .to('.hero-glow', {
          opacity: 1,
          duration: 1.2,
          ease: 'power2.inOut',
        }, '-=0.3');
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={containerRef}
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      style={{
        background: 'radial-gradient(ellipse at center, #0a0a0a 0%, #000000 70%)',
      }}
    >
      {/* Ambient gold glow */}
      <div
        className="hero-glow absolute inset-0 opacity-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(600px circle at 50% 50%, rgba(196, 163, 90, 0.06) 0%, transparent 70%)',
        }}
      />

      {/* Content */}
      <div className="relative z-10 text-center max-w-3xl mx-auto px-6">
        <p className="hero-overline text-gold text-xs tracking-[0.3em] uppercase font-medium mb-6">
          Research Grade Accessories
        </p>

        <h1 className="hero-headline text-5xl md:text-7xl font-light text-white leading-tight mb-6">
          Engineered for{' '}
          <span className="bg-gradient-gold bg-clip-text text-transparent font-normal">
            Precision
          </span>
        </h1>

        <p className="hero-subtext text-lg text-white/50 max-w-xl mx-auto mb-10 font-light">
          Premium peptide accessories designed for the modern researcher. Secure, discreet, and built to last.
        </p>

        <div className="hero-cta flex items-center justify-center gap-4">
          <Link to="/store">
            <Button variant="primary" size="lg">
              Shop Now
            </Button>
          </Link>
          <a href="#how-it-works">
            <Button variant="ghost" size="lg">
              Learn More
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}
