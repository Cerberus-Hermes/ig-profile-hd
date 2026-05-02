export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url || !url.startsWith("http")) {
    return new Response("Invalid URL", { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": "https://www.instagram.com/",
        "Origin": "https://www.instagram.com",
      },
    });

    if (!res.ok) {
      return new Response("Failed to fetch image", { status: res.status });
    }

    const blob = await res.blob();
    const headers = new Headers();
    headers.set("Content-Type", blob.type || "image/jpeg");
    headers.set("Content-Length", String(blob.size));
    headers.set("Cache-Control", "public, max-age=86400");

    return new Response(blob, { headers });
  } catch {
    return new Response("Error proxying image", { status: 500 });
  }
}
