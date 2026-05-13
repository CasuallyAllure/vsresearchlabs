import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { GlassCard } from '../ui/GlassCard';
import { Button } from '../ui/Button';
import { useCart } from '../../hooks/useCart';

export function OrderConfirmation() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const clear = useCart((s) => s.clear);
  const [cleared, setCleared] = useState(false);

  // Clear cart on successful order
  useEffect(() => {
    if (sessionId && !cleared) {
      clear();
      setCleared(true);
    }
  }, [sessionId, clear, cleared]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6 py-24">
      <GlassCard className="max-w-md w-full p-8 text-center" glow>
        {/* Check icon */}
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#10b981"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h1 className="text-2xl font-light text-white mb-3">Order Confirmed</h1>
        <p className="text-white/50 text-sm mb-6 leading-relaxed">
          Thank you for your order! You'll receive a confirmation email shortly with tracking details.
        </p>

        {sessionId && (
          <p className="text-xs text-white/30 mb-6 break-all">
            Session: {sessionId}
          </p>
        )}

        <Link to="/store">
          <Button variant="primary" size="md">
            Continue Shopping
          </Button>
        </Link>

        <p className="text-xs text-white/30 mt-8">
          For Research Purposes Only — Not for Human Use
        </p>
      </GlassCard>
    </div>
  );
}
