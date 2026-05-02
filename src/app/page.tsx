"use client";

import { useState, useRef, useEffect } from "react";
import { Search, Download, Loader2, ZoomIn, User, ImageOff, Info } from "lucide-react";

interface ProfileData {
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
  has_session?: boolean;
}

export default function Home() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((d) => setHasSession(d.has_session))
      .catch(() => setHasSession(false));
  }, []);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const u = username.trim().toLowerCase();
    if (!u) return;
    setLoading(true);
    setError("");
    setProfile(null);
    try {
      const res = await fetch(`/api/profile?username=${encodeURIComponent(u)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unknown error");
      setProfile(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    if (!profile) return;
    try {
      const res = await fetch(`/api/image?url=${encodeURIComponent(profile.hd_profile_pic_url)}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${profile.username}_hd.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      window.open(profile.hd_profile_pic_url, "_blank");
    }
  }

  function formatNumber(n: number) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-2 tracking-tight">
          IG Profile <span className="text-primary">HD</span>
        </h1>
        <p className="text-center text-muted-foreground text-sm mb-6">
          Download Instagram profile pictures in full resolution
        </p>

        {/* Session status badge */}
        {hasSession === false && (
          <div className="mb-6 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 flex gap-2.5 items-start">
            <Info className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
            <div className="text-xs text-yellow-200/80 leading-relaxed">
              <strong className="text-yellow-200">No session cookie configured.</strong>
              <br />
              Images are limited to ~320×320. Add{" "}
              <code className="bg-black/30 px-1 py-0.5 rounded text-yellow-100 font-mono text-[10px]">
                INSTAGRAM_SESSION_ID
              </code>{" "}
              to your environment variables for true HD (1080×1080).
            </div>
          </div>
        )}
        {hasSession === true && (
          <div className="mb-6 rounded-xl border border-green-500/30 bg-green-500/10 p-2 text-center text-[11px] text-green-300 font-medium">
            ✓ Session cookie active — fetching true HD resolution
          </div>
        )}

        <form onSubmit={handleSearch} className="relative mb-8">
          <input
            ref={inputRef}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter Instagram username..."
            className="w-full pl-11 pr-4 py-3 rounded-xl bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            disabled={loading}
          />
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Search"}
          </button>
        </form>

        {error && (
          <div className="rounded-xl bg-card border border-red-500/30 p-4 text-sm text-red-400 text-center mb-6">
            {error}
          </div>
        )}

        {profile && (
          <div className="rounded-2xl bg-card border border-border p-6 space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Avatar */}
            <div className="flex flex-col items-center">
              <button
                onClick={() => setZoom(!zoom)}
                className={`relative rounded-full border-2 border-border hover:border-primary/50 transition-all cursor-zoom-in overflow-hidden bg-background ${
                  zoom ? "w-64 h-64" : "w-28 h-28"
                }`}
                title={zoom ? "Click to shrink" : "Click to zoom"}
              >
                <img
                  src={`/api/image?url=${encodeURIComponent(profile.hd_profile_pic_url)}`}
                  alt={profile.username}
                  className="w-full h-full object-cover"
                  loading="eager"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = profile.profile_pic_url;
                  }}
                />
              </button>
              <div className="flex items-center gap-1.5 mt-3">
                <h2 className="text-lg font-semibold">{profile.full_name || profile.username}</h2>
                {profile.is_verified && (
                  <span className="text-primary text-xs" title="Verified">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">@{profile.username}</p>
              {profile.is_private && (
                <span className="mt-1 text-[10px] uppercase tracking-wider text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                  Private Account
                </span>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-background p-3">
                <div className="text-sm font-semibold">{formatNumber(profile.posts)}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Posts</div>
              </div>
              <div className="rounded-lg bg-background p-3">
                <div className="text-sm font-semibold">{formatNumber(profile.followers)}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Followers</div>
              </div>
              <div className="rounded-lg bg-background p-3">
                <div className="text-sm font-semibold">{formatNumber(profile.following)}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Following</div>
              </div>
            </div>

            {/* Bio */}
            {profile.biography && (
              <p className="text-sm text-muted-foreground text-center leading-relaxed whitespace-pre-wrap">
                {profile.biography}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Download className="h-4 w-4" />
                Download HD
              </button>
              <button
                onClick={() => setZoom(!zoom)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-background transition-colors"
              >
                <ZoomIn className="h-4 w-4" />
                {zoom ? "Shrink" : "Zoom"}
              </button>
            </div>
          </div>
        )}

        {!profile && !error && !loading && (
          <div className="text-center py-12 text-muted-foreground">
            <User className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Type a username and hit Search</p>
          </div>
        )}
      </div>

      <footer className="mt-auto pt-16 text-center text-[10px] text-muted-foreground">
        <p>Not affiliated with Instagram. For educational purposes only.</p>
      </footer>
    </main>
  );
}
