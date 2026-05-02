# IG Profile HD

Download Instagram profile pictures. Supports both anonymous (320×320) and authenticated (1080×1080) mode.

## Authenticated Mode (True HD)

To get the original resolution profile pictures (up to 1080×1080), you need to provide your Instagram session cookie.

### 1. Get your `sessionid` cookie

1. Open [instagram.com](https://www.instagram.com) in your browser
2. Log in to your account
3. Open DevTools (F12) → **Application** (Chrome) or **Storage** (Firefox) → **Cookies** → `https://www.instagram.com`
4. Find the cookie named `sessionid`
5. Copy its value (a long string like `abc123%3Axyz789%3A...`)

### 2. Set the environment variable

In Coolify (or your hosting platform):

| Variable | Value |
|----------|-------|
| `INSTAGRAM_SESSION_ID` | Paste your `sessionid` cookie value here |

Redeploy the app.

### 3. Verify

Open the app. You should see a green banner:
> ✓ Session cookie active — fetching true HD resolution

Without a cookie, the app shows a yellow banner and falls back to ~320×320.

## Anonymous Mode

Works without any configuration, but Instagram limits resolution to ~320×320 for unauthenticated requests.

## Tech Stack

- Next.js 14 + TypeScript
- Tailwind CSS
- Docker (Coolify-ready)
