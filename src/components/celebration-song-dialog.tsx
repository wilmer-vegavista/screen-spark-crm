import { useEffect, useRef, useState } from "react";
import { Music4, Play, Search, Square, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { searchSongs, type SongSearchResult } from "@/lib/songs.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const CELEBRATION_SONG_SECONDS = 5;

export function CelebrationSongDialog() {
  const [open, setOpen] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [songUrl, setSongUrl] = useState<string | null>(null);
  const [songLabel, setSongLabel] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SongSearchResult[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id ?? null;
      setUid(userId);
      if (!userId) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("celebration_song_url, celebration_song_start")
        .eq("id", userId)
        .maybeSingle();
      setSongUrl(p?.celebration_song_url ?? null);
      setStart(Number(p?.celebration_song_start) || 0);
      setSongLabel(null);
      setDuration(null);
      setResults([]);
      setQuery("");
    })();
    return () => stopPreview();
  }, [open]);

  const stopPreview = () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
  };

  const previewFrom = (url: string, from: number) => {
    stopPreview();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.currentTime = from;
    audio.onloadedmetadata = () => setDuration(audio.duration);
    void audio.play().then(() => {
      setPlaying(true);
      stopTimer.current = setTimeout(stopPreview, CELEBRATION_SONG_SECONDS * 1000);
    }).catch(() => toast.error("Kunde inte spela upp låten"));
  };

  const saveSong = async (url: string | null, startAt: number, label?: string) => {
    if (!uid) return false;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ celebration_song_url: url, celebration_song_start: startAt })
      .eq("id", uid);
    setSaving(false);
    if (error) {
      toast.error("Kunde inte spara: " + error.message);
      return false;
    }
    setSongUrl(url);
    setStart(startAt);
    setSongLabel(label ?? null);
    return true;
  };

  const handlePickSearchResult = async (r: SongSearchResult) => {
    stopPreview();
    setDuration(null);
    const ok = await saveSong(r.previewUrl, 0, `${r.artist} – ${r.title}`);
    if (ok) toast.success(`Vald låt: ${r.artist} – ${r.title}. Välj starttid nedan!`);
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const { results: found } = await searchSongs({ data: { q: query } });
      setResults(found);
      if (found.length === 0) toast.info("Inga träffar – testa en annan sökning");
    } catch (e) {
      toast.error("Sökningen misslyckades: " + (e instanceof Error ? e.message : "okänt fel"));
    } finally {
      setSearching(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!uid) return;
    setSaving(true);
    try {
      const ext = (file.name.split(".").pop() || "mp3").toLowerCase();
      const path = `${uid}/song.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("celebration-songs")
        .upload(path, file, { upsert: true, contentType: file.type || "audio/mpeg" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("celebration-songs").getPublicUrl(path);
      // cache-bust so a replaced file is picked up everywhere
      const url = `${pub.publicUrl}?v=${Date.now()}`;
      setSaving(false);
      stopPreview();
      setDuration(null);
      const ok = await saveSong(url, 0, file.name);
      if (ok) toast.success("Låt uppladdad!");
    } catch (e) {
      setSaving(false);
      toast.error("Uppladdning misslyckades: " + (e instanceof Error ? e.message : "okänt fel"));
    }
  };

  const handleRemove = async () => {
    stopPreview();
    const ok = await saveSong(null, 0);
    if (ok) toast.success("Låt borttagen");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) stopPreview(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" title="Min målgest-låt">
          <Music4 className="size-4 text-primary" />
          Min låt
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music4 className="size-5 text-primary" /> Min målgest-låt
          </DialogTitle>
          <DialogDescription>
            Din låt spelas i {CELEBRATION_SONG_SECONDS} sekunder hos alla när du stänger en affär.
            Sök efter en låt (30-sekunders klipp) eller ladda upp en egen fil, och välj vilka{" "}
            {CELEBRATION_SONG_SECONDS} sekunder som spelas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Sök efter låt</Label>
            <div className="flex items-center gap-2">
              <Input
                placeholder="t.ex. Eye of the Tiger"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleSearch(); }}
              />
              <Button variant="secondary" size="sm" className="gap-2 shrink-0" disabled={searching} onClick={() => void handleSearch()}>
                <Search className="size-4" /> {searching ? "Söker..." : "Sök"}
              </Button>
            </div>
            {results.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-lg border divide-y">
                {results.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 p-2">
                    {r.artwork ? (
                      <img src={r.artwork} alt="" className="size-10 rounded shrink-0" />
                    ) : (
                      <div className="size-10 rounded bg-muted shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{r.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.artist}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      title="Förhandslyssna"
                      onClick={() => (playing ? stopPreview() : previewFrom(r.previewUrl, 0))}
                    >
                      {playing ? <Square className="size-4" /> : <Play className="size-4" />}
                    </Button>
                    <Button variant="outline" size="sm" className="shrink-0" disabled={saving} onClick={() => void handlePickSearchResult(r)}>
                      Välj
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>… eller ladda upp egen fil (mp3, m4a, wav …)</Label>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
                e.target.value = "";
              }}
            />
            <Button variant="secondary" size="sm" className="gap-2" disabled={saving} onClick={() => fileInput.current?.click()}>
              <Upload className="size-4" /> Ladda upp fil
            </Button>
          </div>

          {songUrl && (
            <div className="space-y-2 rounded-lg border p-3 bg-accent/30">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium truncate">
                  🎵 {songLabel || "Din sparade låt"}
                </div>
                <Button variant="ghost" size="sm" className="gap-1 text-destructive shrink-0" disabled={saving} onClick={() => void handleRemove()}>
                  <Trash2 className="size-4" /> Ta bort
                </Button>
              </div>
              <Label>
                Starta vid sekund
                {duration ? ` (klippets längd: ${Math.floor(duration)} sek)` : ""}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={start}
                  onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))}
                  className="w-24"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => (playing ? stopPreview() : previewFrom(songUrl, start))}
                >
                  {playing ? <Square className="size-4" /> : <Play className="size-4" />}
                  {playing ? "Stoppa" : `Lyssna (${CELEBRATION_SONG_SECONDS} sek)`}
                </Button>
                <Button size="sm" disabled={saving} onClick={() => void saveSong(songUrl, start, songLabel ?? undefined).then(ok => { if (ok) toast.success(`Sparat! Spelas från ${start} sek.`); })}>
                  Spara starttid
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
