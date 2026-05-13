const trustItems = [
  {
    label: 'Secure Checkout',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    label: 'Fast Shipping',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
      </svg>
    ),
  },
  {
    label: 'Research Grade',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
];

export function TrustBar() {
  return (
    <section className="py-16 px-6 border-y border-white/5">
      <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-center gap-12">
        {trustItems.map((item) => (
          <div key={item.label} className="flex items-center gap-3 text-white/50">
            <span className="text-gold">{item.icon}</span>
            <span className="text-sm font-medium tracking-wide">{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
