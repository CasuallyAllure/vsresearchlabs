/**
 * SummaryText
 *
 * Renders a plain-English compound summary with a tiny inline emphasis
 * markup. All three markers render the same way — **bold ink**, no color,
 * no glow — so key points read clearly without decoration:
 *
 *   **text**  ~text~  *text*  → all → bold (same ink color)
 *
 * Markup is intentionally minimal and non-nested. Anything not wrapped
 * renders as ordinary body copy.
 */

import { Fragment } from 'react';

const TOKEN = /(\*\*[^*]+\*\*|~[^~]+~|\*[^*]+\*)/g;

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
        // All emphasis markers → plain bold, same color, no glow.
        const inner =
          part.startsWith('**') && part.endsWith('**')
            ? part.slice(2, -2)
            : (part.startsWith('~') && part.endsWith('~')) ||
              (part.startsWith('*') && part.endsWith('*'))
            ? part.slice(1, -1)
            : null;
        if (inner !== null) {
          return (
            <span key={i} className="font-semibold text-ink">
              {inner}
            </span>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </p>
  );
}
