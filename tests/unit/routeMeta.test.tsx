// @vitest-environment happy-dom
/**
 * Pins RouteMeta's robots directive.
 *
 * `/documentation` and `/documentation/:id` publish illustrative placeholder
 * records rather than issued quality documents, so they must be kept out of
 * search indexes until the real archive exists. Everywhere else must stay
 * indexable — which means NO robots tag at all, since an explicit `index`
 * would be noise and a stale `noindex` left behind on navigation would
 * quietly de-index the whole site.
 */
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import { RouteMeta } from '../../src/components/RouteMeta';

afterEach(() => {
  cleanup();
  document.head.querySelector('meta[name="robots"]')?.remove();
});

/** Renders RouteMeta at `path` and returns the robots content, if any. */
function robotsAt(path: string): string | null {
  render(
    <MemoryRouter initialEntries={[path]}>
      <RouteMeta />
    </MemoryRouter>,
  );
  return document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
}

describe('RouteMeta robots directive', () => {
  test('emits noindex on the documentation archive index', () => {
    expect(robotsAt('/documentation')).toBe('noindex, nofollow');
  });

  test('emits noindex on a documentation detail page', () => {
    expect(robotsAt('/documentation/doc-sem-coa-031')).toBe('noindex, nofollow');
  });

  test.each(['/', '/catalog', '/research', '/product/retatrutide', '/about'])(
    'leaves %s indexable with no robots tag',
    (path) => {
      expect(robotsAt(path)).toBeNull();
    },
  );

  test('does not de-index a route whose path merely starts with documentation', () => {
    expect(robotsAt('/documentation-policy')).toBeNull();
  });

  test('removes a stale noindex when navigating away from documentation', () => {
    // Arrange — a prior visit left the tag in place.
    robotsAt('/documentation');
    cleanup();

    // Act
    const after = robotsAt('/catalog');

    // Assert
    expect(after).toBeNull();
  });
});

describe('RouteMeta title', () => {
  test('still sets a brand-suffixed title for the route', () => {
    robotsAt('/documentation');

    expect(document.title).toContain('Documentation');
  });
});
