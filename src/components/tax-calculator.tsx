import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calculator } from "lucide-react";

const fmt = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);

// Prisbasbelopp och skiktgräns (uppskattningar)
const PARAMS: Record<number, { pbb: number; skiktgrans: number }> = {
  2024: { pbb: 57300, skiktgrans: 598500 },
  2025: { pbb: 58800, skiktgrans: 625800 },
  2026: { pbb: 60800, skiktgrans: 643100 },
};

// Urval av kommuner med totalskattesats inkl. landstingsskatt (2025, ungefärlig)
// Källa: SCB / Skatteverket. Begravningsavgift INGÅR INTE här.
const KOMMUNER: { name: string; rate: number }[] = [
  { name: "Stockholm", rate: 29.82 },
  { name: "Göteborg", rate: 32.6 },
  { name: "Malmö", rate: 32.74 },
  { name: "Uppsala", rate: 32.85 },
  { name: "Linköping", rate: 32.2 },
  { name: "Västerås", rate: 31.91 },
  { name: "Örebro", rate: 32.6 },
  { name: "Norrköping", rate: 32.65 },
  { name: "Helsingborg", rate: 31.34 },
  { name: "Jönköping", rate: 33.07 },
  { name: "Umeå", rate: 33.7 },
  { name: "Lund", rate: 32.04 },
  { name: "Borås", rate: 32.97 },
  { name: "Sundsvall", rate: 33.97 },
  { name: "Gävle", rate: 33.07 },
  { name: "Eskilstuna", rate: 33.07 },
  { name: "Södertälje", rate: 32.41 },
  { name: "Karlstad", rate: 32.45 },
  { name: "Täby", rate: 29.83 },
  { name: "Växjö", rate: 32.0 },
  { name: "Halmstad", rate: 31.25 },
  { name: "Solna", rate: 29.2 },
  { name: "Sollentuna", rate: 30.2 },
  { name: "Mölndal", rate: 32.84 },
  { name: "Stenungsund", rate: 32.62 },
  { name: "Kungsbacka", rate: 31.25 },
  { name: "Huddinge", rate: 31.47 },
  { name: "Nacka", rate: 30.43 },
  { name: "Järfälla", rate: 30.78 },
  { name: "Botkyrka", rate: 32.07 },
  { name: "Haninge", rate: 31.93 },
];
const KOMMUN_GENOMSNITT = 32.41;

function calcGrundavdrag(annualIncome: number, pbb: number): number {
  const a = pbb;
  let g = 0;
  if (annualIncome < 0.99 * a) g = 0.423 * a;
  else if (annualIncome < 2.72 * a) g = 0.423 * a + 0.2 * (annualIncome - 0.99 * a);
  else if (annualIncome < 3.11 * a) g = 0.77 * a;
  else if (annualIncome < 7.88 * a) g = 0.77 * a - 0.1 * (annualIncome - 3.11 * a);
  else g = 0.293 * a;
  return Math.round(g / 100) * 100;
}

// Jobbskatteavdrag, ålder <66, förenklad (Skatteverkets formel 2024/2025)
function calcJobbskatteavdrag(annualIncome: number, pbb: number, communalRate: number): number {
  const a = pbb;
  const ks = communalRate / 100;
  let bas = 0;
  if (annualIncome <= 0.91 * a) bas = annualIncome;
  else if (annualIncome <= 3.24 * a) bas = 0.91 * a + 0.3387 * (annualIncome - 0.91 * a);
  else if (annualIncome <= 8.08 * a) bas = 1.703 * a + 0.1287 * (annualIncome - 3.24 * a);
  else bas = 2.323 * a;

  const grund = calcGrundavdrag(annualIncome, pbb);
  const jsa = Math.max(0, (bas - grund) * ks);
  // Förstärkning från 2024 (ca 2 500 kr/år för medelinkomst)
  const forstarkning = annualIncome > a ? Math.min(2520, jsa * 0.08) : 0;
  return Math.round(jsa + forstarkning);
}

export function TaxCalculator() {
  const [year, setYear] = useState(2026);
  const [monthlySalary, setMonthlySalary] = useState(35000);
  const [kommunName, setKommunName] = useState("Stockholm");
  const [customRate, setCustomRate] = useState<number | null>(null);
  const [churchMember, setChurchMember] = useState(false);
  const [churchFee, setChurchFee] = useState(1.0);
  const [parish, setParish] = useState("");
  const [showResult, setShowResult] = useState(false);

  const result = useMemo(() => {
    const params = PARAMS[year] ?? PARAMS[2026];
    const kommun = KOMMUNER.find(k => k.name === kommunName);
    const kommunalRate = customRate ?? kommun?.rate ?? KOMMUN_GENOMSNITT;
    const begravningsavgift = 0.253;
    const churchRate = churchMember ? churchFee : 0;
    const totalLocalRate = kommunalRate + begravningsavgift + churchRate;

    const arsinkomst = monthlySalary * 12;
    const grundavdrag = calcGrundavdrag(arsinkomst, params.pbb);
    const beskattningsbar = Math.max(0, Math.floor((arsinkomst - grundavdrag) / 100) * 100);

    const lokalSkatt = beskattningsbar * (totalLocalRate / 100);
    const statligSkatt = Math.max(0, (beskattningsbar - params.skiktgrans) * 0.2);
    const jobbskatteavdrag = calcJobbskatteavdrag(arsinkomst, params.pbb, kommunalRate);

    const totalSkattArs = Math.max(0, lokalSkatt + statligSkatt - jobbskatteavdrag);
    const netArs = arsinkomst - totalSkattArs;
    const netManad = netArs / 12;
    const skattManad = totalSkattArs / 12;
    const skatteSats = (totalSkattArs / arsinkomst) * 100;

    return {
      kommunalRate,
      totalLocalRate,
      arsinkomst,
      grundavdrag,
      beskattningsbar,
      lokalSkatt,
      statligSkatt,
      jobbskatteavdrag,
      totalSkattArs,
      netArs,
      netManad,
      skattManad,
      skatteSats,
    };
  }, [year, monthlySalary, kommunName, customRate, churchMember, churchFee]);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Calculator className="size-4 text-primary" />
          <h3 className="font-semibold text-sm">Räkna ut din nettolön</h3>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Vilket inkomstår?</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.keys(PARAMS).map(y => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Vad har du i lön?</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={monthlySalary}
              onChange={(e) => setMonthlySalary(Math.max(0, Number(e.target.value)))}
              className="w-40"
            />
            <span className="text-xs text-muted-foreground">kr/mån</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Vilken kommun bor du i?</Label>
          <Select value={kommunName} onValueChange={(v) => { setKommunName(v); setCustomRate(null); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {KOMMUNER.map(k => (
                <SelectItem key={k.name} value={k.name}>
                  {k.name} ({k.rate.toFixed(2)} %)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 pt-1">
            <Input
              type="number"
              step="0.01"
              placeholder="Egen kommunalskatt %"
              value={customRate ?? ""}
              onChange={(e) => setCustomRate(e.target.value === "" ? null : Number(e.target.value))}
              className="w-44"
            />
            <span className="text-xs text-muted-foreground">% (valfri override)</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox id="church" checked={churchMember} onCheckedChange={(v) => setChurchMember(!!v)} />
          <Label htmlFor="church" className="text-xs cursor-pointer">Medlem i Svenska kyrkan?</Label>
        </div>

        {churchMember && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Vilken församling bor du i?</Label>
              <Input value={parish} onChange={(e) => setParish(e.target.value)} placeholder="t.ex. Storkyrkoförsamlingen" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Kyrkoavgift</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  value={churchFee}
                  onChange={(e) => setChurchFee(Number(e.target.value))}
                  className="w-32"
                />
                <span className="text-xs text-muted-foreground">% (varierar per församling, ofta 0,9–1,4)</span>
              </div>
            </div>
          </>
        )}

        <Button onClick={() => setShowResult(true)} className="w-full">
          Beräkna
        </Button>
      </Card>

      {showResult && (
        <Card className="p-5 space-y-3">
          <h3 className="font-semibold text-sm">Resultat</h3>
          <div className="rounded-lg p-4 border bg-gradient-to-br from-primary/5 to-transparent">
            <div className="text-xs text-muted-foreground">Kvar efter skatt</div>
            <div className="text-3xl font-bold text-primary">{fmt(result.netManad)}<span className="text-sm font-normal text-muted-foreground"> /mån</span></div>
            <div className="text-xs text-muted-foreground mt-1">{fmt(result.netArs)} per år</div>
          </div>

          <div className="space-y-1.5 text-sm">
            <Row label="Bruttolön" value={fmt(monthlySalary)} suffix="/mån" />
            <Row label="Skatt" value={`−${fmt(result.skattManad)}`} suffix="/mån" muted />
            <Row label="Skattesats" value={`${result.skatteSats.toFixed(1)} %`} muted />
          </div>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Detaljer (årsbasis)</summary>
            <div className="mt-2 space-y-1">
              <Row label="Årsinkomst" value={fmt(result.arsinkomst)} small />
              <Row label="Grundavdrag" value={`−${fmt(result.grundavdrag)}`} small />
              <Row label="Beskattningsbar inkomst" value={fmt(result.beskattningsbar)} small />
              <Row label={`Kommunal + begravning${churchMember ? " + kyrka" : ""} (${result.totalLocalRate.toFixed(2)} %)`} value={fmt(result.lokalSkatt)} small />
              <Row label="Statlig skatt (20 % över skiktgräns)" value={fmt(result.statligSkatt)} small />
              <Row label="Jobbskatteavdrag" value={`−${fmt(result.jobbskatteavdrag)}`} small />
              <Row label="Total skatt" value={fmt(result.totalSkattArs)} small bold />
            </div>
          </details>

          <p className="text-[10px] text-muted-foreground leading-relaxed pt-2 border-t">
            Beräkningen är en uppskattning baserad på Skatteverkets formler för grundavdrag, jobbskatteavdrag och statlig skatt.
            Faktisk skatt kan skilja sig något beroende på ålder, övriga avdrag och församlingens exakta kyrkoavgift.
          </p>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value, suffix, muted, bold, small }: { label: string; value: string; suffix?: string; muted?: boolean; bold?: boolean; small?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${muted ? "text-muted-foreground" : ""} ${small ? "text-xs" : ""}`}>
      <span>{label}</span>
      <span className={bold ? "font-semibold text-foreground" : ""}>{value}{suffix && <span className="text-xs text-muted-foreground ml-0.5">{suffix}</span>}</span>
    </div>
  );
}
