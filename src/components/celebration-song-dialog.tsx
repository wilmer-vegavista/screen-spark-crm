import { useEffect, useRef, useState } from "react";
import { Music4, Play, Square, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
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
      const { error: profErr } = await supabase
        .from("profiles")
        .update({ celebration_song_url: url, celebration_song_start: 0 })
        .eq("id", uid);
      if (profErr) throw profErr;
      setSongUrl(url);
      setStart(0);
      toast.success("Låt uppladdad!");
    } catch (e) {
      toast.error("Uppladdning misslyckades: " + (e instanceof Error ? e.message : "okänt fel"));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStart = async () => {
    if (!uid) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ celebration_song_start: start })
      .eq("id", uid);
    setSaving(false);
    if (error) toast.error("Kunde inte spara: " + error.message);
    else toast.success("Sparat! Din låt spelas från " + start + " sek.");
  };

  const handleRemove = async () => {
    if (!uid) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ celebration_song_url: null, celebration_song_start: 0 })
      .eq("id", uid);
    setSaving(false);
    if (error) return toast.error("Kunde inte ta bort: " + error.message);
    stopPreview();
    setSongUrl(null);
    setStart(0);
    toast.success("Låt borttagen");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) stopPreview(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" title="Min målgest-låt">
          <Music4 className="size-4 text-primary" />
          Min låt
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music4 className="size-5 text-primary" /> Min målgest-låt
          </DialogTitle>
          <DialogDescription>
            Din låt spelas i {CELEBRATION_SONG_SECONDS} sekunder hos alla när du stänger en affär.
            Välj själv vilka {CELEBRATION_SONG_SECONDS} sekunder av låten som spelas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Ljudfil (mp3, m4a, wav …)</Label>
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
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" className="gap-2" disabled={saving} onClick={() => fileInput.current?.click()}>
                <Upload className="size-4" /> {songUrl ? "Byt låt" : "Ladda upp låt"}
              </Button>
              {songUrl && (
                <Button variant="ghost" size="sm" className="gap-2 text-destructive" disabled={saving} onClick={() => void handleRemove()}>
                  <Trash2 className="size-4" /> Ta bort
                </Button>
              )}
            </div>
            {songUrl && <div className="text-xs text-muted-foreground">Låt uppladdad ✓</div>}
          </div>

          {songUrl && (
            <div className="space-y-2">
              <Label>
                Starta uppspelningen vid sekund
                {duration ? ` (låtens längd: ${Math.floor(duration)} sek)` : ""}
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
              </div>
              <Button size="sm" disabled={saving} onClick={() => void handleSaveStart()}>
                Spara starttid
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
