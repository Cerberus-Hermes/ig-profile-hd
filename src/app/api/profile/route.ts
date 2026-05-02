export const dynamic = "force-dynamic";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

/* ------------------------------------------------------------------ */
/*  Cookie helpers (inspired by Instagram-Profile-Downloader)         */
/* ------------------------------------------------------------------ */

interface CookieDef {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  sameParty?: boolean;
  sourceScheme?: string;
  sourcePort?: number;
  partitionKey?: string;
}

function normalizeCookies(raw: unknown[]): CookieDef[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === "object")
    .map((cookie) => {
      const normalized: CookieDef = {
        name: String(cookie.name || ""),
        value: String(cookie.value || ""),
        domain: cookie.domain ? String(cookie.domain) : ".instagram.com",
        path: cookie.path ? String(cookie.path) : "/",
        expires: typeof cookie.expirationDate === "number" ? cookie.expirationDate : -1,
        httpOnly: Boolean(cookie.httpOnly),
        secure: Boolean(cookie.secure),
      };

      // Fix sameSite value - Puppeteer only accepts 'Strict', 'Lax', or 'None'
      if (cookie.sameSite) {
        const sameSite = String(cookie.sameSite).toLowerCase();
        if (sameSite === "no_restriction" || sameSite === "none") {
          normalized.sameSite = "None";
        } else if (sameSite === "lax") {
          normalized.sameSite = "Lax";
        } else if (sameSite === "strict") {
          normalized.sameSite = "Strict";
        } else {
          normalized.sameSite = "Lax";
        }
      }

      return normalized;
    })
    .filter((c) => c.name && c.value);
}

function loadCookies(): CookieDef[] {
  // 1. Try INSTAGRAM_COOKIES_JSON (full cookie array)
  const cookiesJson = process.env.INSTAGRAM_COOKIES_JSON?.trim();
  if (cookiesJson) {
    try {
      const parsed = JSON.parse(cookiesJson);
      const normalized = normalizeCookies(parsed);
      if (normalized.length > 0) {
        console.log(`Loaded ${normalized.length} cookies from INSTAGRAM_COOKIES_JSON`);
        return normalized;
      }
    } catch (e) {
      console.error("Failed to parse INSTAGRAM_COOKIES_JSON:", e);
    }
  }

  // 2. Fallback: INSTAGRAM_SESSION_ID (single cookie)
  const sessionId = process.env.INSTAGRAM_SESSION_ID?.trim();
  if (sessionId) {
    console.log("Using INSTAGRAM_SESSION_ID as single cookie");
    return [
      {
        name: "sessionid",
        value: sessionId,
        domain: ".instagram.com",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ];
  }

  return [];
}

/* ------------------------------------------------------------------ */
/*  Puppeteer-based profile scraper                                   */
/* ------------------------------------------------------------------ */

async function scrapeWithPuppeteer(username: string) {
  let browser: any = null;

  try {
    const puppeteer = await import("puppeteer-core");

    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--window-size=1280,800",
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });

    // Inject cookies
    const cookies = loadCookies();
    if (cookies.length > 0) {
      await page.setCookie(...cookies);
      console.log(`Injected ${cookies.length} Instagram cookies into Puppeteer`);
    }

    // Block only non-essential resources; keep images so src/srcset populate
    await page.setRequestInterception(true);
    page.on("request", (req: any) => {
      const resourceType = req.resourceType();
      if (["stylesheet", "font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });

    // Wait a moment for any client-side rendering
    await new Promise((r) => setTimeout(r, 1500));

    // Check if we're logged in (login wall detection)
    const isLoggedIn = await page.evaluate(() => {
      return !document.querySelector('input[name="username"]');
    });

    if (!isLoggedIn && cookies.length > 0) {
      console.log("Instagram shows login wall despite cookies - cookies may be expired or IP-restricted");
    }

    // Extract profile data from the rendered page
    const result = await page.evaluate(() => {
      const data: Record<string, any> = {};

      // 1. Find profile picture in the DOM
      const imgSelectors = [
        'img[alt*="profile picture"]',
        'img[alt*="Profilbild"]',
        'img[alt*="profile"]',
        'header img',
        'main img',
      ];

      let profileImg: HTMLImageElement | null = null;
      for (const sel of imgSelectors) {
        const el = document.querySelector(sel) as HTMLImageElement | null;
        if (el && el.src && el.src.includes("cdninstagram")) {
          profileImg = el;
          break;
        }
      }

      if (profileImg) {
        data.profile_pic_url = profileImg.src;

        // Check srcset for higher resolution
        const srcset = profileImg.srcset;
        if (srcset) {
          const candidates = srcset
            .split(",")
            .map((s) => {
              const [urlPart, sizePart] = s.trim().split(" ");
              const width = parseInt(sizePart?.replace("w", "") || "0", 10);
              return { url: urlPart, width };
            })
            .sort((a, b) => b.width - a.width);

          if (candidates.length > 0) {
            data.hd_profile_pic_url = candidates[0].url;
          } else {
            data.hd_profile_pic_url = profileImg.src;
          }
        } else {
          data.hd_profile_pic_url = profileImg.src;
        }
      }

      // 2. Extract og:image (often higher resolution)
      const ogImage = document.querySelector('meta[property="og:image"]') as HTMLMetaElement | null;
      if (ogImage?.content) {
        data.og_image = ogImage.content;
      }

      // 3. Extract username
      const titleMatch = document.title.match(/@?([a-zA-Z0-9._]+)/);
      data.username = titleMatch?.[1] || "";

      // 4. Extract meta description for name/bio
      const metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
      if (metaDesc) {
        data.meta_description = metaDesc.content;
      }

      // 5. Look for JSON-LD or embedded data
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const script of scripts) {
        try {
          const json = JSON.parse((script as HTMLScriptElement).textContent || "{}");
          if (json["@type"] === "ProfilePage" || json.mainEntity) {
            const entity = json.mainEntity || json;
            data.full_name = entity.name || "";
            data.description = entity.description || "";
            if (entity.image) {
              data.profile_pic_url = entity.image;
              data.hd_profile_pic_url = entity.image;
            }
          }
        } catch {
          // ignore
        }
      }

      // 6. Fallback: search all images for the largest profile-like image
      if (!data.hd_profile_pic_url) {
        const allImages = Array.from(document.querySelectorAll("img"));
        const profileLike = allImages
          .filter((img) => {
            const src = img.src || "";
            return (
              src.includes("cdninstagram") &&
              !src.includes("avatar") &&
              img.naturalWidth > 100
            );
          })
          .sort((a, b) => b.naturalWidth - a.naturalWidth)[0];

        if (profileLike) {
          data.profile_pic_url = profileLike.src;
          data.hd_profile_pic_url = profileLike.src;
        }
      }

      return data;
    });

    await browser.close();
    browser = null;

    // Validate
    if (!result.hd_profile_pic_url && !result.og_image) {
      return null;
    }

    // Prefer og:image if it looks higher-res (no s320x320 in URL)
    const ogUrl = result.og_image || "";
    const hdUrl = result.hd_profile_pic_url || "";
    const finalHd = (!ogUrl.includes("320x320") && ogUrl.includes("cdninstagram")) ? ogUrl : hdUrl;

    return {
      username: result.username || username,
      full_name: result.full_name || username,
      biography: result.description || result.meta_description || "",
      followers: 0,
      following: 0,
      posts: 0,
      profile_pic_url: result.profile_pic_url || finalHd,
      hd_profile_pic_url: finalHd,
      is_private: false,
      is_verified: false,
      source: "puppeteer",
      is_logged_in: isLoggedIn,
    };
  } catch (err) {
    console.error("Puppeteer error:", err);
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Fallback: HTTP API                                                */
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

function normalizeUser(raw: Record<string, unknown>) {
  const username = String(raw.username || "");
  if (!username) return null;

  const getNum = (val: unknown): number => {
    if (typeof val === "number") return val;
    if (typeof val === "string") return parseInt(val, 10) || 0;
    return 0;
  };

  const hdInfo = (raw.hd_profile_pic_url_info as Record<string, unknown>)?.url;
  const hdFallback = raw.profile_pic_url_hd || raw.profile_pic_url;

  return {
    username,
    full_name: String(raw.full_name || username),
    biography: String(raw.biography || ""),
    followers: getNum((raw.edge_followed_by as Record<string, unknown>)?.count ?? raw.follower_count),
    following: getNum((raw.edge_follow as Record<string, unknown>)?.count ?? raw.following_count),
    posts: getNum((raw.edge_owner_to_timeline_media as Record<string, unknown>)?.count ?? raw.media_count),
    profile_pic_url: String(raw.profile_pic_url || ""),
    hd_profile_pic_url: String(hdInfo || hdFallback || raw.profile_pic_url || ""),
    is_private: Boolean(raw.is_private),
    is_verified: Boolean(raw.is_verified),
  };
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

  try {
    // Strategy 1: Puppeteer (renders the page like a real browser)
    const puppeteerResult = await scrapeWithPuppeteer(username);
    if (puppeteerResult) {
      return Response.json(puppeteerResult);
    }

    // Strategy 2: API fallback
    const info = await fetchWebProfileInfo(username);
    if (info?.data?.user) {
      const u = normalizeUser(info.data.user as Record<string, unknown>);
      if (u) {
        return Response.json({
          ...u,
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
