# Fortnox-integrationen – runda 0 och runda 1

Det här är mötessidan: vad som är byggt, vad jag har antagit, och de frågor bara Filip
eller Wilmer kan svara på. Allt körs än så länge mot en sandlåda – ett Fortnox-testbolag
och ett eget Supabase-projekt med påhittade kunder – så inget av ert är rört. Det ni rättar
på mötet blir nästa runda. Runda 0 (kopplingen kund/skärm) står först; runda 1
(kundreskontran) står längre ner på sidan.

# Runda 0 – kopplingen

## Vad som finns idag

**Sidan Fortnox-koppling** (Admin-menyn, bara admin). Varje kund och varje skärm i CRM:et
på en rad, med sitt Fortnox-nummer eller ett förslag – och alltid *varför*: samma
organisationsnummer, samma fyrsiffriga kod, samma namn efter städning, eller "liknande
namn (88 %)". Per rad: **Bekräfta** förslaget, **Koppla till…** en annan post i Fortnox
(välj i lista), eller **Skapa i Fortnox** nu. Överst en hälsorad: när synken senast gick,
hur det gick, senaste fel, hur många som är kopplade, väntar eller saknas. Flikar för
avvikelser och de senaste körningarna.

**Synka nu** (och ett timjobb, varje hel timme). En körning gör i ordning:

1. Läser alla kunder och projekt i Fortnox – hela listan, aldrig en avhuggen sida.
2. Föreslår en koppling för varje kund och skärm som inte redan är kopplad. Bara *exakta*
   träffar kopplas automatiskt (organisationsnummer, fyrsiffrig kod). Namn- och
   likhetsträffar väntar på att någon bekräftar.
3. Skapar i Fortnox det som inte har någon kandidat alls: kunden med namn, org.nr,
   adress, e-post, fakturamejl, VAT-nr och referens; skärmen som projekt med koden som
   projektnummer. Innan varje skapande läser den tillbaka från Fortnox, så samma rad
   skapas aldrig två gånger – inte ens om något gick sönder mitt i förra körningen.
4. Listar avvikelser: poster som ändrats i Fortnox sedan förra körningen och där
   grunden för kopplingen inte längre håller (annat org.nr, koden borta, namnet bytt,
   posten raderad).

Kört i sandlådan den 7 september: 10 påhittade kunder och 6 skärmar; första körningen
kopplade 3 automatiskt (1 på org.nr, 2 på kod), lade 3 förslag (2 på namn, 1 på likhet)
och skapade 7 kunder och 3 projekt i testbolaget. Andra körningen skapade ingenting.

**Vad som inte finns än:** fakturor (ingen "Skapa i Fortnox" på fakturasidan),
kundreskontran och intäktsrapporten, kassaflödessidan. Ingenting rör ert Fortnox eller ert
Supabase-projekt förrän ni har sett det här och Filip klickat godkänn i Fortnox.

## Vad jag har antagit, och varifrån

| # | Antagande | Varifrån |
|---|-----------|----------|
| 1 | En skärm i CRM:et = ett projekt i Fortnox; en kund = en kund. | Kickoff 00:07:05 ("projektet är själva skärmen? – Ja exakt") |
| 2 | Kunder känns igen på organisationsnummer. Saknas det: på namnet. | Kickoff 00:14:19 (Filip skapar kunden i Fortnox utifrån org.nr) |
| 3 | Skärmens fyrsiffriga kod står i namnet, som i Filips lista: `1101 - Stenungstorg`. Koden blir projektnumret i Fortnox. Serierna 1xxx, 2xxx, 3xxx som i listan. | Filips arbetsbok, fliken Kundreskontra, kolumnerna M–O rad 3–14; kickoff 00:06:47 ("stor 2104 Stora Nygatan") |
| 4 | Namnen får skilja sig när koden stämmer ("Stenungstorg" i CRM, "Stenungsund" i Fortnox) – koden vinner. | Kickoff 00:06:28, 00:14:56 |
| 5 | CRM:et skapar; Fortnox äger numren. Ny kund eller skärm finns i Fortnox inom en timme. | Kickoff 00:24:30–00:25:20, 00:26:35 (säljarna skapar kunderna i CRM:et); mejlet 4 sept ("finns i Fortnox inom en timme") |
| 6 | Bara exakta träffar kopplas utan att någon tittar; resten är en kort lista att bekräfta. | Mejlet 4 sept ("Filip får bara en kort lista på det som inte kan lösas automatiskt"); tröskeln är min |
| 7 | Rader utan kandidat skapas i Fortnox vid synk – ingen fråga först. | Mejlet 4 sept, paket A; gissat att det ska vara så även för gamla kunder |
| 8 | Kund i Fortnox får: namn, org.nr, adress, e-post, fakturamejl, VAT-nr, er referens, typ Företag. Inte Peppol-ID. | Gissat utifrån fälten på kundkortet i CRM:et |
| 9 | Projekt i Fortnox får: projektnummer = koden, beskrivning = skärmens namn, status Pågående, startdatum = skärmens live-datum. Saknas kod låter jag Fortnox numrera. | Gissat |
| 10 | Timvis synk räcker. | Mejlet 4 sept ("inom en timme") |
| 11 | Varje post synken skapar bär en osynlig markering `{VV <id>}` i Kommentarer-fältet i Fortnox, så att den känns igen även om numret inte hann sparas. | Samma mönster som en annan Fortnox-integration jag driver; gissat att fältet får användas så |
| 12 | Otydliga namn kan bedömas av Claude (en fråga per rad) när en nyckel finns – annars bara regler. Just nu: bara regler. | Mejlet 4 sept ("med hjälp av AI"); sidan säger vilket som gällde |
| 13 | Er egen Fortnox-integration behöver rättigheterna customer, project, article, invoice, companyinformation, settings. Testbolagets integration saknar article, så artiklar är inte läst än. | Fortnox utvecklarportal; provkörning 7 sept |
| 14 | Kunder som tas bort i CRM:et lämnas orörda i Fortnox; kopplingen försvinner. | Gissat |

## Frågor till mötet (svaret jag antagit står efter varje)

1. **Wilmer:** Ska skärmens kod stå i namnet (`1101 - Stenungstorg`) eller vill ni ha ett
   eget kodfält på skärmen? *Antaget: i namnet, som i Filips lista.*
2. **Filip:** Vem sätter koden för en ny skärm – du i Fortnox eller säljaren i CRM:et?
   *Antaget: CRM:et; synken skapar projektet med det numret.*
3. **Filip:** Finns projekten redan i ert Fortnox med de här numren (1101 … 3112), eller
   heter de något annat, som "stor2104"? *Antaget: koden finns antingen som projektnummer
   eller i projektnamnet.*
4. **Filip:** Vad är 1102 "Meta / Google" och 2102 "Programmatisk Skärm" – en skärm, en
   säljkanal, något annat? *Antaget: projekt i Fortnox som alla andra.*
5. **Filip:** Får en namnträff ("Nordic Screens AB" mot "Nordic Screens Aktiebolag")
   kopplas automatiskt, eller vill du bekräfta varje? *Antaget: du bekräftar.*
6. **Filip:** Vilka kunduppgifter ska följa med till Fortnox? Peppol-ID? Er referens =
   säljaren? *Antaget: namn, org.nr, adress, e-post, fakturamejl, VAT-nr, referensfältet
   från kundkortet; inte Peppol-ID.*
7. **Filip:** Ska projektet i Fortnox få status Pågående och startdatum = skärmens
   live-datum, och vem avslutar projekt? *Antaget: ja; avslut gör du i Fortnox.*
8. **Wilmer:** Ska inaktiva skärmar (avbockade i CRM:et) också få projekt i Fortnox?
   *Antaget: ja, alla.*
9. **Filip:** Räcker synk varje hel timme, eller vill du ha "inom några minuter"?
   *Antaget: varje timme.*
10. **Filip:** Vad ska hända när en kund tas bort i CRM:et men finns i Fortnox?
    *Antaget: ingenting i Fortnox.*

## Vad i era tabeller som skulle göra nästa rundor enklare (förslag, inte gjort)

Ett eget kodfält på skärmen (`products`, till exempel `project_code`, unikt, fyra siffror)
i stället för att läsa koden ur namnet – då kan koden aldrig försvinna när någon döper om
en skärm. Organisationsnumret på kunden lagrat som tio siffror utan bindestreck, med
unikhet, så att två kundkort inte kan peka på samma bolag. De tre oanvända
`fortnox_*`-kolumnerna på `orders` kan tas bort; fakturanumren kommer att bo i mitt schema
när fakturarundan byggs. Allt detta är era tabeller och ert beslut – jag ändrar inget där.

---

# Runda 1 – kundreskontran

Samma sandlåda som runda 0: mitt Fortnox-testbolag (som nu har fått ett års påhittade
fakturor) och mitt eget Supabase-projekt. Inget av ert är rört. Det ni rättar här blir
runda 2.

## Vad som finns idag

**Sidan Kundreskontra** (Admin-menyn, bara admin). Filips reskontraflik, inne i CRM:et,
fylld från Fortnox i stället för skriven för hand: en rad per Fortnox-faktura med hans
elva kolumner – Säljare · Projekt · Kundnamn · Fakturadatum · Förfallodatum · Belopp ex moms ·
Moms · Totalt belopp · Betald · Såld · Inlagd i rapport – plus **Kvar att betala** och
delfakturaräknaren (`delfaktura 6/12`). *Betald* är Fortnox saldo noll, läst varje timme.
Filter på år, månad (fakturadatum), säljare, skärm, kund och betald / obetald / förfallen;
summor för urvalet; **Ladda ner XLSX** och **Ladda ner PDF**. Längst ner står när
reskontran senast synkades och om Claude användes för otydliga namn. Fliken **Okopplade**
listar de fakturor ingen regel kunde koppla till en order, med anledning.

**Kopplingen faktura → order.** Varje faktura provas mot fyra regler: kunden är kopplad till
orderns kund; projektet är kopplat till en av orderns skärmar; beloppet ex moms är en
delfaktura av orderns plan (tolerans 1 kr eller 0,5 %); fakturadatumet ligger i orderns
faktureringsfönster (14 dagar före första planerade datum till 31 dagar efter sista). Alla
fyra → kopplad av synken. Färre → ett förslag med anledning på **Fortnox-koppling**, fliken
**Fakturor**: **Bekräfta**, **Koppla till order…** (välj i lista) eller **Lämna okopplad**.
Det du väljer skriver synken aldrig över. En kreditfaktura följer fakturan den krediterar.

**Ordern visar sanningen.** På fakturasidans kort och i orderdialogen står en rad räknad
från Fortnox: *Fortnox: 8 av 12 fakturerade · 7 betalda · förfaller 2026-10-01*. Planen
(12 × 1 127,92 kr) ligger som tooltip. Ordrar utan kopplad faktura ser ut som förut.

**Rapport ekonomi kan växla källa.** Ett nytt val *Källa* i filterraden: **Planerat**
(CRM:ets plan, exakt som idag), **Fakturerat (Fortnox)** och **Betalt (Fortnox)** – samma
tabeller, samma per-ägare-fördelning, samma dialoger, men med Fortnox-fakturorna som
underlag och fakturadatumet som datum. Delfakturan i radens namn räknas från Fortnox.
Okopplade fakturor räknas inte; en rad under valet säger hur många och hur mycket.
Fliken Abonnemang visar alltid planen.

**Länken till Google Sheets.** På Fortnox-koppling, fliken Fakturor, finns sektionen
*Google Sheet*: **Skapa länk** ger en adress som svarar med reskontran som CSV – Filips elva
kolumner, exakt hans rubriker, uppdaterad av varje synk. Adressen visas en gång; den kan
bytas ut eller återkallas. Klistra in `=IMPORTDATA("…")` i cell **A2** på fliken
Kundreskontra (rad 1 är tom idag, rubrikerna står på rad 2), så läser pivoten på Budget som
förut.

Kört i sandlådan den 8 september: 51 fakturor i testbolaget (december 2025 – september
2026, tolv- och sexmånadsserier, kvartal, halvår, engångs); första synken läste alla 51 och
kopplade 48 av sig själv, lade 2 förslag (ett belopp som inte matchar någon delfaktura, ett
projekt som inte finns som skärm i CRM:et) och la den makulerade åt sidan; andra synken
läste 1 ändrad rad och föreslog inget nytt.

**Vad som inte finns än:** inga fakturor skapas, bokförs, skickas eller krediteras av
CRM:et (det är fakturering, ett eget paket); ingen kassaflödessida; ingen chatt över
siffrorna. Ingenting rör ert Fortnox eller ert Supabase-projekt.

## Vad jag har antagit, och varifrån

| # | Antagande | Varifrån |
|---|-----------|----------|
| 15 | *Betald* bedöms per faktura och är Fortnox saldo noll; ordern räknar ihop sina fakturor. **Kvar att betala** visar saldot, så en delbetalning syns utan ett tredje läge. | Kickoff 16:25 ("allt det här är det som är betalt. Det här är ju obetalt"), 08:26 och 16:29 (kassaflödet går på förfallodatum, som bara en faktura har). Delbetalningar nämns aldrig. |
| 16 | En rad i reskontran per Fortnox-faktura; gruppering sker genom summor och filter, inte genom att slå ihop rader. | Kickoff 03:22 ("varje faktura jag gör i Fortnox blir en sån här rad"), 24:05 ("att det inte är CRM:et som släpar efter"). |
| 17 | Fakturadatum styr alla rapporter. Orderdatum syns men styr ingen siffra. | Kickoff 21:26 ("det är ju det enda jag bryr mig om … alla rapporter ska egentligen vara baserade på fakturadatumet"). |
| 18 | Delfakturaräknaren räknar Fortnox-fakturor så snart ordern har en kopplad faktura; ordrar utan kopplad faktura behåller CRM:ets plan. | Kickoff 24:08–24:25 ("delfaktura ett av tolv … att det inte är CRM:et som släpar efter"). |
| 19 | Google Sheet-flödet har exakt de elva kolumnerna i din ordning. *Såld* och *Inlagd i rapport* skickas som konstanter (TRUE): inget i arbetsboken läser Såld, och Inlagd i rapport var handsteget flödet ersätter. | Arbetsboken, fliken Kundreskontra rad 2 (rubrikerna), fliken Budget (pivoten läser bara Säljare, Projekt, Fakturadatum och Belopp ex moms). |
| 20 | Fortnox har de tolv delfakturorna som tolv fakturor; kopplingen görs per faktura. Om ni använder Fortnox avtal ändras bara matcharen. | Kickoff 14:46 ("tolv fakturor"), 14:51 ("Fortnox skapar fakturorna") – se fråga 11. |
| 21 | Toleranserna: 1 kr eller 0,5 % på beloppet; 14 dagar före första och 31 dagar efter sista planerade datum. | Gissat (ören vid 13 535 / 12; en månad sen är fortfarande samma order). En konstant vardera. |
| 22 | Fortnox *Vår referens* på fakturan är säljaren, när ordern saknas. | Gissat utifrån att du skriver säljaren i reskontran; kopplade fakturor tar säljaren från ordern. |
| 23 | Makulerade fakturor visas överstrukna men räknas inte i summor, i räknaren eller i flödet. Kreditfakturor listas med minusbelopp och minskar *fakturerat*. | Gissat – aldrig diskuterat. Se fråga 5. |
| 24 | Första läsningen tar innevarande och föregående räkenskapsår; sedan bara det som ändrats i Fortnox sedan förra körningen. | Mejlet 4 sept ("hela året laddas"); testbolagets räkenskapsår går maj–april. |
| 25 | Flödet klistras in i A2 så att rubriken hamnar på rad 2 och data från rad 3, som idag; pivoten på Budget filtrerar bort rubriken på värde och tål båda. Kassaflödesrapportens 34 radnummer-formler överlever inget flöde – de pekar på handvalda rader. | Arbetsboken: A1 är tom, rubriker på rad 2; Budget A20/F20/J20/M20; Kassaflödesrapport E11–M14. Kassaflödet är paket C. |
| 26 | *Fakturerat* och *Betalt* i rapporten räknar bara fakturor som är kopplade till en order; okopplade nämns under valet. | Gissat – en okopplad faktura har ingen skärm att hamna på. |
| 27 | Fortnox anger `InvoiceType` på varje faktura (`AGREEMENTINVOICE` när avtalsmodulen skapat den); den sparas så att fråga 11 kan besvaras med era riktiga fakturor. | Fortnox API. |
| 28 | I sandlådan är betalningarna fejkade: testbolagets integration saknar rättigheten `payment`, så de 42 "betalda" fakturorna är markerade betalda bara i mitt dev-projekt. Sidorna säger det med röd text. Er integration registrerar riktiga betalningar. | Provkörning 8 sept (`POST /invoicepayments → Har inte behörighet för scope`). |

## Frågor till mötet (svaret jag antagit står efter varje)

11. **Filip:** Skapar du de tolv delfakturorna en och en, eller med Fortnox avtal
    (avtalsfakturering)? Du sa "då lägger jag upp … och Fortnox skapar fakturorna" (14:51) och
    "det läggs ju då in automatiskt" (22:45). *Antaget: en och en; koden läser båda och
    sparar fakturatypen, så vi ser svaret på första riktiga synken.*
12. **Filip:** Vad ska ordern visa när 3 av 12 är betalda, 1 förfallen och 8 inte skickade?
    *Antaget: "Fortnox: 4 av 12 fakturerade · 3 betalda · 1 förfallen (förfaller …)".*
13. **Filip:** Läser någon mer än du Google Sheet-fliken? *Antaget: bara du – länken visas för
    admin en gång och kan återkallas.*
14. **Filip:** Ska *Såld* och *Inlagd i rapport* finnas kvar i flödet eller tas bort?
    *Antaget: kvar som TRUE, så att kolumnerna står där de står.*
15. **Filip:** Vad ska en makulerad eller krediterad faktura göra med räknaren? *Antaget:
    makulerad räknas inte alls; kreditfakturan minskar fakturerat men ändrar inte "X av Y".*
16. **Filip:** Vill du ha ett veckomejl med de fakturor som väntar på dig, i stället för att
    öppna CRM:et? *Antaget: nej – fliken Fakturor räcker i runda 1.*
17. **Wilmer:** Är Filip admin i CRM:et? Om inte – vem bekräftar förslagen? *Antaget: ja, Filip
    är admin.*
18. **Filip:** Vill du ha en vy "vad landade i Fortnox den här veckan och vem skapade det"?
    *Antaget: inte än – Körningar-fliken och Kundreskontra visar det per synk.*

## Den enda ändringen i Wilmers fil, rad för rad

`src/routes/_authenticated/rapport-ekonomi.tsx` (allt annat i den orört):

1. Rad 22–23: två `import`-rader (`RevenueSourceSwitch`, `useRevenueSource`).
2. Rad 291: `const { data, isLoading } = useQuery(` → `const { data: crmData, isLoading } = useQuery(` (ett namn).
3. Rad 306–309: två kommentarrader och `const fortnox = useRevenueSource(crmData); const data = fortnox.data;` – allt nedanför läser `data` som förut.
4. Rad 351: `<SubscriptionTab data={data} …` → `data={crmData}` (Abonnemang-fliken visar planen).
5. Rad 395: `<RevenueSourceSwitch state={fortnox} from={from} to={to} />` i filterraden.

Elva rader tillagda, två namn bytta, ingen logik flyttad. Vägen tillbaka: ta bort de fem
punkterna, så är filen som före. Dessutom en import- och en JSX-rad i `faktura.tsx` och i
`order-dialog.tsx` (Fortnox-raden på orderkortet), och en rad i menyn.
