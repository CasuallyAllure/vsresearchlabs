/**
 * Unit tests for src/lib/utils.ts — cn() class-name merge helper.
 *
 * `cn` composes clsx (conditional joining) with tailwind-merge (last-wins on
 * conflicting Tailwind utilities). These tests pin both behaviours so a swap
 * of either dependency can't silently change how class strings resolve.
 */
import { describe, expect, test } from 'vitest';
import { cn } from '../../src/lib/utils';

describe('cn', () => {
  test('joins plain class strings', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  test('drops falsy conditional entries', () => {
    // Arrange
    const active = false;
    // Act
    const out = cn('base', active && 'active', 'end');
    // Assert
    expect(out).toBe('base end');
  });

  test('resolves conflicting tailwind utilities to the last one', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  test('flattens array and object inputs', () => {
    expect(cn(['a', 'b'], { c: true, d: false })).toBe('a b c');
  });
});
