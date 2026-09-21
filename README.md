# Pregled kampanja

Portal koji spaja Instagram (Meta Ads), Google Ads i Google Analytics 4 u jedan pregled: ukupni rezultati, poređenje platformi, grafikon po danima, tabela kampanja i pregled saobraćaja na sajtu, sa povezivanjem klikova iz oglasa i sesija iz GA4. Namenjen adresi **marketing.irismega.rs**.

## Kako radi

Sve radi na dva servisa, bez sopstvenog servera:

- **Vercel** pokreće aplikaciju (jedna Express funkcija), servira stranicu iz foldera `public/` i na svaka 3 sata poziva osvežavanje podataka (Vercel Cron).
- **Supabase** je Postgres baza u kojoj su podaci o kampanjama i korisnici. Tabele aplikacija sama napravi pri prvom pokretanju.

Tokeni i ključevi postoje samo u podešavanjima na Vercelu. Pregledač ih nikad ne vidi. Korisnici se prijavljuju emailom i lozinkom. Administrator osvežava podatke i dodaje korisnike, a korisnik sa ulogom „Pregled“ samo gleda.

## Šta ti treba

1. Supabase nalog i GitHub nalog.
2. **Vercel Pro** nalog. Hobby plan je prema Vercelovim uslovima za lične, nekomercijalne projekte, a dozvoljava osvežavanje samo jednom dnevno. Proveri aktuelne uslove.
3. DNS pristup za domen `irismega.rs`.
4. Pristup Meta Business nalogu, Google Ads nalogu i GA4 svojstvu (uloga Administrator).

## Postavljanje, korak po korak

### 1. Supabase

1. Napravi novi projekat. Za region izaberi **Central EU (Frankfurt)**, blizu Vercel funkcija (`fra1`). Zapamti lozinku baze.
2. Klikni **Connect** (dugme na vrhu projekta), izaberi **Transaction pooler** i kopiraj URI (port 6543). Zameni `[YOUR-PASSWORD]` lozinkom baze. To je vrednost za `DATABASE_URL`.
3. Tabele ne praviš ručno. Aplikacija ih napravi pri prvom zahtevu i odmah uključi Row Level Security.

Koristi baš adresu sa pooler-om, a ne direktnu. Vercel funkcije se stalno pokreću iznova, pa bi direktne konekcije brzo potrošile ograničenje broja veza.

### 2. GitHub

Napravi **privatni** repozitorijum i otpremi sadržaj ovog foldera (GitHub, Add file, Upload files, ili preko Claude Code-a). Ne otpremaj `.env`. U `.gitignore` je već isključen.

### 3. Vercel

1. **Add New, Project** i uvezi repozitorijum. Vercel sam prepoznaje Express, pa ništa ne menjaš u podešavanjima.
2. U **Environment Variables** unesi promenljive iz `.env.example`. Za prvi start su obavezne `DATABASE_URL`, `JWT_SECRET`, `CRON_SECRET`, `ADMIN_EMAIL` i `ADMIN_PASSWORD`, a ostale dodaješ kako podešavaš izvore.
3. Klikni **Deploy**.

Ako deployment padne uz poruku „Hobby accounts are limited to daily cron jobs“, nisi na Pro planu. U `vercel.json` zameni `0 */3 * * *` sa `0 5 * * *` (jednom dnevno).

Vercel primenjuje nove promenljive tek na **novom deployment-u**. Posle svake izmene promenljivih uradi Redeploy.

### 4. Domen

U Vercelu: Project, Settings, Domains, dodaj `marketing.irismega.rs`. Vercel prikazuje CNAME zapis. Dodaj ga kod provajdera DNS-a za `irismega.rs`.

### 5. Prvo prijavljivanje

Otvori adresu i prijavi se sa `ADMIN_EMAIL` i `ADMIN_PASSWORD`. Zatim obriši `ADMIN_PASSWORD` iz Vercel promenljivih i uradi Redeploy. Dodatne korisnike dodaješ u portalu, u odeljku **Korisnici** na dnu stranice. Ako uneseš email koji već postoji, menjaju se njegova lozinka i uloga.

### 6. Meta (Instagram)

1. U **Meta Business Settings** idi na Users, pa System users, i dodaj sistemskog korisnika.
2. Dodeli mu pristup tvom oglasnom nalogu (dovoljno je čitanje).
3. Generiši token za njega sa dozvolom **ads_read**. Za to ti treba Meta aplikacija povezana sa Business nalogom (developers.facebook.com, tip Business).
4. U Vercel upiši `META_ACCESS_TOKEN` i `META_AD_ACCOUNT_IDS` (ID naloga iz Ads Managera, samo brojevi).
5. `META_CONVERSION_ACTION` podesi prema cilju: `purchase` za prodaju, `lead` za upite.

Portal podrazumevano prikazuje samo Instagram plasmane. Postavi `META_ONLY_INSTAGRAM=false` ako želiš sve Meta plasmane.

### 7. Google Ads

1. **Developer token:** u Google Ads MCC (manager) nalogu, Tools, API Center. Novi token je u test režimu i radi samo sa test nalozima. Za prave naloge zatraži **Basic access**. Odobrenje može da traje od nekoliko dana do nekoliko nedelja.
2. **OAuth klijent:** u Google Cloud konzoli napravi projekat, uključi **Google Ads API**, pa napravi OAuth klijent tipa **Web application**. Kao Authorized redirect URI upiši `https://developers.google.com/oauthplayground`. Upiši `GOOGLE_CLIENT_ID` i `GOOGLE_CLIENT_SECRET`.
3. **Publikovanje aplikacije:** na OAuth consent screen postavi status na **In production**. Ako ostane na Testing, refresh token ističe posle 7 dana.
4. **Refresh token bez terminala:** otvori Google OAuth 2.0 Playground, klikni zupčanik, uključi „Use your own OAuth credentials“ i upiši ID i tajnu klijenta. U polje za scope upiši `https://www.googleapis.com/auth/adwords`, klikni Authorize APIs, pa Exchange authorization code for tokens. Kopiraj **Refresh token** u `GOOGLE_REFRESH_TOKEN`.
5. `GOOGLE_ADS_CUSTOMER_IDS` je ID naloga sa kampanjama. Ako im pristupaš preko MCC-a, upiši ID MCC-a u `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.

Ako radije koristiš terminal: `npm install`, pa `npm run google-auth` (traži klijent tipa Desktop app).

### 8. Google Analytics 4

Opcija sa **servisnim nalogom**. Nema isteka tokena i ne zavisi ni od čijeg ličnog naloga.

1. U istom Google Cloud projektu uključi **Google Analytics Data API**.
2. IAM & Admin, pa Service Accounts: napravi servisni nalog, pa Keys, Add key, JSON. Preuzmi fajl.
3. Otvori JSON fajl u editoru teksta i nalepi **ceo sadržaj** kao vrednost promenljive `GA4_SERVICE_ACCOUNT_JSON` na Vercelu. Fajl posle obriši sa računara ili ga čuvaj samo u menadžeru lozinki.
4. U GA4: Admin, Property access management, dodaj email servisnog naloga (`...@...iam.gserviceaccount.com`) sa ulogom **Viewer**.
5. U `GA4_PROPERTY_IDS` upiši ID svojstva (Admin, Property details).

Alternativa je isti OAuth token kao za Google Ads. U Playground-u dodaj i scope `https://www.googleapis.com/auth/analytics.readonly`, a `GA4_SERVICE_ACCOUNT_JSON` ostavi praznim. Google nalog kojim se prijavljuješ mora imati pristup GA4 svojstvu.

Ključni događaji su oni koje si u GA4 označio kao ključne (Admin, Events). Ako želiš da se broji samo jedan (npr. `purchase` ili `generate_lead`), upiši ga u `GA4_KEY_EVENT_NAME`. Za prihod se podrazumevano koristi `purchaseRevenue`, što radi samo ako sajt ima e-commerce događaje.

### 9. Prvo osvežavanje

Kao administrator klikni **Osveži podatke**. Prvi put se povlači poslednjih 90 dana, a posle toga po 35. Dalje osvežavanje ide samo na svaka 3 sata. Status svakog izvora piše na njegovoj kartici.

## Povezivanje oglasa sa sajtom (UTM)

Tabela „Oglasi i sajt“ spaja klikove iz oglasa sa sesijama iz GA4 po nazivu kampanje i izvoru. Da bi to radilo, oglasi moraju da prenose naziv kampanje u GA4:

- **Meta (Instagram):** u oglasu, u polju „URL parameters“, upiši
  `utm_source=instagram&utm_medium=paid_social&utm_campaign={{campaign.name}}`
- **Google Ads:** uključi automatsko označavanje (Auto-tagging) i poveži Google Ads sa GA4 svojstvom (GA4 Admin, Product links, Google Ads links). Tada GA4 sam prikazuje pravi naziv kampanje.

Poređenje ignoriše velika slova, razmake, interpunkciju i dijakritike, pa se `Slušalice - Stories` i `slusalice_stories` prepoznaju kao ista kampanja. Ispod tabele portal ispisuje koliko je kampanja povezano i koje plaćene sesije nisu povezane ni sa jednom kampanjom.

## CSV uvoz dok čekaš API

Administrator može da uveze izvoz iz Meta Ads Managera i Google Ads-a direktno na kartici svake platforme (najviše 30.000 redova po uvozu). Izvoz mora imati kolonu sa datumom (Dan). Kada API proradi, ukloni uvezene CSV podatke (link na kartici), da se isti dani ne bi računali dvaput.

## Ugrađivanje u WordPress (iframe)

U `vercel.json` promeni `frame-ancestors 'none'` u `frame-ancestors https://irismega.rs` (dodaj i `https://www.irismega.rs` ako se koristi), pa novi deployment. Na WordPress stranici dodaj blok **Prilagođeni HTML**:

```html
<iframe src="https://marketing.irismega.rs" style="width:100%;height:1600px;border:0" title="Kampanje"></iframe>
```

Prijava radi unutar iframe-a jer su `irismega.rs` i `marketing.irismega.rs` isti sajt za pregledač. Jednostavnije je i da samo staviš link na poddomen.

## Održavanje

| Šta | Gde |
|---|---|
| Logovi aplikacije | Vercel, Project, Logs |
| Ažuriranje koda | promena na GitHub-u, pa Vercel sam pravi deployment (grane dobijaju probnu adresu) |
| Pregled podataka | Supabase, Table Editor |
| Backup baze | proveri koje backup-e uključuje tvoj Supabase plan |
| Lokalni razvoj | `.env` sa `DATABASE_URL`, pa `npm install` i `npm run dev` |
| Testovi | `npm install` i `npm test` (koriste Postgres u memoriji, ne dodiruju tvoju bazu) |

## Bezbednost

- **Supabase javni API:** Supabase po defaultu izlaže tabele iz šeme `public` preko javnog API-ja. Aplikacija zato odmah uključuje Row Level Security bez ijedne politike i oduzima prava ulogama `anon` i `authenticated`. Aplikacija se povezuje direktno na bazu, pa ne koristi `supabase-js`, a ključevi `anon` i `service_role` joj nisu potrebni. Ne stavljaj ih nigde.
- `DATABASE_URL` daje pun pristup bazi. Tretiraj ga kao lozinku i drži samo u Vercelu.
- Veza sa bazom je šifrovana, ali se sertifikat podrazumevano ne proverava. Za strogu proveru upiši Supabase CA sertifikat u `DATABASE_CA`.
- Lozinke se čuvaju kao bcrypt heševi, a prijava je ograničena na 10 neuspešnih pokušaja u 15 minuta po IP adresi.
- Kolačić sesije je `httpOnly` i `Secure`, a izmene proveravaju Origin zaglavlje.
- Adresa `/api/cron/sync` prihvata samo zahteve sa tajnom `CRON_SECRET`, koju Vercel sam šalje.
- Meta token pravi za sistemskog korisnika sa pravom samo čitanja. Google pristup je ograničen na čitanje.

## Poznata ograničenja

- **GA4 podaci kasne** oko 24 do 48 sati, a Google ih može naknadno korigovati. Zato se svako osvežavanje vraća 35 dana unazad. GA4 može da primeni i pragove privatnosti na male brojeve.
- **Konverzije** su onako kako ih platforma računa (Meta atribucija i Google atribucija se razlikuju), pa zbir može da se razlikuje od tvog webshopa ili GA4.
- **Datumi** dolaze u vremenskoj zoni oglasnog naloga.
- **Vreme osvežavanja:** osvežavanje svih izvora mora da stane u ograničenje Vercel funkcije (300 sekundi). Ako ga prekoračiš, javi da podelimo osvežavanje po izvoru.
- **Verzije API-ja** se menjaju. Podrazumevano su Google Ads `v25` i Meta `v25.0`, a menjaju se u promenljivama (`GOOGLE_ADS_API_VERSION`, `META_API_VERSION`). Ako osvežavanje počne da javlja grešku o verziji, proveri aktuelne verzije u zvaničnoj dokumentaciji.
- Kod je testiran sa lažnim odgovorima API-ja i sa pravim Postgres-om u memoriji. Na pravom Vercelu i Supabase-u, kao i sa tvojim pravim nalozima, nije probano, pa prvo osvežavanje proveri sa pažnjom.
