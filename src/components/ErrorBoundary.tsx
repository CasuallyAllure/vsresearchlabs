/**
 * ErrorBoundary
 *
 * Top-level safety net. A render error anywhere below shows a branded
 * fallback instead of a white screen, with a reload affordance. Keeps a
 * single crashing component from taking down the whole app.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console; a real telemetry sink can hook in here later.
    console.error('App error boundary caught:', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex min-h-screen items-center justify-center px-6"
          style={{ background: 'var(--color-surface-base)', color: 'var(--color-content-primary)' }}
        >
          <div className="w-full max-w-[460px] text-center">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.3em] text-ink/45">
              VS Research Labs
            </p>
            <h1 className="mb-3 text-[clamp(1.4rem,3vw,1.9rem)] font-light leading-tight tracking-[-0.01em]">
              Something went sideways.
            </h1>
            <p className="mb-7 text-[13.5px] leading-relaxed text-ink/60">
              An unexpected error interrupted this view. Reloading usually clears
              it — if it keeps happening, reach out and we'll take a look.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-full bg-ink/[0.10] border border-ink/30 px-6 py-3 text-[10px] font-medium uppercase tracking-[0.25em] text-ink transition-colors hover:bg-ink/[0.15] hover:border-ink/40"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
