// supabase/functions/resolve-video/index.ts
// Resolve a social video URL (TikTok today) to citation metadata, server-side.
//
// The browser can't read TikTok's oEmbed (CORS) and short links (tiktok.com/t/…)
// need a redirect follow. This function does both: it expands the short link,
// then calls TikTok's public oEmbed to return the author, caption/title, and a
// thumbnail URL. The admin "Fetch from TikTok" button calls this to pre-fill
// the cited-clip fields — same effect we wired by hand for MOTS-C.
//
// NOTE on thumbnails: oEmbed's thumbnail_url is a TikTok CDN url that is signed
// and EXPIRES. It's fine for a quick preview, but for a permanent poster host
// the image (e.g. /public/media/<slug>.jpg, or Supabase Storage) and paste that
// stable url into the thumbnail field. The response flags this via
// `thumbnailExpires: true`.
//
// Required env vars: ALLOWED_ORIGIN (omit for * in dev).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { url?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const raw = (payload.url ?? "").trim();
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

  return json({
    provider: "tiktok",
    url: fullUrl,
    videoId: id ?? null,
    author: authorName,
    handle: handle ?? null,
    title,
    thumbnailUrl,
    thumbnailExpires: !!thumbnailUrl, // host a stable copy for production
  });
});
