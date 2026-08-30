// Helpers for using YouTube videos as celebration songs via the official
// IFrame Player API (no audio extraction — the embedded player plays).

export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "music.youtube.com") {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const m = url.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
      if (m) return m[2];
    }
    return null;
  } catch {
    return /^[\w-]{11}$/.test(raw) ? raw : null;
  }
}

export function isYouTubeUrl(u: string): boolean {
  return parseYouTubeId(u) !== null;
}

let apiPromise: Promise<any> | null = null;

export function loadYouTubeApi(): Promise<any> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const w = window as any;
    if (w.YT?.Player) return resolve(w.YT);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return apiPromise;
}
