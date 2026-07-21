/**
 * CartIcon — plain stroked shopping-bag glyph.
 * Shared between GlobalHeader (cart trigger) and NavDrawer (inquiry row)
 * so the two surfaces read as one icon set. No gradients, no fills.
 */

interface CartIconProps {
  size?: number;
}

export function CartIcon({ size = 20 }: CartIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}
