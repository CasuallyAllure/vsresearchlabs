// supabase/functions/resolve-video/index.ts
// Resolve a social video URL (TikTok today) to citation metadata, server-side.
//
// The browser can't read TikTok's oEmbed (CORS) and short links (tiktok.com/t/…)
// need a redirect follow. This function does both: it expands the short link,
// then calls TikTok's public oEmbed to return the author, caption/title, and a
// thumbnail URL. The admin "Fetch from TikTok" button calls this to pre-fill
// the cited-clip fields — same effect we wired by hand for MOTS-C.
//
// THUMBNAILS: oEmbed's thumbnail_url is a TikTok CDN url that is signed and
// EXPIRES. When a `sku` is supplied, this function downloads that image and
// uploads a PERMANENT copy to the public `compound-media` Storage bucket, then
// returns that stable url (and sets `thumbnailExpires: false`). If hosting
// fails (or no sku), it falls back to the expiring CDN url with
// `thumbnailExpires: true`.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected),
//   ALLOWED_ORIGIN (omit for * in dev).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MEDIA_BUCKET = "compound-media";
const UA = "Mozilla/5.0 (compatible; VSRLabs/1.0; +https://vsresearchlabs.com)";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    });
    return res.url || url;
  } catch {
    return url;
  }
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
 * Download the (expiring) thumbnail and upload a permanent copy to the public
 * compound-media bucket. Returns the stable public URL, or null on any failure.
 */
async function hostThumbnail(sku: string, thumbnailUrl: string): Promise<string | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const img = await fetch(thumbnailUrl, { headers: { "User-Agent": UA } });
    if (!img.ok) return null;
    const contentType = img.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const bytes = new Uint8Array(await img.arrayBuffer());
    if (bytes.length === 0) return null;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const path = `clips/${safeKey(sku)}.${ext}`;
    const { error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) return null;

    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    // Cache-bust so a re-fetch of the same SKU shows the new image.
    return data.publicUrl ? `${data.publicUrl}?v=${bytes.length}` : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
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

  // 1. Expand short links to the canonical watch URL.
  const fullUrl = raw.includes("/t/") || /\/[A-Za-z0-9]{6,12}\/?$/.test(new URL(raw).pathname)
    ? await expandUrl(raw)
    : raw;

  const { author: handle, id } = parseTikTok(fullUrl);

  // 2. oEmbed for author name + caption + thumbnail.
  let authorName: string | null = null;
  let title: string | null = null;
  let thumbnailUrl: string | null = null;
  try {
    const oembed = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(fullUrl)}`,
      { headers: { "User-Agent": UA } },
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

  // 3. Host a permanent copy of the thumbnail when we have a SKU to key it by.
  let finalThumb = thumbnailUrl;
  let expires = !!thumbnailUrl;
  if (thumbnailUrl && sku) {
    const hosted = await hostThumbnail(sku, thumbnailUrl);
    if (hosted) {
      finalThumb = hosted;
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
});
