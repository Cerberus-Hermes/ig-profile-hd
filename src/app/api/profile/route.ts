export const dynamic = "force-dynamic";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

/** Decode session cookie if URL-encoded from DevTools */
function getSessionCookie(): string | undefined {
  const raw = process.env.INSTAGRAM_SESSION_ID?.trim();
  if (!raw) return undefined;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function buildCookieHeader(): string | undefined {
  const session = getSessionCookie();
  if (!session) return undefined;
  return `sessionid=${session}`;
}

/* ------------------------------------------------------------------ */
/*  STRATEGY 1: Scrape the normal HTML profile page                   */
/*  Instagram embeds user data as JSON inside <script> tags           */
/* ------------------------------------------------------------------ */

async function scrapeProfilePage(username: string) {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;

  const headers: Record<string, string> = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "max-age=0",
    "sec-ch-ua": '"Not.A/Brand";v="8", "Chromium";v="134", "Google Chrome";v="134"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": USER_AGENT,
  };

  const cookie = buildCookieHeader();
  if (cookie) headers["cookie"] = cookie;

  try {
    const res = await fetch(url, { headers, redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      console.error(`HTML scrape redirect ${res.status} -> ${res.headers.get("location")}`);
      return null;
    }
    if (!res.ok) {
      console.error(`HTML scrape HTTP ${res.status}`);
      return null;
    }

    const html = await res.text();

    // Strategy 1a: Look for window._sharedData (older Instagram)
    const sharedMatch = html.match(/window\._sharedData\s*=\s*({.+?});<\/script>/);
    if (sharedMatch) {
      const data = JSON.parse(sharedMatch[1]);
      const user = data?.entry_data?.ProfilePage?.[0]?.graphql?.user;
      if (user) return normalizeUser(user);
    }

    // Strategy 1b: Look for <script type="application/json" data-sjs>
    // Instagram injects multiple JSON blobs; one contains the user object
    {
      const re = /<script type="application\/json"[^>]*>(.+?)<\/script>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        try {
          const blob = JSON.parse(m[1]);
          const raw = extractUserFromBlob(blob);
          if (raw) return normalizeUser(raw as Record<string, unknown>);
        } catch { /* ignore malformed JSON */ }
      }
    }

    // Strategy 1c: Look for raw "profile_pic_url_hd" in any script block
    {
      const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const script = m[1];
        if (script.includes('"profile_pic_url"') || script.includes('"username"')) {
          try {
            const objMatch = script.match(/{"biography"[\s\S]*?"username":"[^"]+"[\s\S]*?}/);
            if (objMatch) {
              const obj = JSON.parse(objMatch[0]);
              if (obj.username) return normalizeUser(obj as Record<string, unknown>);
            }
          } catch { /* ignore */ }
        }
      }
    }

    console.error("Could not extract user data from HTML");
    return null;
  } catch (err) {
    console.error("scrapeProfilePage error:", err);
    return null;
  }
}

/** Instagram wraps data in Relay-style objects. Drill down to find user. */
function extractUserFromBlob(blob: unknown): unknown {
  if (!blob || typeof blob !== "object") return null;

  // Direct user object
  if ("username" in (blob as Record<string, unknown>) && "profile_pic_url" in (blob as Record<string, unknown>)) {
    return blob;
  }

  // Instagram wraps data under require() payloads
  const obj = blob as Record<string, unknown>;

  // Look for "user" key anywhere
  if (obj.user && typeof obj.user === "object" && "username" in (obj.user as Record<string, unknown>)) {
    return obj.user;
  }

  // Look in common Instagram wrapper keys
  for (const key of ["data", "result", "rootView", "props", "page", "entry_data", "graphql"]) {
    if (obj[key] && typeof obj[key] === "object") {
      const nested = extractUserFromBlob(obj[key]);
      if (nested) return nested;
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  STRATEGY 2: Fallback to the API endpoint                          */
/* ------------------------------------------------------------------ */

async function fetchWebProfileInfo(username: string) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const headers: Record<string, string> = {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "referer": `https://www.instagram.com/${encodeURIComponent(username)}/`,
    "sec-ch-prefers-color-scheme": "dark",
    "sec-ch-ua": '"Not.A/Brand";v="8", "Chromium";v="134", "Google Chrome";v="134"',
    "sec-ch-ua-full-version-list": '"Not.A/Brand";v="8.0.0.0", "Chromium";v="134.0.6998.118", "Google Chrome";v="134.0.6998.118"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-model": '""',
    "sec-ch-ua-platform": '"Windows"',
    "sec-ch-ua-platform-version": '"19.0.0"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": USER_AGENT,
    "x-asbd-id": "129477",
    "x-ig-app-id": "936619743392459",
    "x-requested-with": "XMLHttpRequest",
  };

  const cookie = buildCookieHeader();
  if (cookie) headers["cookie"] = cookie;

  try {
    const res = await fetch(url, { headers, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`API error ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }
    return res.json();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Normalization helpers                                             */
/* ------------------------------------------------------------------ */

interface NormalizedUser {
  username: string;
  full_name: string;
  biography: string;
  followers: number;
  following: number;
  posts: number;
  profile_pic_url: string;
  hd_profile_pic_url: string;
  is_private: boolean;
  is_verified: boolean;
}

function normalizeUser(raw: Record<string, unknown>): NormalizedUser | null {
  const username = String(raw.username || "");
  if (!username) return null;

  const getNum = (val: unknown): number => {
    if (typeof val === "number") return val;
    if (typeof val === "string") return parseInt(val, 10) || 0;
    return 0;
  };

  const edgeFollowedBy = (raw.edge_followed_by as Record<string, unknown>)?.count;
  const edgeFollow = (raw.edge_follow as Record<string, unknown>)?.count;
  const edgeMedia = (raw.edge_owner_to_timeline_media as Record<string, unknown>)?.count;

  const hd =
    (raw.hd_profile_pic_url_info as Record<string, unknown>)?.url ||
    raw.profile_pic_url_hd ||
    raw.profile_pic_url;

  return {
    username,
    full_name: String(raw.full_name || username),
    biography: String(raw.biography || ""),
    followers: getNum(edgeFollowedBy ?? raw.follower_count),
    following: getNum(edgeFollow ?? raw.following_count),
    posts: getNum(edgeMedia ?? raw.media_count),
    profile_pic_url: String(raw.profile_pic_url || ""),
    hd_profile_pic_url: String(hd || raw.profile_pic_url || ""),
    is_private: Boolean(raw.is_private),
    is_verified: Boolean(raw.is_verified),
  };
}

/** Strip Instagram CDN size parameters */
function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("s");
    u.searchParams.delete("w");
    u.searchParams.delete("h");
    u.searchParams.delete("c");
    return u.toString();
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------ */
/*  Main handler                                                      */
/* ------------------------------------------------------------------ */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username")?.trim().toLowerCase();

  if (!username) {
    return Response.json({ error: "Username required" }, { status: 400 });
  }

  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    return Response.json({ error: "Invalid username format" }, { status: 400 });
  }

  const hasSession = !!getSessionCookie();

  try {
    // Strategy 1: HTML scrape (looks like normal browser visit)
    const scraped = await scrapeProfilePage(username);
    if (scraped) {
      return Response.json({
        ...scraped,
        profile_pic_url: cleanUrl(scraped.profile_pic_url),
        hd_profile_pic_url: cleanUrl(scraped.hd_profile_pic_url),
        has_session: hasSession,
        source: "html_scrape",
      });
    }

    // Strategy 2: API fallback
    const api = await fetchWebProfileInfo(username);
    if (api?.data?.user) {
      const user = normalizeUser(api.data.user as Record<string, unknown>);
      if (user) {
        return Response.json({
          ...user,
          profile_pic_url: cleanUrl(user.profile_pic_url),
          hd_profile_pic_url: cleanUrl(user.hd_profile_pic_url),
          has_session: hasSession,
          source: "api",
        });
      }
    }

    if (api?.message) {
      console.error("Instagram API message:", api.message);
    }

    return Response.json(
      { error: "Profile not found or blocked by Instagram" },
      { status: 404 }
    );
  } catch (err) {
    console.error("Profile fetch error:", err);
    return Response.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}
