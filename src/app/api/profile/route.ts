export const dynamic = "force-dynamic";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

/** Decode session cookie if URL-encoded from DevTools */
function getSessionCookie(): string | undefined {
  const raw = process.env.INSTAGRAM_SESSION_ID?.trim();
  if (!raw) return undefined;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** Build a cookie header. Includes sessionid if configured, plus the
 *  minimal anonymous cookies that Instagram expects (same as Instaloader). */
function buildCookieHeader(): string {
  const session = getSessionCookie();
  const cookies: string[] = [
    "ig_pr=1",
    "ig_vw=1920",
  ];
  if (session) {
    cookies.push(`sessionid=${session}`);
    cookies.push(`ds_user_id=0`);
  } else {
    cookies.push("sessionid=");
    cookies.push("mid=");
    cookies.push("csrftoken=");
    cookies.push("ds_user_id=");
    cookies.push("s_network=");
  }
  return cookies.join("; ");
}

/** Default HTTP headers modeled after Instaloader */
function buildDefaultHeaders(): Record<string, string> {
  return {
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "en-US,en;q=0.8",
    "Connection": "keep-alive",
    "Host": "www.instagram.com",
    "Origin": "https://www.instagram.com",
    "Referer": "https://www.instagram.com/",
    "User-Agent": USER_AGENT,
  };
}

/** Headers for GraphQL queries (no Connection/Content-Length) */
function buildGraphqlHeaders(referer?: string): Record<string, string> {
  const h = buildDefaultHeaders();
  delete h["Connection"];
  delete h["Host"];
  delete h["Origin"];
  h["authority"] = "www.instagram.com";
  h["scheme"] = "https";
  h["accept"] = "*/*";
  if (referer) {
    h["referer"] = referer;
  }
  h["cookie"] = buildCookieHeader();
  return h;
}

/* ------------------------------------------------------------------ */
/*  Doc ID GraphQL Query (POST, modeled after Instaloader)            */
/* ------------------------------------------------------------------ */

async function docIdGraphqlQuery(docId: string, variables: Record<string, unknown>): Promise<any> {
  const url = "https://www.instagram.com/graphql/query";
  const headers = buildGraphqlHeaders("https://www.instagram.com/");

  const body = new URLSearchParams();
  body.set("variables", JSON.stringify(variables));
  body.set("doc_id", docId);
  body.set("server_timestamps", "true");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400) {
      console.error(`GraphQL redirect ${res.status} -> ${res.headers.get("location")}`);
      return null;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`GraphQL error ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }
    return res.json();
  } catch (err) {
    console.error("docIdGraphqlQuery error:", err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Profile fetch via search Doc ID (Instaloader approach)            */
/* ------------------------------------------------------------------ */

async function fetchProfileBySearch(username: string) {
  const data = await docIdGraphqlQuery("26347858941511777", {
    hasQuery: true,
    query: username,
  });

  if (!data?.data) return null;

  const users = data.data.xdt_api__v1__fbsearch__non_profiled_serp?.users;
  if (!Array.isArray(users)) return null;

  for (const user of users) {
    if (user.username?.toLowerCase() === username.toLowerCase()) {
      return normalizeUser(user);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Fallback: web_profile_info API endpoint                           */
/* ------------------------------------------------------------------ */

async function fetchWebProfileInfo(username: string) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const headers: Record<string, string> = {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "referer": `https://www.instagram.com/${encodeURIComponent(username)}/`,
    "sec-ch-ua": '"Not.A/Brand";v="8", "Chromium";v="134", "Google Chrome";v="134"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": USER_AGENT,
    "x-asbd-id": "129477",
    "x-ig-app-id": "936619743392459",
    "x-requested-with": "XMLHttpRequest",
    "cookie": buildCookieHeader(),
  };

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

  // Try hd_profile_pic_url_info first (highest res when logged in)
  const hdInfo = (raw.hd_profile_pic_url_info as Record<string, unknown>)?.url;
  const hdFallback = raw.profile_pic_url_hd || raw.profile_pic_url;

  return {
    username,
    full_name: String(raw.full_name || username),
    biography: String(raw.biography || ""),
    followers: getNum(edgeFollowedBy ?? raw.follower_count),
    following: getNum(edgeFollow ?? raw.following_count),
    posts: getNum(edgeMedia ?? raw.media_count),
    profile_pic_url: String(raw.profile_pic_url || ""),
    hd_profile_pic_url: String(hdInfo || hdFallback || raw.profile_pic_url || ""),
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
    // Strategy 1: Doc ID GraphQL search (Instaloader approach)
    const user = await fetchProfileBySearch(username);
    if (user) {
      return Response.json({
        ...user,
        profile_pic_url: cleanUrl(user.profile_pic_url),
        hd_profile_pic_url: cleanUrl(user.hd_profile_pic_url),
        has_session: hasSession,
        source: "doc_id_search",
      });
    }

    // Strategy 2: web_profile_info API fallback
    const info = await fetchWebProfileInfo(username);
    if (info?.data?.user) {
      const u = normalizeUser(info.data.user as Record<string, unknown>);
      if (u) {
        return Response.json({
          ...u,
          profile_pic_url: cleanUrl(u.profile_pic_url),
          hd_profile_pic_url: cleanUrl(u.hd_profile_pic_url),
          has_session: hasSession,
          source: "web_profile_info",
        });
      }
    }

    if (info?.message) {
      console.error("Instagram API message:", info.message);
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
