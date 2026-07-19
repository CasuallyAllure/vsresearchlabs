/**
 * Orchestration suite for the resolve-video handler
 * (supabase/functions/resolve-video/handler.ts) — the admin TikTok citation
 * resolver. Pins the gate ordering, URL validation, the pre- AND
 * post-redirect host whitelists (SSRF fences), short-link expansion +
 * failure fallback, oEmbed best-effort behavior, thumbnail hosting (upload
 * path/content-type/cache-bust, every fallback branch, the 5 MB oversize
 * 400), and the exact response contract.
 */

import { describe, expect, test } from 'vitest';
import {
  GATE_FAIL,
  TEST_CORS,
  jsonRes,
  makeResolveVideoHarness,
  readJson,
  responseWithUrl,
  videoRequest,
  type ResolveVideoHarness,
} from '../helpers/miscFnsHarness';

const CANONICAL = 'https://www.tiktok.com/@labdoc/video/7301234567890123456';
const OEMBED_PART = 'https://www.tiktok.com/oembed?url=';
const THUMB_CDN = 'https://p16-sign.tiktokcdn-us.com/obj/thumb.jpeg';

function withOembed(
  h: ResolveVideoHarness,
  data: Record<string, unknown> = {
    author_name: 'Lab Doc',
    title: 'BPC-157 explained',
    thumbnail_url: THUMB_CDN,
  },
): ResolveVideoHarness {
  h.fetchMock.onUrl(OEMBED_PART, () => jsonRes(data));
  return h;
}

function withThumbnail(
  h: ResolveVideoHarness,
  opts: { contentType?: string; bytes?: number; headers?: Record<string, string> } = {},
): ResolveVideoHarness {
  h.fetchMock.onUrl(THUMB_CDN, () => {
    const body = new Uint8Array(opts.bytes ?? 1024).fill(7);
    return new Response(body, {
      status: 200,
      headers: { 'content-type': opts.contentType ?? 'image/jpeg', ...opts.headers },
    });
  });
  return h;
}

describe('preflight + gates', () => {
  test('QUIRK (pinned): OPTIONS returns 200 with a literal "ok" body (not 204), before the admin gate', async () => {
    const h = makeResolveVideoHarness();
    h.gateResult = GATE_FAIL;

    const res = await h.handler(videoRequest(undefined, { method: 'OPTIONS' }));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      TEST_CORS['Access-Control-Allow-Origin'],
    );
    expect(h.gateCalls).toHaveLength(0);
  });

  test('failed admin gate → its status/body verbatim, no outbound fetch', async () => {
    const h = makeResolveVideoHarness();
    h.gateResult = GATE_FAIL;

    const res = await h.handler(videoRequest({ url: CANONICAL }));

    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: 'Unauthorized' });
    expect(h.fetchMock.calls).toHaveLength(0);
  });

  test('QUIRK (pinned): the admin gate runs before the method gate, so GET with a failing gate gets 401, not 405', async () => {
    const h = makeResolveVideoHarness();
    h.gateResult = GATE_FAIL;

    expect((await h.handler(videoRequest(undefined, { method: 'GET' }))).status).toBe(401);
  });

  test('gate ok + non-POST → 405', async () => {
    const h = makeResolveVideoHarness();
    const res = await h.handler(videoRequest(undefined, { method: 'GET' }));

    expect(res.status).toBe(405);
    expect(await readJson(res)).toEqual({ error: 'Method not allowed' });
  });
});

describe('URL validation + host whitelist (SSRF fences)', () => {
  test('invalid JSON body → 400', async () => {
    const h = makeResolveVideoHarness();
    const res = await h.handler(videoRequest(undefined, { rawBody: '{nope' }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: 'Invalid JSON body' });
  });

  test.each([
    ['missing url', {}],
    ['empty url', { url: '   ' }],
    ['non-http scheme', { url: 'ftp://tiktok.com/x' }],
    ['bare host', { url: 'tiktok.com/@a/video/1' }],
  ])('%s → 400 full-URL error', async (_label, body) => {
    const h = makeResolveVideoHarness();
    const res = await h.handler(videoRequest(body));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: 'A full http(s) URL is required' });
    expect(h.fetchMock.calls).toHaveLength(0);
  });

  test.each([
    'https://evil.example/@a/video/1',
    'https://eviltiktok.com/@a/video/1', // suffix without the dot must NOT pass
    'https://tiktok.com.evil.example/@a/video/1',
  ])('submitted host %s is rejected BEFORE any outbound fetch', async (url) => {
    const h = makeResolveVideoHarness();
    const res = await h.handler(videoRequest({ url }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: 'URL must resolve to a tiktok.com domain' });
    expect(h.fetchMock.calls).toHaveLength(0);
  });

  test.each(['https://TikTok.com/@a/video/11111', 'https://sub.tiktok.com/@a/video/11111'])(
    'host %s passes the whitelist (case-insensitive, .tiktok.com subdomains)',
    async (url) => {
      const h = withOembed(makeResolveVideoHarness(), {});
      const res = await h.handler(videoRequest({ url }));

      expect(res.status).toBe(200);
    },
  );

  test('a short link that redirects OFF tiktok.com is rejected post-expansion', async () => {
    const h = makeResolveVideoHarness();
    h.fetchMock.on(
      (_url, init) => init?.method === 'HEAD',
      () => responseWithUrl('https://evil.example/landing'),
    );

    const res = await h.handler(videoRequest({ url: 'https://vm.tiktok.com/t/ZM6abc123/' }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: 'URL must resolve to a tiktok.com domain' });
    // The expansion fetch happened (HEAD), but nothing else.
    expect(h.fetchMock.calls).toHaveLength(1);
  });
});

describe('short-link expansion', () => {
  test('/t/ links are expanded via redirect-following HEAD and the final URL is used', async () => {
    const h = withOembed(makeResolveVideoHarness());
    withThumbnail(h);
    h.fetchMock.on(
      (_url, init) => init?.method === 'HEAD',
      () => responseWithUrl(CANONICAL),
    );

    const res = await h.handler(videoRequest({ url: 'https://www.tiktok.com/t/ZM6abc123/' }));
    const body = await readJson(res);

    expect(res.status).toBe(200);
    expect(body.url).toBe(CANONICAL);
    expect(body.handle).toBe('@labdoc');
    expect(body.videoId).toBe('7301234567890123456');
    const head = h.fetchMock.calls[0];
    expect(head.init?.method).toBe('HEAD');
    expect(head.init?.redirect).toBe('follow');
  });

  test('short-code paths (vm.tiktok.com/<code>) also trigger expansion', async () => {
    const h = withOembed(makeResolveVideoHarness(), {});
    h.fetchMock.on(
      (_url, init) => init?.method === 'HEAD',
      () => responseWithUrl(CANONICAL),
    );

    const res = await h.handler(videoRequest({ url: 'https://vm.tiktok.com/ZM6abc123' }));

    expect((await readJson(res)).url).toBe(CANONICAL);
  });

  test('expansion failure falls back to the submitted URL (best-effort)', async () => {
    const h = withOembed(makeResolveVideoHarness(), {});
    h.fetchMock.on(
      (_url, init) => init?.method === 'HEAD',
      () => {
        throw new Error('HEAD blocked');
      },
    );

    const shortUrl = 'https://vm.tiktok.com/ZM6abc123';
    const res = await h.handler(videoRequest({ url: shortUrl }));

    expect(res.status).toBe(200);
    expect((await readJson(res)).url).toBe(shortUrl);
  });

  test('canonical URLs are NOT expanded (no HEAD fetch)', async () => {
    const h = withOembed(makeResolveVideoHarness());
    withThumbnail(h);

    await h.handler(videoRequest({ url: CANONICAL }));

    expect(h.fetchMock.calls.some((c) => c.init?.method === 'HEAD')).toBe(false);
  });
});

describe('oEmbed + response contract', () => {
  test('full resolve without sku → metadata with the EXPIRING CDN thumbnail', async () => {
    const h = withOembed(makeResolveVideoHarness());

    const res = await h.handler(videoRequest({ url: CANONICAL }));
    const body = await readJson(res);

    expect(res.status).toBe(200);
    expect(body).toEqual({
      provider: 'tiktok',
      url: CANONICAL,
      videoId: '7301234567890123456',
      author: 'Lab Doc',
      handle: '@labdoc',
      title: 'BPC-157 explained',
      thumbnailUrl: THUMB_CDN,
      thumbnailExpires: true,
    });
    const oembedCall = h.fetchMock.calls.find((c) => c.url.startsWith(OEMBED_PART));
    expect(oembedCall?.url).toBe(`${OEMBED_PART}${encodeURIComponent(CANONICAL)}`);
    expect(h.storage.uploads).toHaveLength(0);
  });

  test('oEmbed non-ok → nulls for author/title/thumbnail; URL + handle still resolve', async () => {
    const h = makeResolveVideoHarness();
    h.fetchMock.onUrl(OEMBED_PART, () => new Response('nope', { status: 403 }));

    const res = await h.handler(videoRequest({ url: CANONICAL, sku: 'VSR-RS-BPC' }));
    const body = await readJson(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      author: null,
      title: null,
      thumbnailUrl: null,
      thumbnailExpires: false,
      handle: '@labdoc',
      videoId: '7301234567890123456',
    });
    expect(h.storage.uploads).toHaveLength(0);
  });

  test('oEmbed throw is swallowed (best-effort)', async () => {
    const h = makeResolveVideoHarness();
    h.fetchMock.onUrl(OEMBED_PART, () => {
      throw new Error('oembed down');
    });

    const res = await h.handler(videoRequest({ url: CANONICAL }));

    expect(res.status).toBe(200);
    expect((await readJson(res)).author).toBeNull();
  });

  test('no @handle / video id in the URL → nulls', async () => {
    const h = withOembed(makeResolveVideoHarness(), {});

    const res = await h.handler(videoRequest({ url: 'https://www.tiktok.com/some/page/somewhere' }));
    const body = await readJson(res);

    expect(body.handle).toBeNull();
    expect(body.videoId).toBeNull();
  });
});

describe('thumbnail hosting (sku supplied)', () => {
  test('downloads the thumbnail and returns the PERMANENT public URL with a cache-bust', async () => {
    const h = withThumbnail(withOembed(makeResolveVideoHarness()), { bytes: 2048 });

    const res = await h.handler(videoRequest({ url: CANONICAL, sku: 'VSR-RS-BPC' }));
    const body = await readJson(res);

    expect(res.status).toBe(200);
    expect(body.thumbnailUrl).toBe('http://cdn.mock/clips/VSR-RS-BPC.jpg?v=2048');
    expect(body.thumbnailExpires).toBe(false);

    expect(h.createClientCalls).toEqual([{ url: 'http://supabase.mock', key: 'service-role-key' }]);
    expect(h.storage.uploads).toHaveLength(1);
    const upload = h.storage.uploads[0];
    expect(upload.bucket).toBe('compound-media');
    expect(upload.path).toBe('clips/VSR-RS-BPC.jpg');
    expect(upload.options).toEqual({ contentType: 'image/jpeg', upsert: true });
    expect(upload.bytes.byteLength).toBe(2048);
  });

  test.each([
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['application/octet-stream', 'jpg'],
  ])('content-type %s maps to a .%s object key', async (contentType, ext) => {
    const h = withThumbnail(withOembed(makeResolveVideoHarness()), { contentType });

    await h.handler(videoRequest({ url: CANONICAL, sku: 'sku1' }));

    expect(h.storage.uploads[0].path).toBe(`clips/sku1.${ext}`);
    expect(h.storage.uploads[0].options.contentType).toBe(contentType);
  });

  test('the object key sanitizes hostile SKUs', async () => {
    const h = withThumbnail(withOembed(makeResolveVideoHarness()));

    await h.handler(videoRequest({ url: CANONICAL, sku: '../etc/passwd $(x)' }));

    expect(h.storage.uploads[0].path).toBe('clips/.._etc_passwd___x_.jpg');
  });

  test('declared Content-Length over 5 MB → 400 oversize rejection, no upload', async () => {
    const h = withOembed(makeResolveVideoHarness());
    h.fetchMock.onUrl(THUMB_CDN, () =>
      new Response(new Uint8Array(10), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(6 * 1024 * 1024) },
      }),
    );

    const res = await h.handler(videoRequest({ url: CANONICAL, sku: 'sku1' }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: 'Thumbnail exceeds the 5 MB size limit' });
    expect(h.storage.uploads).toHaveLength(0);
  });

  test('a stream that exceeds 5 MB without Content-Length is also rejected with 400', async () => {
    const h = withOembed(makeResolveVideoHarness());
    h.fetchMock.onUrl(THUMB_CDN, () => {
      const chunk = new Uint8Array(3 * 1024 * 1024);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });

    const res = await h.handler(videoRequest({ url: CANONICAL, sku: 'sku1' }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: 'Thumbnail exceeds the 5 MB size limit' });
  });

  async function expectCdnFallback(h: ResolveVideoHarness): Promise<void> {
    const res = await h.handler(videoRequest({ url: CANONICAL, sku: 'sku1' }));
    const body = await readJson(res);
    expect(res.status).toBe(200);
    expect(body.thumbnailUrl).toBe(THUMB_CDN);
    expect(body.thumbnailExpires).toBe(true);
  }

  test('thumbnail download non-ok → falls back to the expiring CDN url', async () => {
    const h = withOembed(makeResolveVideoHarness());
    h.fetchMock.onUrl(THUMB_CDN, () => new Response('expired', { status: 403 }));

    await expectCdnFallback(h);
    expect(h.storage.uploads).toHaveLength(0);
  });

  test('thumbnail download throws → CDN fallback', async () => {
    const h = withOembed(makeResolveVideoHarness());
    h.fetchMock.onUrl(THUMB_CDN, () => {
      throw new Error('cdn refused');
    });

    await expectCdnFallback(h);
  });

  test('empty (0-byte) download → CDN fallback, no upload', async () => {
    const h = withOembed(makeResolveVideoHarness());
    h.fetchMock.onUrl(THUMB_CDN, () => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } }));

    await expectCdnFallback(h);
    expect(h.storage.uploads).toHaveLength(0);
  });

  test('storage upload error → CDN fallback', async () => {
    const h = withThumbnail(withOembed(makeResolveVideoHarness()));
    h.storage.uploadError = { message: 'bucket missing' };

    await expectCdnFallback(h);
    expect(h.storage.uploads).toHaveLength(1); // attempted, then fell back
  });

  test('missing publicUrl → CDN fallback', async () => {
    const h = withThumbnail(withOembed(makeResolveVideoHarness()));
    h.storage.publicUrlFor = () => '';

    await expectCdnFallback(h);
  });

  test('missing supabase env → hosting skipped entirely, CDN fallback', async () => {
    const h = withThumbnail(withOembed(makeResolveVideoHarness({ supabaseUrl: '' })));

    await expectCdnFallback(h);
    expect(h.createClientCalls).toHaveLength(0);
    // The thumbnail download itself never happened either.
    expect(h.fetchMock.calls.some((c) => c.url === THUMB_CDN)).toBe(false);
  });
});
