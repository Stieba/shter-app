# SHTER — bandplanning

Gedeelde kalender voor de band. Iedereen ziet dezelfde kalender, in realtime.

## Wat dit is

Dezelfde app als het Claude-artifact, maar nu met een **echte database**
(Supabase/Postgres) in plaats van de experimentele `window.storage` van het
artifact-platform. Dat lost het "opslaan mislukt" / "data verdwijnt bij
sluiten" probleem structureel op.

## Stap 1 — Supabase project aanmaken (5 min, gratis)

1. Ga naar https://supabase.com en maak een gratis account/project aan.
2. In het nieuwe project: ga naar **SQL Editor** → **New query**.
3. Plak de hele inhoud van `supabase-schema.sql` (in deze map) erin en klik **Run**.
   Dit maakt de tabellen `members`, `blocks`, `proposals` aan en vult de
   7 bandleden alvast in.
4. Ga naar **Project Settings → API**. Daar staan twee waarden die je nodig hebt:
   - **Project URL**
   - **anon public key**

## Stap 2 — Project lokaal openen in Claude Code

1. Open deze map (`shter-app`) in Claude Code, of plak de bestanden in een
   nieuwe map en open die.
2. Maak een bestand `.env.local` aan (kopieer `.env.local.example`) en vul
   de twee waarden van Supabase hierboven in:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://jouw-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=jouw-anon-key
   ```
3. Installeer en start:
   ```
   npm install
   npm run dev
   ```
4. Open http://localhost:3000 — de kalender zou nu moeten werken, met
   echte opslag.

## Stap 3 — Live zetten (Vercel, gratis)

1. Zet het project op GitHub (Claude Code kan dit voor je doen: "zet dit
   project op GitHub").
2. Ga naar https://vercel.com, log in met GitHub, en importeer de repo.
3. Bij het importeren vraagt Vercel om environment variables — vul daar
   dezelfde twee Supabase-waarden in als in `.env.local`.
4. Klik **Deploy**. Na ~1 minuut krijg je een live URL
   (zoiets als `shter-kalender.vercel.app`) die je naar de band kan sturen.

## Belangrings

- Geen wachtwoord/login: wie de link heeft, kan onder elke naam blokkeren.
  Voor 7-10 bandleden is dat een bewuste, simpele keuze.
- Wijzigingen zijn **realtime**: als Niels een dag blokkeert, ziet Fleur dat
  zonder te hoeven verversen (mits ze de pagina open heeft staan).
- Een 8e/9e/10e bandlid toevoegen kan gewoon in de app zelf ("+ lid
  toevoegen" op het naamscherm) — dat hoeft niet via de database.

## Bestanden

- `app/page.js` — de hele applicatie (UI + database-calls)
- `app/layout.js` — paginatitel/basislayout, verplicht door Next.js
- `lib/supabaseClient.js` — verbinding met de database
- `supabase-schema.sql` — eenmalig uit te voeren in Supabase
- `.env.local.example` — welke geheime sleutels nodig zijn
