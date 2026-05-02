export const dynamic = "force-dynamic";

const IG_APP_ID = "936619743392459";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

/** Instagram fügt oft ?s=150x150 oder ?s=320x320 zu Profilbildern hinzu.
 *  Wir entfernen/überschreiben das, um die volle Auflösung zu bekommen. */
function maxResolutionInstagramUrl(url: string): string {
  try {
    const u = new URL(url);
    // Entferne Größen-parameter
    u.searchParams.delete("s");
    u.searchParams.delete("w");
    u.searchParams.delete("h");
    u.searchParams.delete("c");
    // Füge einen sehr hohen s-Wert hinzu, damit Instagram das Original liefert
    u.searchParams.set("s", "1080x1080");
    return u.toString();
  } catch {
    return url;
  }
}

async function fetchWebProfileInfo(username: string) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    headers: {
      "x-ig-app-id": IG_APP_ID,
      "User-Agent": USER_AGENT,
      "Accept": "*/*",
      "Referer": `https://www.instagram.com/${encodeURIComponent(username)}/`,
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchGraphQL(username: string) {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/?__a=1&__d=dis`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "*/*",
      "Referer": "https://www.instagram.com/",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  return res.json();
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

  try {
    // Try web_profile_info first (most reliable for HD)
    const info = await fetchWebProfileInfo(username);
    if (info?.data?.user) {
      const user = info.data.user;
      const hdUrl = maxResolutionInstagramUrl(
        user.hd_profile_pic_url_info?.url || user.profile_pic_url
      );
      const thumbUrl = maxResolutionInstagramUrl(user.profile_pic_url);
      return Response.json({
        username: user.username,
        full_name: user.full_name,
        biography: user.biography || "",
        followers: user.edge_followed_by?.count || user.follower_count || 0,
        following: user.edge_follow?.count || user.following_count || 0,
        posts: user.edge_owner_to_timeline_media?.count || user.media_count || 0,
        profile_pic_url: thumbUrl,
        hd_profile_pic_url: hdUrl,
        is_private: user.is_private,
        is_verified: user.is_verified,
      });
    }

    // Fallback to GraphQL endpoint
    const gql = await fetchGraphQL(username);
    if (gql?.graphql?.user) {
      const user = gql.graphql.user;
      const hdUrl = maxResolutionInstagramUrl(user.profile_pic_url_hd || user.profile_pic_url);
      const thumbUrl = maxResolutionInstagramUrl(user.profile_pic_url);
      return Response.json({
        username: user.username,
        full_name: user.full_name,
        biography: user.biography || "",
        followers: user.edge_followed_by?.count || 0,
        following: user.edge_follow?.count || 0,
        posts: user.edge_owner_to_timeline_media?.count || 0,
        profile_pic_url: thumbUrl,
        hd_profile_pic_url: hdUrl,
        is_private: user.is_private,
        is_verified: user.is_verified,
      });
    }

    return Response.json({ error: "Profile not found or rate limited by Instagram" }, { status: 404 });
  } catch (err) {
    console.error("Profile fetch error:", err);
    return Response.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}
