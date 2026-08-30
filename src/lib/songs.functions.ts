import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SongSearchResult = {
  id: number;
  title: string;
  artist: string;
  artwork: string | null;
  previewUrl: string;
};

// Searches the iTunes catalog (no account needed) and returns 30-second
// preview clips that can be played directly in the browser.
export const searchSongs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { q: string }) => ({ q: String(input?.q ?? "").slice(0, 100) }))
  .handler(async ({ data }): Promise<{ results: SongSearchResult[] }> => {
    const q = data.q.trim();
    if (!q) return { results: [] };
    const params = new URLSearchParams({
      term: q,
      media: "music",
      entity: "song",
      limit: "12",
      country: "SE",
    });
    const res = await fetch(`https://itunes.apple.com/search?${params}`);
    if (!res.ok) throw new Error(`Söktjänsten svarade inte [${res.status}]`);
    const json: any = await res.json();
    const results: SongSearchResult[] = (json.results ?? [])
      .filter((r: any) => typeof r.previewUrl === "string" && r.previewUrl)
      .map((r: any) => ({
        id: Number(r.trackId) || 0,
        title: String(r.trackName ?? ""),
        artist: String(r.artistName ?? ""),
        artwork: typeof r.artworkUrl60 === "string" ? r.artworkUrl60 : null,
        previewUrl: String(r.previewUrl),
      }));
    return { results };
  });
