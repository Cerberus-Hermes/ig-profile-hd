export const dynamic = "force-dynamic";

const IG_APP_ID = "936619743392459";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

/** Extract and decode the session cookie from the environment.
 *  DevTools shows cookies URL-encoded (%3A for :), so we decode first. */
function getSessionCookie(): string | undefined {
  const raw = process.env.INSTAGRAM_SESSION_ID?.trim();
  if (!raw) return undefined;
  try {
    // DevTools often URL-encodes cookie values. Decode if needed.
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Build request headers. Includes session cookie if configured. */
function buildHeaders(username: string): Record<string, string> {
  const headers: Record<string, string> = {
    "x-ig-app-id": IG_APP_ID,
    "User-Agent": USER_AGENT,
    "Accept": "*/*",
    "Referer": `https://www.instagram.com/${encodeURIComponent(username)}/`,
  };
  const session = getSessionCookie();
  if (session) {
    headers["Cookie"] = `sessionid=${session}`;
  }
  return headers;
}

async function fetchWebProfileInfo(username: string) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  try {
    const res = await fetch(url, {
      headers: buildHeaders(username),
      redirect: "manual",
      next: { revalidate: 0 },
    } as RequestInit);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") || "";
      console.error(`Instagram redirect ${res.status} -> ${loc}`);
      return null;
    }
    if (!res.ok) {
      console.error(`Instagram API error: ${res.status}`);
      return null;
    }
    return res.json();
  } catch (err) {
    console.error("fetchWebProfileInfo error:", err);
    return null;
  }
}

async function fetchGraphQL(username: string) {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/?__a=1&__d=dis`;
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "*/*",
    "Referer": "https://www.instagram.com/",
  };
  const session = getSessionCookie();
  if (session) {
    headers["Cookie"] = `sessionid=${session}`;
  }
  try {
    const res = await fetch(url, {
      headers,
      redirect: "manual",
      next: { revalidate: 0 },
    } as RequestInit);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") || "";
      console.error(`Instagram redirect ${res.status} -> ${loc}`);
      return null;
    }
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/** Strip Instagram CDN size parameters from image URLs.
 *  When logged in, Instagram already serves the full-res URL.
 *  When anonymous, the URL may contain size params like s320x320.
 */
function cleanInstagramUrl(url: string): string {
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
    const info = await fetchWebProfileInfo(username);
    if (info?.data?.user) {
      const user = info.data.user;
      const hdRaw = user.hd_profile_pic_url_info?.url || user.profile_pic_url_hd || user.profile_pic_url;
      const thumbRaw = user.profile_pic_url;
      return Response.json({
        username: user.username,
        full_name: user.full_name,
        biography: user.biography || "",
        followers: user.edge_followed_by?.count || user.follower_count || 0,
        following: user.edge_follow?.count || user.following_count || 0,
        posts: user.edge_owner_to_timeline_media?.count || user.media_count || 0,
        profile_pic_url: cleanInstagramUrl(thumbRaw),
        hd_profile_pic_url: cleanInstagramUrl(hdRaw),
        is_private: user.is_private,
        is_verified: user.is_verified,
        has_session: hasSession,
      });
    }

    const gql = await fetchGraphQL(username);
    if (gql?.graphql?.user) {
      const user = gql.graphql.user;
      return Response.json({
        username: user.username,
        full_name: user.full_name,
        biography: user.biography || "",
        followers: user.edge_followed_by?.count || 0,
        following: user.edge_follow?.count || 0,
        posts: user.edge_owner_to_timeline_media?.count || 0,
        profile_pic_url: cleanInstagramUrl(user.profile_pic_url),
        hd_profile_pic_url: cleanInstagramUrl(user.profile_pic_url_hd || user.profile_pic_url),
        is_private: user.is_private,
        is_verified: user.is_verified,
        has_session: hasSession,
      });
    }

    return Response.json(
      { error: "Profile not found or rate limited by Instagram" },
      { status: 404 }
    );
  } catch (err) {
    console.error("Profile fetch error:", err);
    return Response.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}
