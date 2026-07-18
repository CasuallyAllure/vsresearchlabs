/**
 * Unit tests for src/lib/compoundVideo.ts — getCompoundVideo() / parseEmbed().
 *
 * Pins the citation-clip resolution order (admin SKU override → the product's
 * own video fields → the COMPOUND_VIDEOS demo map → undefined, which keeps the
 * overlay's media slot hidden) and the TikTok URL → embed-info parse. The
 * productOverrides store is mocked so the override path is exercised without
 * zustand state.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Product } from '../../src/types/product';
import { getCompoundVideo, parseEmbed } from '../../src/lib/compoundVideo';
import { videoOverrideFor } from '../../src/lib/productOverrides';

vi.mock('../../src/lib/productOverrides', () => ({
  videoOverrideFor: vi.fn(() => null),
}));

const videoOverrideForMock = vi.mocked(videoOverrideFor);

/** Minimal product — only the fields getCompoundVideo reads. */
function makeProduct(overrides: Record<string, unknown> = {}): Product {
  return { sku: 'VSR-PEP-TST', slug: 'test-compound', ...overrides } as unknown as Product;
}

beforeEach(() => {
  videoOverrideForMock.mockReset();
  videoOverrideForMock.mockReturnValue(null);
});

describe('getCompoundVideo', () => {
  test('an admin SKU override wins over everything else', () => {
    // Arrange — override present AND product fields AND a demo-map slug.
    const override = { url: 'https://www.tiktok.com/@admin/video/111', title: 'Admin clip' };
    videoOverrideForMock.mockReturnValue(override);
    const product = makeProduct({ slug: 'mots-c', videoUrl: 'https://example.com/static' });

    // Act
    const video = getCompoundVideo(product);

    // Assert
    expect(video).toBe(override);
    expect(videoOverrideForMock).toHaveBeenCalledWith('VSR-PEP-TST');
  });

  test("falls back to the product's own video fields when there is no override", () => {
    const product = makeProduct({
      videoUrl: 'https://www.tiktok.com/@creator/video/222',
      videoTitle: 'Catalog clip',
      videoDescription: 'What this clip covers.',
      videoThumbnail: '/media/test.jpg',
      videoAuthor: 'Creator Name',
    });

    expect(getCompoundVideo(product)).toEqual({
      url: 'https://www.tiktok.com/@creator/video/222',
      title: 'Catalog clip',
      description: 'What this clip covers.',
      thumbnail: '/media/test.jpg',
      author: 'Creator Name',
    });
  });

  test('falls back to the demo map by slug (MOTS-C)', () => {
    const video = getCompoundVideo(makeProduct({ slug: 'mots-c' }));

    expect(video).toMatchObject({
      url: 'https://www.tiktok.com/@kristisawicki/video/7615592662862712077',
      thumbnail: '/media/mots-c.jpg',
    });
  });

  test('returns undefined when nothing is configured — media slot stays hidden', () => {
    expect(getCompoundVideo(makeProduct())).toBeUndefined();
  });
});

describe('parseEmbed', () => {
  test('parses a TikTok video URL into embed info with the creator handle', () => {
    const info = parseEmbed('https://www.tiktok.com/@kristisawicki/video/7615592662862712077');

    expect(info).toEqual({
      provider: 'tiktok',
      embedSrc: 'https://www.tiktok.com/embed/v2/7615592662862712077',
      watchUrl: 'https://www.tiktok.com/@kristisawicki/video/7615592662862712077',
      author: '@kristisawicki',
    });
  });

  test('parses a video URL without a handle — author stays undefined', () => {
    const info = parseEmbed('https://www.tiktok.com/video/12345');

    expect(info).toMatchObject({ provider: 'tiktok', embedSrc: 'https://www.tiktok.com/embed/v2/12345' });
    expect(info?.author).toBeUndefined();
  });

  test('returns null for an unsupported URL', () => {
    expect(parseEmbed('https://www.youtube.com/watch?v=abc123')).toBeNull();
  });
});
