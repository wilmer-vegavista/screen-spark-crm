import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import {
  BUCKET_LABEL,
  type CashflowItem,
  type Grid,
  type GridCell,
  type GridLine,
  itemsFor,
  KR0,
  monthLong,
} from "@/lib/fortnox/cashflow";

/**
 * Filip's grid: the workbook's rows in order, the (Inför) start column, the twelve months
 * of the fiscal year and Summa. Closed months are actuals (plain), months ahead are
 * forecasts (italic), cells that carry planned money from the order book are lighter
 * still, the current month is tinted and labelled. Every fed cell hovers to its makeup.
 * Erik's component (round two).
 */
export function CashflowGrid({ grid, items }: { grid: Grid; items: CashflowItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="sticky left-0 z-10 bg-muted/40 text-left font-semibold px-2 py-2 min-w-[260px]">Kassaflöde Rapport</th>
            {grid.columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "text-right font-semibold px-2 py-2 whitespace-nowrap min-w-[84px]",
                  c.monthKind === "current" && "bg-amber-50 text-amber-900",
                  c.monthKind === "ahead" && "text-muted-foreground",
                )}
                title={c.monthKind === "current" ? "Innevarande månad: utfall hittills + prognos" : c.monthKind === "ahead" ? "Prognos" : c.monthKind === "closed" ? "Utfall från huvudboken" : "Kassa årets ingång"}
              >
                {c.label}
                {c.monthKind === "current" && <span className="block text-[10px] font-normal">hittills + prognos</span>}
                {c.monthKind === "start" && <span className="block text-[10px] font-normal">UPPSK</span>}
              </th>
            ))}
            <th className="text-right font-semibold px-2 py-2 min-w-[96px]">Summa</th>
          </tr>
        </thead>
        <tbody>
          {grid.lines.map((line) => (
            <GridRow key={line.def.key} line={line} grid={grid} items={items} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function rowClass(line: GridLine): string {
  const k = line.def.kind;
  if (k === "header") return "bg-muted/60 font-semibold";
  if (k === "balance") return line.def.position === 6 ? "font-semibold" : "bg-sky-100/60 font-semibold";
  if (k === "sum") return "font-semibold border-t";
  return "";
}

function GridRow({ line, grid, items }: { line: GridLine; grid: Grid; items: CashflowItem[] }) {
  const fed = line.def.kind === "source" || line.def.kind === "vat_out" || line.def.kind === "vat_in";
  return (
    <tr className={cn("border-b border-border/60 hover:bg-muted/20", rowClass(line))}>
      <td className={cn("sticky left-0 z-10 bg-background px-2 py-1 whitespace-nowrap", line.def.kind === "header" && "bg-muted/60", line.def.kind === "balance" && line.def.position !== 6 && "bg-sky-100/60")}>
        {line.def.kind === "header" ? line.def.label : <span className={cn(line.def.kind === "source" && "pl-3")}>{line.def.label}</span>}
      </td>
      {grid.columns.map((c) => {
        const cell = line.cells[c.key];
        return (
          <td
            key={c.key}
            className={cn(
              "text-right px-2 py-1 tabular-nums whitespace-nowrap",
              c.monthKind === "current" && "bg-amber-50/60",
              cell?.tone === "forecast" && "italic text-muted-foreground",
              cell?.tone === "planned" && "italic text-muted-foreground/60",
              cell?.tone === "computed" && c.monthKind === "ahead" && "italic",
            )}
          >
            {cell && cell.value !== null ? (
              fed && c.monthKind !== "start" ? (
                <CellHover cell={cell} rowKey={line.def.key} rowLabel={line.def.label} month={c.key} items={itemsFor(items, line.def.key, c.key)}>
                  <span className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">{KR0(cell.value)}</span>
                </CellHover>
              ) : line.def.key === "kassa_arets_ingang" ? (
                <span title={cell.tone === "forecast" ? "Manuellt angiven ingående kassa" : "Från huvudboken: ingående balans på kassakontona"}>{KR0(cell.value)}</span>
              ) : (
                <>
                  <span>{KR0(cell.value)}</span>
                  {cell.ledgerBalance !== undefined && (
                    <span
                      className={cn(
                        "block text-[10px] font-normal not-italic",
                        Math.abs(cell.ledgerBalance - (cell.value ?? 0)) > 1 ? "text-destructive" : "text-muted-foreground",
                      )}
                      title="Huvudbokens saldo på kassakontona vid månadens slut"
                    >
                      bank {KR0(cell.ledgerBalance)}
                    </span>
                  )}
                </>
              )
            ) : (
              ""
            )}
          </td>
        );
      })}
      <td className={cn("text-right px-2 py-1 tabular-nums whitespace-nowrap font-medium")}>{line.def.kind === "header" ? "" : KR0(line.total.value)}</td>
    </tr>
  );
}

function CellHover({
  cell,
  rowKey,
  rowLabel,
  month,
  items,
  children,
}: {
  cell: GridCell;
  rowKey: string;
  rowLabel: string;
  month: string;
  items: CashflowItem[];
  children: React.ReactNode;
}) {
  const isVat = rowKey === "utgaende_moms" || rowKey === "ingaende_moms";
  const known = cell.forecastInvoiced + cell.liability;
  const explain =
    cell.monthKind === "closed"
      ? "Stängd månad: enbart utfall från huvudboken."
      : cell.monthKind === "current"
        ? isVat
          ? "Innevarande månad: momsen som betalats hittills + 25 % av prognosdelen på raderna."
          : `Innevarande månad: utfall hittills ${KR0(cell.actual) || "0"} + kända belopp ${KR0(known + cell.forecastPlanned) || "0"}${cell.plan !== null ? ` + planens rest (plan ${KR0(cell.plan)})` : ""}.`
        : isVat
          ? "Prognosmånad: 25 % av raderna, som i arbetsboken."
          : cell.plan !== null
            ? `Prognosmånad: det största av planen (${KR0(cell.plan)}${cell.planOverridden ? ", månadens egen siffra" : ""}) och kända belopp (${KR0(known + cell.forecastPlanned) || "0"}).`
            : "Prognosmånad: kända fakturor på förfallodatum och orderbokens planerade delfakturor.";
  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-[460px] text-xs space-y-2" align="end">
        <div className="font-semibold">
          {rowLabel} · {monthLong(month)}: {KR0(cell.value)} kr
        </div>
        <div className="text-muted-foreground">{explain}</div>
        {items.length > 0 ? (
          <div className="max-h-64 overflow-y-auto space-y-1">
            {groupItems(items).map((g) => (
              <div key={g.bucket}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                  {BUCKET_LABEL[g.bucket]} · {KR0(g.sum)} kr
                </div>
                {g.items.map((i) => (
                  <div key={`${i.source}:${i.ref}`} className="flex justify-between gap-3">
                    <span className="truncate" title={i.label}>
                      {i.date} · {i.label}
                    </span>
                    <span className="tabular-nums shrink-0">{KR0(i.amount)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground">{cell.plan !== null && cell.value === cell.plan ? "Enbart planen bakom den här siffran." : "Inga underlag den här månaden."}</div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

function groupItems(items: CashflowItem[]) {
  const order: CashflowItem["bucket"][] = ["actual", "forecast_invoiced", "liability", "forecast_planned"];
  return order
    .map((bucket) => {
      const list = items.filter((i) => i.bucket === bucket);
      return { bucket, items: list, sum: list.reduce((s, i) => s + i.amount, 0) };
    })
    .filter((g) => g.items.length > 0);
}
