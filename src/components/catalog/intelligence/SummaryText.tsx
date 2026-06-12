/**
 * SummaryText
 *
 * Renders a plain-English compound summary with a tiny inline highlight
 * markup so a non-technical reader can scan the key points:
 *
 *   **text**  → key term        (cyan / holo)
 *   ~text~    → positive outcome (mint)
 *   *text*    → strong emphasis  (white, semibold)
 *
 * Markup is intentionally minimal and non-nested. Anything not wrapped
 * renders as ordinary muted body copy. This is the ONE friendly,
 * colorized surface — the heavy technical detail lives in the modules.
 */

import { Fragment } from 'react';

const TOKEN = /(\*\*[^*]+\*\*|~[^~]+~|\*[^*]+\*)/g;

const KEY_STYLE: React.CSSProperties = {
  color: '#8FD6FF',
  textShadow: '0 0 6px rgba(100,200,255,0.45), 0 0 14px rgba(100,200,255,0.18)',
};
const GOOD_STYLE: React.CSSProperties = {
  color: '#7CE6C2',
  textShadow: '0 0 6px rgba(110,232,192,0.40), 0 0 14px rgba(110,232,192,0.16)',
};

interface SummaryTextProps {
  text: string;
  className?: string;
}

export function SummaryText({ text, className }: SummaryTextProps) {
  const parts = text.split(TOKEN);
  return (
    <p className={className}>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <span key={i} className="font-medium" style={KEY_STYLE}>
              {part.slice(2, -2)}
            </span>
          );
        }
        if (part.startsWith('~') && part.endsWith('~')) {
          return (
            <span key={i} className="font-medium" style={GOOD_STYLE}>
              {part.slice(1, -1)}
            </span>
          );
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return (
            <span key={i} className="font-semibold text-white">
              {part.slice(1, -1)}
            </span>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </p>
  );
}
