# Novelista

Eine extrem einfache Schreib-App für Romanautoren. Der Autor schreibt – die App
übernimmt Korrektur, Struktur und Organisation des Manuskripts.

> **Prinzip:** Du schreibst. Den Rest übernehmen wir.

## Was die App im MVP kann

- **Schreiben & Diktieren** – Text tippen oder per Stimme diktieren (Spracheingabe)
- **Lektorat per Knopfdruck** – KI korrigiert Rechtschreibung, Grammatik,
  Zeichensetzung, Absätze, Dialogformatierung und deutsche Anführungszeichen,
  **ohne Inhalt oder Stil zu verändern**
- **Ein zentrales Manuskript** – keine Ordner, keine Dateiverwaltung
- **Automatisches Speichern** in der Cloud
- **Kapitelübersicht**, die sich automatisch aus dem Text ergibt
- **Buch-PDF-Export** mit Format, Rändern, Schrift, Kapitelanfängen, Seitenzahlen
- **Responsiv** für Desktop und Mobilgerät

## Technik

| Bereich        | Technologie               |
| -------------- | ------------------------- |
| Frontend       | Next.js 14 (App Router)   |
| Sprache        | TypeScript                |
| Styling        | Tailwind CSS              |
| Datenbank      | Supabase (PostgreSQL)     |
| Anmeldung      | Supabase Auth (Magic Link)|
| KI-Lektorat    | OpenAI API                |
| Hosting        | Vercel                    |

---

## Einrichtung in 5 Schritten

### 1. Abhängigkeiten installieren

```bash
npm install
```

### 2. Supabase einrichten

1. Auf [supabase.com](https://supabase.com) ein kostenloses Projekt anlegen.
2. Im Dashboard unter **SQL Editor** den Inhalt von
   [`supabase/schema.sql`](./supabase/schema.sql) einfügen und ausführen.
3. Unter **Project Settings → API** findest du `Project URL` und `anon public key`.
4. Optional: Unter **Authentication → URL Configuration** die
   `Site URL` auf deine Domain (bzw. `http://localhost:3000` für lokal) setzen.

### 3. OpenAI-Schlüssel holen

Einen API-Key auf
[platform.openai.com/api-keys](https://platform.openai.com/api-keys) erstellen.

### 4. Umgebungsvariablen anlegen

`.env.example` nach `.env.local` kopieren und ausfüllen:

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://dein-projekt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=dein_anon_key
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

### 5. Starten

```bash
npm run dev
```

Die App läuft nun auf [http://localhost:3000](http://localhost:3000).

---

## Auf Vercel veröffentlichen

1. Projekt auf GitHub pushen.
2. Auf [vercel.com](https://vercel.com) das Repository importieren.
3. Unter **Settings → Environment Variables** dieselben vier Variablen wie in
   `.env.local` eintragen.
4. In Supabase unter **Authentication → URL Configuration** die Vercel-Domain
   als `Site URL` und unter **Redirect URLs**
   `https://deine-domain.vercel.app/auth/callback` ergänzen.
5. Deploy.

---

## Wie das KI-Lektorat denkt

Das Verhalten ist in [`src/lib/openai.ts`](./src/lib/openai.ts) festgelegt. Die KI
agiert als professioneller Lektor und arbeitet bei `temperature: 0`
(deterministisch). Sie **korrigiert und formatiert ausschließlich** und verändert
weder Stil noch Inhalt. Unklare Stellen bleiben unangetastet.

---

## Nächste Ausbaustufen (vorbereitet)

Diese Funktionen aus der Projektvision lassen sich auf dieser Grundstruktur
schrittweise ergänzen:

- Automatisches Lektorat beim Schreiben (Pause-Erkennung statt Knopfdruck)
- Personen-, Orts- und Zeitleisten-Erkennung (eigene KI-Analyse-Route)
- Verlags-Paket (Klappentext, Exposé, Figurenübersicht, Zusammenfassung)
- Cover-Generator (Vorder-/Rückseite und Buchrücken)
- Offline-Schreibmodus (Service Worker + lokale Zwischenspeicherung)

## Projektstruktur

```
src/
├── app/
│   ├── api/correct/route.ts   KI-Lektorat-Endpunkt
│   ├── auth/callback/route.ts Magic-Link-Rückleitung
│   ├── editor/page.tsx        lädt/erstellt das Manuskript
│   ├── login/page.tsx         Anmeldung
│   ├── layout.tsx · page.tsx · globals.css
├── components/
│   ├── EditorClient.tsx       Schreibfläche, Autosave, Diktat, Korrektur
│   └── ExportDialog.tsx       Buch-PDF-Export
├── lib/
│   ├── openai.ts              Lektor-Logik
│   ├── pdf.ts                 PDF-Erzeugung
│   ├── chapters.ts            automatische Kapitelerkennung
│   └── supabase/              Client, Server, Middleware
└── middleware.ts              Routenschutz & Session
supabase/schema.sql            Datenbankschema + Sicherheitsregeln
```
