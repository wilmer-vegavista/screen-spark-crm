# Fortnox-integrationen – runda 0

Det här är mötessidan: vad som är byggt, vad jag har antagit, och de frågor bara Filip
eller Wilmer kan svara på. Allt körs än så länge mot en sandlåda – ett Fortnox-testbolag
och ett eget Supabase-projekt med påhittade kunder – så inget av ert är rört. Det ni rättar
på mötet blir runda 1.

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
