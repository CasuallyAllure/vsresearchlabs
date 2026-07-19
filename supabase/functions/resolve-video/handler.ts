// supabase/functions/resolve-video/handler.ts
// Resolve a social video URL (TikTok today) to citation metadata — the whole
// orchestration, Deno-free.
//
// Extracted verbatim from index.ts (2026-07-18) so vitest can drive every
// decision path directly (OPTIONS preflight, admin gate, method gate, URL
// validation, the pre- AND post-redirect host whitelists, short-link
// expansion, oEmbed best-effort failure, thumbnail hosting fallback + the
// 5 MB oversize rejection, exact response contract) — same split as
// place-order/handler.ts. index.ts is now a thin Deno shim: it reads env
// once at cold start, wires the real createClient/requireAdmin/fetch, and
// mounts the handler this factory returns under Deno.serve. NOTHING in this
// file may reference Deno globals or jsr:/npm: imports — that is the whole
// point of the split. (requireAdmin and createClient are injected because
// adminGate.ts/supabase-js live behind jsr: imports tsc cannot resolve; the
// structural types below name only the slices this handler uses.)
//
// THUMBNAILS: oEmbed's thumbnail_url is a TikTok CDN url that is signed and
// EXPIRES. When a `sku` is supplied, this function downloads that image and
// uploads a PERMANENT copy to the public `compound-media` Storage bucket, then
// returns that stable url (and sets `thumbnailExpires: false`). If hosting
// fails (or no sku), it falls back to the expiring CDN url with
// `thumbnailExpires: true`.
//
// Admin-only: requires a valid session JWT for an active admin (see
// ../_shared/adminGate.ts). The resolved TikTok URL's host must match the
// tiktok.com domain whitelist, outbound fetches time out at 10s, and the
// thumbnail download is capped at 5 MB.

const MEDIA_BUCKET = "compound-media";
const UA = "Mozilla/5.0 (compatible; VSRLabs/1.0; +https://vsresearchlabs.com)";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const ALLOWED_VIDEO_HOSTS = new Set(["tiktok.com", "www.tiktok.com", "vm.tiktok.com"]);

/** True if `host` is exactly tiktok.com/www.tiktok.com/vm.tiktok.com, or ends with .tiktok.com. */
function isAllowedVideoHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return ALLOWED_VIDEO_HOSTS.has(normalized) || normalized.endsWith(".tiktok.com");
}

/** Pull the @handle and numeric id out of a canonical TikTok URL. */
function parseTikTok(url: string): { author?: string; id?: string } {
  const author = url.match(/@([\w.]+)/)?.[1];
  const id = url.match(/\/video\/(\d+)/)?.[1];
  return { author: author ? `@${author}` : undefined, id };
}

/** A filesystem-safe object key from a SKU. */
function safeKey(sku: string): string {
  return sku.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

/**
 * Read a Response body up to `maxBytes`, aborting (returning null) if the
 * stream exceeds the cap. Content-Length is checked first as a fast-path,
 * but the actual bytes read are also enforced since Content-Length can be
 * absent or wrong.
 */
async function readBodyCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declaredLength = res.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maxBytes) return null;

  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

interface HostThumbnailResult {
  url: string | null;
  /** True when the download exceeded MAX_THUMBNAIL_BYTES — callers reject with 400. */
  isOversize: boolean;
}

// ---------------------------------------------------------------------------
// Config + injected dependencies (index.ts supplies the real ones)
// ---------------------------------------------------------------------------

/** Env-derived configuration — index.ts reads Deno.env once at cold start
 *  and passes the resolved values here, preserving the old module-load
 *  semantics. */
export interface ResolveVideoHandlerConfig {
  supabaseUrl: string;
  serviceKey: string;
  corsHeaders: Record<string, string>;
}

/** Structural mirror of ../_shared/adminGate.ts's AdminGateResult (that
 *  module imports supabase-js from jsr:, so it can only be referenced from
 *  the Deno shim). */
export interface AdminGateResult {
  ok: boolean;
  status: number;
  body?: { error: string };
}

/** The structural slice of a supabase-js client this handler actually uses:
 *  Storage upload + public-url lookup on the compound-media bucket. */
export interface VideoStorageBucket {
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ): Promise<{ error: { message?: string } | null }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
}

export interface VideoSupabaseClient {
  storage: { from(bucket: string): VideoStorageBucket };
}

/** Runtime seams. Destructured below under the exact names the body has
 *  always used (`fetch` deliberately shadows the global inside the
 *  factory). */
export interface ResolveVideoHandlerDeps {
  createClient: (url: string, key: string) => VideoSupabaseClient;
  requireAdmin: (req: Request) => Promise<AdminGateResult>;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export function createResolveVideoHandler(
  cfg: ResolveVideoHandlerConfig,
  deps: ResolveVideoHandlerDeps,
): (req: Request) => Promise<Response> {
  const SUPABASE_URL = cfg.supabaseUrl;
  const SERVICE_KEY = cfg.serviceKey;

  const CORS_HEADERS = cfg.corsHeaders;

  const { createClient, requireAdmin, fetch } = deps;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Follow redirects on a short link (tiktok.com/t/…) to the canonical URL. */
async function expandUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return res.url || url;
  } catch {
    return url;
  }
}

/**
 * Download the (expiring) thumbnail and upload a permanent copy to the public
 * compound-media bucket. Returns the stable public URL, null on ordinary
 * failure (caller falls back to the expiring CDN url), or isOversize when the
 * download blew the 5 MB cap.
 */
async function hostThumbnail(sku: string, thumbnailUrl: string): Promise<HostThumbnailResult> {
  const failure: HostThumbnailResult = { url: null, isOversize: false };
  if (!SUPABASE_URL || !SERVICE_KEY) return failure;
  try {
    const img = await fetch(thumbnailUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!img.ok) return failure;
    const contentType = img.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const bytes = await readBodyCapped(img, MAX_THUMBNAIL_BYTES);
    if (bytes === null) return { url: null, isOversize: true };
    if (bytes.length === 0) return failure;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const path = `clips/${safeKey(sku)}.${ext}`;
    const { error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) return failure;

    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    // Cache-bust so a re-fetch of the same SKU shows the new image.
    return data.publicUrl
      ? { url: `${data.publicUrl}?v=${bytes.length}`, isOversize: false }
      : failure;
  } catch {
    return failure;
  }
}

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    const gate = await requireAdmin(req);
    if (!gate.ok) return json(gate.body, gate.status);

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    let payload: { url?: string; sku?: string };
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const raw = (payload.url ?? "").trim();
    const sku = (payload.sku ?? "").trim();
    if (!raw || !/^https?:\/\//i.test(raw)) {
      return json({ error: "A full http(s) URL is required" }, 400);
    }

    // 1. Whitelist the SUBMITTED host before any outbound fetch (no SSRF via
    //    expandUrl), then expand short links to the canonical watch URL.
    let rawParsed: URL;
    try {
      rawParsed = new URL(raw);
    } catch {
      return json({ error: "A full http(s) URL is required" }, 400);
    }
    if (!isAllowedVideoHost(rawParsed.host)) {
      return json({ error: "URL must resolve to a tiktok.com domain" }, 400);
    }

    const fullUrl = raw.includes("/t/") || /\/[A-Za-z0-9]{6,12}\/?$/.test(rawParsed.pathname)
      ? await expandUrl(raw)
      : raw;

    // 2. Domain whitelist on the FINAL resolved URL (post-redirect).
    let resolvedHost: string;
    try {
      resolvedHost = new URL(fullUrl).host;
    } catch {
      return json({ error: "Could not parse the resolved URL" }, 400);
    }
    if (!isAllowedVideoHost(resolvedHost)) {
      return json({ error: "URL must resolve to a tiktok.com domain" }, 400);
    }

    const { author: handle, id } = parseTikTok(fullUrl);

    // 3. oEmbed for author name + caption + thumbnail.
    let authorName: string | null = null;
    let title: string | null = null;
    let thumbnailUrl: string | null = null;
    try {
      const oembed = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(fullUrl)}`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (oembed.ok) {
        const data = await oembed.json();
        authorName = data.author_name ?? null;
        title = data.title ?? null;
        thumbnailUrl = data.thumbnail_url ?? null;
      }
    } catch {
      // oEmbed best-effort; the URL + handle still resolve.
    }

    // 4. Host a permanent copy of the thumbnail when we have a SKU to key it by.
    let finalThumb = thumbnailUrl;
    let expires = !!thumbnailUrl;
    if (thumbnailUrl && sku) {
      const hosted = await hostThumbnail(sku, thumbnailUrl);
      if (hosted.isOversize) {
        return json({ error: "Thumbnail exceeds the 5 MB size limit" }, 400);
      }
      if (hosted.url) {
        finalThumb = hosted.url;
        expires = false;
      }
    }

    return json({
      provider: "tiktok",
      url: fullUrl,
      videoId: id ?? null,
      author: authorName,
      handle: handle ?? null,
      title,
      thumbnailUrl: finalThumb,
      thumbnailExpires: expires, // false → permanently hosted in compound-media
    });
  };
}
