# PB Trading Journal

Webový trading journal postavený na Reactu (Vite + TypeScript). Data se ukládají lokálně v prohlížeči (`localStorage`) — zálohuj pomocí **JSON exportu** v aplikaci.

Repo: https://github.com/marekmarek-web/tradingjournal

## Požadavky

- [Node.js](https://nodejs.org/) (LTS)

## Lokální vývoj

```bash
npm install
npm run dev
```

## Produkc build

```bash
npm run build
```

Statické soubory jsou ve složce `dist/` (vhodné pro hosting typu Vercel, Netlify, GitHub Pages).

## Funkce (zjednodušeně)

Ruční zápis obchodů, import CSV (MT5/FundedNext), screenshoty k obchodům, dashboard (PnL, R, win rate, …), filtry, export/import JSON a export CSV.

## SQL migrace

U této SPA **neprobíhají žádné databázové migrace** — není použita serverová databáze.
