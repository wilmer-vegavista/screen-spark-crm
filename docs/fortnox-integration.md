# Fortnox-integrationen – runda 0, runda 1 och runda 2

Det här är mötessidan: vad som är byggt, vad jag har antagit, och de frågor bara Filip
eller Wilmer kan svara på. Allt körs än så länge mot en sandlåda – ett Fortnox-testbolag
och ett eget Supabase-projekt med påhittade kunder – så inget av ert är rört. Det ni rättar
på mötet blir nästa runda. Runda 0 (kopplingen kund/skärm) står först; runda 1
(kundreskontran) i mitten; runda 2 (kassaflödet) längst ner på sidan.

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

---

# Runda 2 – kassaflödet

Samma sandlåda som runda 0 och 1: mitt Fortnox-testbolag, som nu också har fått ett års
påhittade leverantörsfakturor, lönekörningar, skattebetalningar, momsavstämningar och
bankverifikationer, och mitt eget Supabase-projekt. Inget av ert är rört. Beloppen i
sandlådan är av samma storlek som i din arbetsbok men inte dina siffror. Det ni rättar här
blir nästa runda.

## Vad som finns idag

**Sidan Kassaflöde** (Admin-menyn, bara admin). Din likviditetsflik, inne i CRM:et, med
samma uppställning: dina rader i din ordning (rad 6–55 i `Kassaflödesrapport`, rubrikerna
ordagrant), kolumnen *(Inför) start*, räkenskapsårets tolv månader och *Summa*. Räkenskapsåret
följer Fortnox (testbolaget går maj–april; arbetsboken har 1 januari inskrivet – sidan antar
ingenting om det), och det finns en väljare för år.

- **Passerade månader** visar bara utfall från huvudboken. Pengar in = kundfakturor som
  Fortnox markerat betalda den månaden, per kategori (netto på kategoriraden, momsen på
  *Utgående moms*). Pengar ut = leverantörsfakturor betalda den månaden per konto (netto på
  raden, momsen på *Ingående moms*) plus alla andra bankrörelser i huvudboken: lönekörningens
  bankrad blir *Löner exkl arbetsgivaravgifter & skatt*, skattebetalningen *Arbetsgivaravgifter
  & skatt*, momsavstämningen *Moms att betala*, och allt annat går rad för rad via kontomappningen.
  Bär en in- eller utbetalning en extra rad utöver kund- eller leverantörsfordran — öresavrundning,
  en bankavgift, en kassarabatt — går även den via kontomappningen, och saknar kontot regel listas
  den bland de okopplade kontona. Ingen rad försvinner tyst.
- **Månader framåt** är kursiva och byggs så: planen är golvet; kända fakturor på förfallodatum
  (kundfakturor och leverantörsfakturor) och orderbokens planerade delfakturor (ljusare – inte
  fakturerade ännu) höjer siffran. *Arbetsgivaravgifter & skatt* bär det Bron bokade månaden
  före; *Moms att betala* bär momsperiodens netto i sin betalmånad.
- **Innevarande månad** är utfall hittills + prognos för resten, och kolumnen säger det. Har Bron
  redan betalat (han betalar den 12:e) minskas den bokade skulden med det som betalats, så samma
  pengar aldrig räknas två gånger — precis som *Moms att betala* alltid gjort.
- **Momsraderna**: verklig moms i passerade månader, 25 % av raderna i prognosen – exakt som
  arbetsbokens formler (rad 16 läser intäktsraderna, rad 42 läser rad 24, 25, 29–35, 37–41).
- **Kassaraderna** räknas som i arbetsboken: *Kontanta medel* i första månaden = startkolumnens
  *Kassa (månadsslutet)* (= *Kassa årets ingång*), *Summa kontanta medel* = kontanta medel + summan
  av rad 10–17, *Summa utbetalningar* = rad 23–42 + 47–51, *Kassa (månadsslutet)* = skillnaden.
  Under varje passerad månads *Kassa (månadsslutet)* står huvudbokens eget banksaldo, i rött om det
  skiljer sig – så syns en avvikelse direkt.
- **Håll muspekaren över en siffra** så visas underlaget: vilka fakturor, vilka verifikationer,
  vilken plan, och regeln som gav siffran.
- **Ladda ner PDF**: ett liggande A4 med hela rutnätet; prognos i kursiv stil, planerade belopp
  märkta med `*`, summor i fetstil – så syns skillnaden också i svartvitt.

**Fliken Plan** på samma sida. Det du skriver in för hand i arbetsboken: ett belopp per rad,
förifyllt från bokföringen (snittet av de tre senaste passerade månaderna, avrundat till 100 kr,
märkt *från bokföringen*), ändringsbart per rad och med en egen siffra för en enskild månad.
*Kassa årets ingång* läses från huvudboken (ingående balans på kassakontona; om året inte är
stängt i Fortnox: föregående års utgående balans) och kan skrivas över manuellt. Varje ändring
visar vem och när, och synken skriver aldrig över det du ändrat.

**Fliken Regler & konton** på samma sida. Kategoriregeln för pengar in (säljare / projekt /
skärmtyp / fakturering → intäktsrad, prövas i prioritetsordning), kontomappningen för pengar
ut (konto, kontointervall eller leverantör → rad; leverantör vinner över exakt konto som vinner
över intervall), listan över konton som ingen regel täcker (med belopp – de ligger på *Övriga
kostnader* tills de mappas, inget försvinner) och inställningarna: momsperiod, betalmånad,
kassakonton. En ändring ritar om sidan direkt, utan synk.

**Synken** (Synka nu och timjobbet) läser efter fakturorna också huvudboken: leverantörer,
leverantörsfakturor (första gången innevarande och föregående räkenskapsår, sedan bara ändrade)
och alla verifikationer via Fortnox SIE-export per räkenskapsår (innevarande år varje körning),
och fyller på planen där du inte ändrat den.

Kört i sandlådan den 9 september: 13 påhittade leverantörer, 138 leverantörsfakturor
(september 2025 – september 2026, 126 betalda, 12 öppna varav 2 förfallna), 210 verifikationer
(12 lönekörningar, 11 skattebetalningar, momsavstämningar, 42 kundinbetalningar, 126
leverantörsbetalningar, bankavgifter, ränta, ingående kassa), 1 292 verifikationsrader i
huvudboken, och en plan förifylld på 18 rader.

**Vad som inte finns än:** ingen bankfil (finns inte i Fortnox API, behövs inte – som vi sa);
ingen chatt över siffrorna (paket D, nästa lilla runda); ingen avstämning mot ett kontoutdrag;
inga delbetalningar (en faktura räknas som betald när saldot är noll). Ingenting rör ert Fortnox
eller ert Supabase-projekt.

## Så bestämmer en ruta

| Månad | Pengar in | Pengar ut |
|---|---|---|
| Passerad | Kundfakturor betalda den månaden (Fortnox betaldatum), per kategoriregeln | Leverantörsfakturor betalda den månaden per kontomappningen; lönekörning → Löner; skattebetalning → Arbetsgivaravgifter & skatt; momsavstämning → Moms att betala; övriga bankrörelser per motkonto |
| Innevarande | Betalt hittills + öppna fakturor som förfaller (även förfallna) + planerade delfakturor | Betalt hittills + öppna leverantörsfakturor som förfaller + planens rest |
| Framåt | Det största av planen och (öppna fakturor på förfallodatum + orderbokens planerade delfakturor) | Det största av planen och (öppna leverantörsfakturor på förfallodatum + bokade skatter/avgifter från månaden före); momsen i sin betalmånad |

## Vad jag har antagit, och varifrån

| # | Antagande | Varifrån |
|---|-----------|----------|
| 29 | Rutnätet är arbetsbokens, rad för rad: rad 6–55 i `Kassaflödesrapport` med dina rubriker ordagrant (inklusive *SKÄRM nationella intäkter*, *Skärm abbonemang*), tre Summa-rader och de tre kassaraderna med samma formler. | Arbetsboken, läst cell för cell 9 sept (rad 18 = SUBTOTAL(10:17), rad 19 = rad 6 + rad 10–17, rad 53 = rad 23–42 + 47–51, rad 55 = rad 19 − rad 53, rad 6 nästa månad = rad 55). |
| 30 | Räkenskapsåret är Fortnox räkenskapsår, inte kalenderåret. | Arbetsboken har 2026-01-01 inskrivet i B4 (`Räkenskapsårets_startdatum`); testbolaget går maj–april; sidan läser `/financialyears`. |
| 31 | Passerade månader kommer från huvudboken, läst som Fortnox SIE-export (typ 4) per räkenskapsår – samma huvudbok, i en fil. | Mejlet 4 sept ("passerade månader från huvudboken som faktiska siffror"); kickoff 07:42–07:53 ("integrerar man huvudboken från fortnox … tar ju ändå upp alla löner"). |
| 32 | Pengar in går på förfallodatum: öppna kundfakturor landar i förfallomånaden, förfallna i innevarande månad. | Kickoff 08:22–08:25 ("en kassaflödesanalys som går på förfallodatum"), 08:56, 16:15–16:33. |
| 33 | Orderbokens delfakturor som Fortnox inte fakturerat än landar i sin planerade förfallomånad (planerat fakturadatum + orderns betalvillkor, 30 dagar om inget står) och ritas ljusare. De återstående delfakturorna är de sista i planen. | Mejlet 4 sept ("från orderboken för månaderna framåt (ljusare färg = planerat)"); kickoff 16:11–16:33 ("orderdatumet … i juli … första fakturadatum … augusti … förfallo … september … prognostiserat"). |
| 34 | Kategoriregeln: säljaren Alta och skärmar av typen extern → *extern försäljning (Alta Outdoor)*; projekt 2102 → *programmatisk*; ordrar som faktureras månad/kvartal/halvår (det fliken Abonnemang i Rapport ekonomi räknar) → *abonnemang*; allt annat → *egen försäljning*. Säljarregeln vinner över abonnemangsregeln. | Arbetsboken: fliken Budget utesluter säljaren Alta ur varje pivot; projektet *2102 - Programmatisk Skärm*; `rapport-ekonomi.tsx` SubscriptionTab (billing_frequency ≠ engang). Gissat i övrigt – se fråga 22. |
| 35 | Pengar ut: leverantörsfakturor från Fortnox på förfallodatum, placerade på rad efter fakturans kostnadskonto (eller leverantören för de tre SaaS-raderna). | Mejlet 4 sept ("från leverantörsreskontran"); kickoff 08:48–08:56 ("tar hela leverantörsreskontran … kostnadshuvudboken, skatter och allting. Går på förfallo"). Standardmappningen: se tabellen nedan. |
| 36 | Momsen räknas per period från 26xx-kontona i huvudboken (passerade månader) och från momsraderna i prognosen, och betalas den 12:e i andra månaden efter perioden. Perioden är en inställning, antagen *månad*. | Antaget (arbetsordern). Arbetsbokens *Moms att betala* har belopp i feb, jun, aug och nov – det ser ut som kvartal. Se fråga 19. |
| 37 | Bron bokar lönen i löneutbetalningsmånaden i formen 7010/7510 debet, 2710/2731/1930 kredit, och skatten och avgifterna betalas den 12:e månaden efter. Sidan lägger därför det som bokas på 27xx en månad på månaden efter. | Kickoff 07:42–07:50 (huvudboken tar upp lönerna; lönekörning i Fortnox "helt onödigt"); formen och månaden efter är gissade – se fråga 20. |
| 38 | Planen är golvet i prognosmånader; kända belopp höjer den. Den förifylls med snittet av de tre senaste passerade månaderna, avrundat till 100 kr, och synken rör aldrig en rad du ändrat. | Mejlet 4 sept ("en återkommande plan … som förifylls från bokföringen och som Filip justerar direkt i sidan"); kickoff 08:05–08:16 ("det jag manuellt lägger in varje kostnad vi har varje månad … ska CRM:et kunna se"). Tre månader: gissat – se fråga 24. |
| 39 | Innevarande månad = utfall hittills + öppna fakturor som förfaller + planens rest, och kolumnen säger "hittills + prognos". | Gissat – arbetsboken har en färg per cell (grönt = bokfört) bara i utbetalningsdelen, jan–aug. |
| 40 | Momsraderna i prognosen är 25 % av raderna, som i arbetsboken; i passerade månader den verkliga momsen. | Arbetsboken rad 16 och rad 42 (formlerna). |
| 41 | "Kassan" är kontona 1900–1999. *Kassa årets ingång* är deras ingående balans i Fortnox, eller föregående års utgående balans när året inte är stängt, och kan skrivas över för hand. | Gissat (arbetsboken har 316 000 inskrivet i D17). Se fråga 21. |
| 42 | Utfallet räknas när pengarna rör sig på banken, inte när fakturan bokförs: kundfakturor på betaldatum, leverantörsfakturor på betaldatum, löner på utbetalningsdagen, skatt och moms när de betalas. | Gissat – det är vad "kassaflöde" betyder; huvudbokens 19xx-saldo bredvid visar om något saknas. |
| 43 | Konton som ingen regel täcker hamnar på *Övriga kostnader* och listas med belopp. | Gissat (arbetsordern: inget får försvinna tyst). |
| 44 | *SKÄRM nationella intäkter* och *Övriga intäkter* finns som rader men fylls av ingen regel; *Övriga intäkter* får dock intäkter som bokas direkt mot bank (ränta, kontantförsäljning). | Arbetsboken: rad 10 och 15 är tomma. Se fråga 22. |
| 45 | I sandlådan är betalningarna fejkade även för leverantörsfakturor (samma orsak som i runda 1: rättigheten payment saknas); seeden bokar i stället bankverifikationerna själv, så huvudboken stämmer. Sidan säger det med röd text. | Provkörning 9 sept (`POST /supplierinvoicepayments → Har inte behörighet för scope`). |
| 46 | Delbetalningar modelleras inte: en faktura är betald när saldot är noll; en öppen fakturas kvarvarande belopp delas proportionellt i netto och moms. | Gissat – arbetsboken har inga delbetalningar. |

**Standardregeln för kategori** (fliken Regler & konton, prio i ordning): 10 säljare börjar med
*Alta* → extern · 20 skärmtyp *extern* → extern · 30 projekt *2102* → programmatisk · 40
fakturering *abonnemang* (månad/kvartal/halvår) → abonnemang · 100 allt annat → egen.

**Standardmappningen konto → rad** (min läsning av BAS mot dina rader; din kontoplan avgör):
leverantör *Google…* → Google workspace · *Squarespace…* → Squarespace · *Fortnox…* → Fortnox ·
1200–1299 → Investeringar · 1380–1389 → Reserv och/eller deposition · 1630 → Arbetsgivaravgifter
& skatt · 2010–2019, 2890–2899 → Eget uttag · 2350–2399 → Kapitalkostnad · 2610–2659 → Moms att
betala · 2640–2649 → Ingående moms · 2700–2799 → Arbetsgivaravgifter & skatt · 2820–2829 →
Löner · 3000–3999 → Övriga intäkter · 5010 → Kontorshyra · 5011 → Fasta hyror (gissat) · 5012 →
Rörliga hyror (gissat) · 5013–5099 → Kontorshyra · 5020 → El-kostnader skärmar · 5200–5299 →
Leasingkostnader · 5400–5499 → Övriga skärmkostnader · 5500–5599 → Servicekostnader skärmar ·
5600–5699 → Leasingkostnader · 5700–5799 → Övriga kostnader · 5800–5899 → Utlägg · 5900–5999 →
Säljkostnader (media mm) · 6000–6099 → Utlägg · 6100–6299 → Övriga kostnader · 6300–6399 →
Försäkringskostnader skärmar · 6400–6599 → Övriga kostnader · 6900–6949 → Övriga kostnader ·
6950–6959 → Bygglovskostnader · 6960–6999 → Övriga kostnader · 7000–7299 → Löner · 7300–7499 →
Övriga personalkostnader · 7500–7599 → Arbetsgivaravgifter & skatt · 7600–7699 → Övriga
personalkostnader · 7700–7999 → Övriga kostnader · 8300–8399 → Övriga intäkter · 8400–8499 →
Kapitalkostnad.

## Frågor till mötet (svaret jag antagit står efter varje)

19. **Filip:** Vilken momsperiod har ni – månad, kvartal eller helår – och betalar ni den 12:e i
    andra månaden efter? Arbetsbokens *Moms att betala* ligger i feb, jun, aug och nov. *Antaget:
    månad, den 12:e två månader efter; en inställning på sidan.*
20. **Filip:** Bokar Bron lönen i utbetalningsmånaden och betalas skatt och arbetsgivaravgifter
    månaden efter (den 12:e)? Vilka konton använder Bron för prel. skatt och avgifter – 2710/2731,
    eller skattekontot 1630? *Antaget: utbetalningsmånaden; månaden efter; 2710/2731.*
21. **Filip:** Vilka konton är "kassan" – bara 1930, eller också sparkonto/placeringar (19xx)?
    *Antaget: alla 1900–1999.*
22. **Filip:** Vad ska *SKÄRM nationella intäkter* och *Övriga intäkter* hålla? Är *extern
    försäljning (Alta Outdoor)* det som säljs på Altas skärmar, det Alta säljer, eller båda?
    *Antaget: nationella tomt; övriga = ränta och sådant som bokas direkt mot bank; extern =
    säljaren Alta och skärmar av typen extern.*
23. **Filip:** Ska Alta Outdoors andel av intäkten (fördelningen på skärmar med ägare) synas
    som en pengar-ut-rad, eller ligger den redan i era leverantörsfakturor? *Antaget: den kommer
    som leverantörsfaktura och hamnar där kontot pekar.*
24. **Filip:** Ska planen förifyllas med tre eller sex månaders snitt? *Antaget: tre.*
25. **Filip:** Vilka konton använder ni för skärmplatsernas hyror (fasta och rörliga), bygglov
    och skärmar som köps? Jag har gissat 5011, 5012, 6950 och 12xx. *Antaget: som i
    standardmappningen; ni ändrar på sidan.*
26. **Filip:** Ska planen gälla per räkenskapsår (nollställas när nytt år börjar) eller rulla
    på? *Antaget: den rullar på; en månads egen siffra gäller bara den månaden.*

**Två noteringar från runda 1, till Wilmer och Filip:**

- **Wilmer:** kolumnen `orders.pdf_language` (PR #21 den 3 sept) finns i er produktionsdatabas
  men har ingen migration i repot; jag lade till den för hand i mitt dev-projekt den 9 sept för
  att fakturasidan ska rendera. Den behöver en migration hos er – jag rör den inte.
- **Filip:** Fortnox rundar fakturans *Totalt* till hela kronor (1 127,92 + 281,98 = 1 409,90
  men Fortnox säger 1 410). Reskontran visar Fortnox siffra; din kolumn H (`=F+G`) skiljer sig
  med upp till 50 öre per rad. Det är Fortnox siffra som fakturerats.

## Den enda ändringen i Wilmers filer den här rundan

En rad i menyn (`src/components/app-shell.tsx`): `Kassaflöde` under Admin, bredvid
Kundreskontra. Plus den genererade rutt-tabellen. Ingen ändring i `rapport-ekonomi.tsx`,
`faktura.tsx` eller `order-dialog.tsx`.
