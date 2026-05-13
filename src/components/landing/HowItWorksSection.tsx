import { GlassCard } from '../ui/GlassCard';

const steps = [
  {
    number: '01',
    title: 'Order',
    description: 'Browse our curated selection and place your order securely via Stripe.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    ),
  },
  {
    number: '02',
    title: 'Fulfilled',
    description: 'Your order is processed and shipped directly from our fulfillment partner.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  {
    number: '03',
    title: 'Delivered',
    description: 'Discreet packaging arrives at your door — no supplier branding.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-gold text-xs tracking-[0.3em] uppercase font-medium mb-3">
            How It Works
          </p>
          <h2 className="text-3xl md:text-4xl font-light text-white">
            Simple. Secure. Discreet.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((step) => (
            <GlassCard key={step.number} className="p-8 text-center">
              <div className="text-gold mb-4 flex justify-center">{step.icon}</div>
              <span className="text-xs text-white/30 tracking-widest">{step.number}</span>
              <h3 className="text-xl font-medium text-white mt-2 mb-3">{step.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{step.description}</p>
            </GlassCard>
          ))}
        </div>
      </div>
    </section>
  );
}
