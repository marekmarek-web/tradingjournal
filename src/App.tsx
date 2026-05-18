import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * PB Trading Journal — single-file React/TSX app
 * ------------------------------------------------
 * Použití v Cursoru:
 * 1) Vytvoř nový Vite projekt: npm create vite@latest pb-journal -- --template react-ts
 * 2) Nahraď src/App.tsx tímto souborem.
 * 3) V src/index.css nech Tailwind, nebo použij běžný CSS reset. Tohle je psané v Tailwind třídách.
 * 4) npm install && npm run dev
 *
 * Funkce:
 * - Ruční zadávání obchodů
 * - Upload CSV z MT5/FundedNext/ruční exporty
 * - Upload screenshotů ke konkrétním obchodům
 * - Dashboard: PnL, %, R, winrate, PF, drawdown, streaky
 * - Filtry podle instrumentu, směru, setupu, grade, session, data
 * - Export/import JSON zálohy
 * - Export CSV
 * - Lokální úložiště v prohlížeči přes localStorage
 *
 * Poznámka: localStorage není databáze. Pro dlouhodobé ostré použití doporučuji později přidat Supabase/Firebase.
 */

type Direction = "LONG" | "SHORT";
type Grade = "A+" | "A" | "B+" | "B" | "C" | "NO TRADE";
type SessionName = "Asia" | "London" | "NY AM" | "NYSE" | "NY PM" | "Other";
type SetupType =
  | "SSL sweep → BOS → FVG"
  | "BSL sweep → BOS → FVG"
  | "Bull continuation → FVG/OB"
  | "Bear continuation → FVG/OB"
  | "OB retest"
  | "FVG retest"
  | "Manual / Other";

type MistakeTag =
  | "Bez chyby"
  | "SL moc blízko"
  | "Pozdní vstup"
  | "Vstup bez potvrzení"
  | "Countertrend"
  | "News risk"
  | "Revenge trade"
  | "Přepnutí instrumentu po ztrátě"
  | "Porušení checklistu"
  | "Příliš velký risk";

type NewsMode = "Normal" | "High impact" | "CPI/NFP/FOMC" | "Earnings risk" | "Unknown";

type Trade = {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  instrument: string;
  direction: Direction;
  entry: number;
  sl: number;
  tp: number;
  exit: number;
  lot: number;
  pnl: number;
  accountSize: number;
  pnlPct: number;
  rMultiple: number;
  riskUsd: number;
  setup: SetupType;
  grade: Grade;
  session: SessionName;
  probability: number;
  stopRisk: number;
  evR: number;
  rrPlanned: number;
  htfBias: string;
  m15Context: string;
  m1Trigger: string;
  newsMode: NewsMode;
  mistake: MistakeTag;
  emotions: string;
  notes: string;
  screenshot?: string; // base64 data URL
  createdAt: string;
  source?: "manual" | "csv" | "import";
};

type Settings = {
  accountSize: number;
  maxDailyLossPct: number;
  maxTradesPerDay: number;
  maxLossesPerDay: number;
  defaultRiskPct: number;
  currency: string;
};

type Filters = {
  query: string;
  instrument: string;
  direction: "ALL" | Direction;
  grade: "ALL" | Grade;
  setup: "ALL" | SetupType;
  session: "ALL" | SessionName;
  dateFrom: string;
  dateTo: string;
};

const STORAGE_KEY = "pb_trading_journal_v1";
const SETTINGS_KEY = "pb_trading_journal_settings_v1";

const setupOptions: SetupType[] = [
  "SSL sweep → BOS → FVG",
  "BSL sweep → BOS → FVG",
  "Bull continuation → FVG/OB",
  "Bear continuation → FVG/OB",
  "OB retest",
  "FVG retest",
  "Manual / Other",
];

const gradeOptions: Grade[] = ["A+", "A", "B+", "B", "C", "NO TRADE"];
const sessionOptions: SessionName[] = ["Asia", "London", "NY AM", "NYSE", "NY PM", "Other"];
const mistakeOptions: MistakeTag[] = [
  "Bez chyby",
  "SL moc blízko",
  "Pozdní vstup",
  "Vstup bez potvrzení",
  "Countertrend",
  "News risk",
  "Revenge trade",
  "Přepnutí instrumentu po ztrátě",
  "Porušení checklistu",
  "Příliš velký risk",
];
const newsOptions: NewsMode[] = ["Normal", "High impact", "CPI/NFP/FOMC", "Earnings risk", "Unknown"];

const defaultSettings: Settings = {
  accountSize: 10000,
  maxDailyLossPct: 1,
  maxTradesPerDay: 2,
  maxLossesPerDay: 2,
  defaultRiskPct: 0.25,
  currency: "USD",
};

const emptyFilters: Filters = {
  query: "",
  instrument: "ALL",
  direction: "ALL",
  grade: "ALL",
  setup: "ALL",
  session: "ALL",
  dateFrom: "",
  dateTo: "",
};

const today = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function n(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/\s/g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function fmt(v: number, digits = 2) {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("cs-CZ", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtMoney(v: number, currency = "USD") {
  if (!Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${fmt(v, 2)} ${currency}`;
}

function pct(v: number, digits = 2) {
  if (!Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${fmt(v, digits)} %`;
}

function parseDateTime(raw: string): { date: string; time: string } {
  if (!raw) return { date: today(), time: nowTime() };
  const s = raw.trim();

  // MT5 often: 2026.05.18 17:02:00
  const mt = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (mt) {
    const [, y, mo, d, h, mi] = mt;
    return {
      date: `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`,
      time: `${h.padStart(2, "0")}:${mi}`,
    };
  }

  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) {
    return {
      date: iso.toISOString().slice(0, 10),
      time: iso.toTimeString().slice(0, 5),
    };
  }

  return { date: today(), time: nowTime() };
}

function calculateR(entry: number, sl: number, exit: number, direction: Direction): number {
  const risk = direction === "LONG" ? entry - sl : sl - entry;
  const result = direction === "LONG" ? exit - entry : entry - exit;
  if (risk <= 0) return 0;
  return result / risk;
}

function calculateRR(entry: number, sl: number, tp: number, direction: Direction): number {
  const risk = direction === "LONG" ? entry - sl : sl - entry;
  const reward = direction === "LONG" ? tp - entry : entry - tp;
  if (risk <= 0) return 0;
  return reward / risk;
}

function calculatePnlPct(pnl: number, accountSize: number): number {
  return accountSize > 0 ? (pnl / accountSize) * 100 : 0;
}

function colorForPnL(v: number) {
  if (v > 0) return "text-emerald-600";
  if (v < 0) return "text-rose-600";
  return "text-slate-500";
}

function bgForGrade(grade: Grade) {
  switch (grade) {
    case "A+":
      return "bg-emerald-600 text-white";
    case "A":
      return "bg-emerald-100 text-emerald-800";
    case "B+":
      return "bg-amber-100 text-amber-800";
    case "B":
      return "bg-orange-100 text-orange-800";
    case "C":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-rose-100 text-rose-700";
  }
}

function downloadFile(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((c === "," || c === ";" || c === "\t") && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else if ((c === "\n" || c === "\r") && !inQuotes) {
      if (current.length || row.length) {
        row.push(current.trim());
        rows.push(row);
        row = [];
        current = "";
      }
      if (c === "\r" && next === "\n") i++;
    } else {
      current += c;
    }
  }
  if (current.length || row.length) {
    row.push(current.trim());
    rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = r[i] ?? ""));
    return obj;
  });
}

function pick(row: Record<string, string>, candidates: string[]): string {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const direct = keys.find((k) => k.toLowerCase() === c.toLowerCase());
    if (direct) return row[direct];
  }
  for (const c of candidates) {
    const partial = keys.find((k) => k.toLowerCase().includes(c.toLowerCase()));
    if (partial) return row[partial];
  }
  return "";
}

function inferDirection(raw: string): Direction {
  const s = raw.toLowerCase();
  if (s.includes("sell") || s.includes("short")) return "SHORT";
  return "LONG";
}

function inferSetupFromText(raw: string): SetupType {
  const s = raw.toLowerCase();
  if (s.includes("ssl")) return "SSL sweep → BOS → FVG";
  if (s.includes("bsl")) return "BSL sweep → BOS → FVG";
  if (s.includes("ob")) return "OB retest";
  if (s.includes("fvg")) return "FVG retest";
  return "Manual / Other";
}

function inferSession(time: string): SessionName {
  const [h, m] = time.split(":").map(Number);
  const minutes = h * 60 + (m || 0);
  if (minutes >= 23 * 60 || minutes < 6 * 60) return "Asia";
  if (minutes >= 7 * 60 && minutes <= 13 * 60) return "London";
  if (minutes >= 14 * 60 && minutes < 15 * 60 + 30) return "NY AM";
  if (minutes >= 15 * 60 + 30 && minutes <= 21 * 60) return "NYSE";
  return "Other";
}

function csvRowsToTrades(rows: Record<string, string>[], settings: Settings): Trade[] {
  return rows
    .map((row) => {
      const timeRaw = pick(row, ["Time", "Date", "Open Time", "Close Time", "Čas", "Datum"]);
      const { date, time } = parseDateTime(timeRaw);
      const instrument = pick(row, ["Symbol", "Instrument", "Market", "Pár", "Symbol "]) || "UNKNOWN";
      const type = pick(row, ["Type", "Direction", "Side", "Typ"]);
      const direction = inferDirection(type);
      const entry = n(pick(row, ["Entry", "Open Price", "Price", "Open", "Cena vstupu"]));
      const exit = n(pick(row, ["Exit", "Close Price", "Close", "Price", "Cena výstupu"]), entry);
      const sl = n(pick(row, ["S/L", "SL", "Stop Loss"]));
      const tp = n(pick(row, ["T/P", "TP", "Take Profit"]));
      const lot = n(pick(row, ["Volume", "Lots", "Lot", "Size"]));
      const profit = n(pick(row, ["Profit", "P/L", "PnL", "Net Profit", "Zisk"]));
      const commission = n(pick(row, ["Commission", "Komise"]));
      const swap = n(pick(row, ["Swap"]));
      const pnl = profit + commission + swap;
      const accountSize = settings.accountSize;
      const rMultiple = sl ? calculateR(entry, sl, exit, direction) : 0;
      const rrPlanned = sl && tp ? calculateRR(entry, sl, tp, direction) : 0;
      const comment = pick(row, ["Comment", "Notes", "Poznámka"]);

      return {
        id: uid(),
        date,
        time,
        instrument,
        direction,
        entry,
        sl,
        tp,
        exit,
        lot,
        pnl,
        accountSize,
        pnlPct: calculatePnlPct(pnl, accountSize),
        rMultiple,
        riskUsd: Math.abs(pnl) && Math.abs(rMultiple) > 0 ? Math.abs(pnl / rMultiple) : accountSize * (settings.defaultRiskPct / 100),
        setup: inferSetupFromText(comment),
        grade: "B",
        session: inferSession(time),
        probability: 0,
        stopRisk: 0,
        evR: 0,
        rrPlanned,
        htfBias: "",
        m15Context: "",
        m1Trigger: "",
        newsMode: "Unknown",
        mistake: "Bez chyby",
        emotions: "",
        notes: comment,
        createdAt: new Date().toISOString(),
        source: "csv",
      } as Trade;
    })
    .filter((t) => t.instrument && Number.isFinite(t.pnl));
}

function computeStats(trades: Trade[], settings: Settings) {
  const total = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const be = trades.filter((t) => t.pnl === 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pnl = trades.reduce((s, t) => s + t.pnl, 0);
  const pnlPct = settings.accountSize ? (pnl / settings.accountSize) * 100 : 0;
  const r = trades.reduce((s, t) => s + t.rMultiple, 0);
  const winrate = total ? (wins.length / total) * 100 : 0;
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = total ? r / total : 0;

  let equity = settings.accountSize;
  let peak = equity;
  let maxDd = 0;
  let maxDdPct = 0;
  let currentStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let lastSign = 0;

  const sorted = [...trades].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const curve = sorted.map((t) => {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    maxDd = Math.max(maxDd, dd);
    maxDdPct = Math.max(maxDdPct, ddPct);

    const sign = t.pnl > 0 ? 1 : t.pnl < 0 ? -1 : 0;
    if (sign === 0) {
      currentStreak = 0;
      lastSign = 0;
    } else if (sign === lastSign) {
      currentStreak += sign;
    } else {
      currentStreak = sign;
      lastSign = sign;
    }
    maxWinStreak = Math.max(maxWinStreak, currentStreak > 0 ? currentStreak : 0);
    maxLossStreak = Math.max(maxLossStreak, currentStreak < 0 ? Math.abs(currentStreak) : 0);

    return { date: t.date, time: t.time, equity, pnl: t.pnl };
  });

  const todayTrades = sorted.filter((t) => t.date === today());
  const todayPnl = todayTrades.reduce((s, t) => s + t.pnl, 0);
  const todayLosses = todayTrades.filter((t) => t.pnl < 0).length;

  return {
    total,
    wins: wins.length,
    losses: losses.length,
    be: be.length,
    pnl,
    pnlPct,
    r,
    winrate,
    pf,
    avgWin,
    avgLoss,
    expectancy,
    grossProfit,
    grossLoss,
    maxDd,
    maxDdPct,
    maxWinStreak,
    maxLossStreak,
    curve,
    todayTrades: todayTrades.length,
    todayPnl,
    todayLosses,
  };
}

function groupBy<T extends string>(trades: Trade[], getKey: (t: Trade) => T) {
  const map = new Map<T, Trade[]>();
  trades.forEach((t) => {
    const k = getKey(t);
    map.set(k, [...(map.get(k) || []), t]);
  });
  return [...map.entries()].map(([key, items]) => ({ key, items }));
}

function MiniLineChart({ data }: { data: { equity: number }[] }) {
  const width = 760;
  const height = 180;
  if (!data.length) {
    return <div className="flex h-44 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500">Zatím nejsou data pro equity křivku.</div>;
  }
  const values = data.map((d) => d.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 12;
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = pad + (i / Math.max(values.length - 1, 1)) * (width - pad * 2);
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full rounded-2xl border border-slate-200 bg-white">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" className="text-slate-200" />
      <polyline fill="none" stroke="currentColor" strokeWidth="3" points={points} className="text-blue-600" />
      <text x={pad} y={20} fontSize="12" className="fill-slate-500">Max: {fmt(max, 2)}</text>
      <text x={pad} y={height - 8} fontSize="12" className="fill-slate-500">Min: {fmt(min, 2)}</text>
    </svg>
  );
}

function StatCard({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: "neutral" | "good" | "bad" | "warn" }) {
  const toneClass = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${toneClass}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{children}</span>;
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    } catch {
      return defaultSettings;
    }
  });

  const [trades, setTrades] = useState<Trade[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  });

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [tab, setTab] = useState<"dashboard" | "journal" | "add" | "import" | "settings">("dashboard");
  const [editing, setEditing] = useState<Trade | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  }, [trades]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const instruments = useMemo(() => ["ALL", ...Array.from(new Set(trades.map((t) => t.instrument))).sort()], [trades]);

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      const q = filters.query.trim().toLowerCase();
      if (q) {
        const hay = `${t.instrument} ${t.setup} ${t.grade} ${t.notes} ${t.mistake} ${t.htfBias} ${t.m15Context} ${t.m1Trigger}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.instrument !== "ALL" && t.instrument !== filters.instrument) return false;
      if (filters.direction !== "ALL" && t.direction !== filters.direction) return false;
      if (filters.grade !== "ALL" && t.grade !== filters.grade) return false;
      if (filters.setup !== "ALL" && t.setup !== filters.setup) return false;
      if (filters.session !== "ALL" && t.session !== filters.session) return false;
      if (filters.dateFrom && t.date < filters.dateFrom) return false;
      if (filters.dateTo && t.date > filters.dateTo) return false;
      return true;
    });
  }, [trades, filters]);

  const stats = useMemo(() => computeStats(filteredTrades, settings), [filteredTrades, settings]);
  const allStats = useMemo(() => computeStats(trades, settings), [trades, settings]);

  const riskLocked = allStats.todayPnl <= -(settings.accountSize * settings.maxDailyLossPct) / 100 || allStats.todayTrades >= settings.maxTradesPerDay || allStats.todayLosses >= settings.maxLossesPerDay;
  const riskReason = allStats.todayPnl <= -(settings.accountSize * settings.maxDailyLossPct) / 100
    ? "Denní ztrátový limit"
    : allStats.todayTrades >= settings.maxTradesPerDay
      ? "Max obchodů dnes"
      : allStats.todayLosses >= settings.maxLossesPerDay
        ? "Max ztrát dnes"
        : "OK";

  function upsertTrade(trade: Trade) {
    setTrades((prev) => {
      const exists = prev.some((t) => t.id === trade.id);
      return exists ? prev.map((t) => (t.id === trade.id ? trade : t)) : [trade, ...prev];
    });
    setEditing(null);
    setTab("journal");
  }

  function deleteTrade(id: string) {
    if (!confirm("Opravdu smazat tento trade?")) return;
    setTrades((prev) => prev.filter((t) => t.id !== id));
    if (selectedTrade?.id === id) setSelectedTrade(null);
  }

  function exportJson() {
    downloadFile(`pb-journal-backup-${today()}.json`, JSON.stringify({ settings, trades }, null, 2), "application/json");
  }

  function exportCsv() {
    const headers = [
      "date",
      "time",
      "instrument",
      "direction",
      "entry",
      "sl",
      "tp",
      "exit",
      "lot",
      "pnl",
      "pnlPct",
      "rMultiple",
      "setup",
      "grade",
      "session",
      "probability",
      "stopRisk",
      "evR",
      "rrPlanned",
      "mistake",
      "newsMode",
      "notes",
    ];
    const rows = [headers.join(",")].concat(
      filteredTrades.map((t) =>
        headers
          .map((h) => {
            const value = String(t[h as keyof Trade] ?? "").replace(/"/g, '""');
            return `"${value}"`;
          })
          .join(","),
      ),
    );
    downloadFile(`pb-journal-export-${today()}.csv`, rows.join("\n"), "text/csv");
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (Array.isArray(data.trades)) setTrades(data.trades);
        if (data.settings) setSettings({ ...defaultSettings, ...data.settings });
        alert("Import JSON dokončen.");
      } catch {
        alert("JSON se nepodařilo načíst.");
      }
    };
    reader.readAsText(file);
  }

  function importCsv(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result));
      const imported = csvRowsToTrades(rows, settings);
      setTrades((prev) => [...imported, ...prev]);
      alert(`Importováno ${imported.length} obchodů.`);
    };
    reader.readAsText(file);
  }

  const byInstrument = useMemo(() => groupBy(filteredTrades, (t) => t.instrument), [filteredTrades]);
  const bySetup = useMemo(() => groupBy(filteredTrades, (t) => t.setup), [filteredTrades]);
  const byMistake = useMemo(() => groupBy(filteredTrades, (t) => t.mistake), [filteredTrades]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-lg font-black text-white">PB</div>
              <div>
                <h1 className="text-xl font-black tracking-tight">PB Trading Journal</h1>
                <p className="text-sm text-slate-500">US30 / NAS100 / XAU / FX — journal, risk a výkonnost.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className={riskLocked ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}>
              {riskLocked ? `LOCK: ${riskReason}` : "Risk OK"}
            </Badge>
            <Badge className="bg-slate-100 text-slate-700">Dnes: {fmtMoney(allStats.todayPnl, settings.currency)}</Badge>
            <button onClick={exportJson} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100">Export JSON</button>
            <button onClick={exportCsv} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100">Export CSV</button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 pb-3">
          {[
            ["dashboard", "Dashboard"],
            ["journal", "Obchody"],
            ["add", editing ? "Upravit trade" : "Přidat trade"],
            ["import", "Import"],
            ["settings", "Nastavení"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() =>
                setTab(id as "dashboard" | "journal" | "add" | "import" | "settings")
              }
              className={`rounded-xl px-4 py-2 text-sm font-bold transition ${tab === id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {tab !== "add" && tab !== "settings" && (
          <FiltersPanel filters={filters} setFilters={setFilters} instruments={instruments} />
        )}

        {tab === "dashboard" && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard label="PnL" value={fmtMoney(stats.pnl, settings.currency)} sub={pct(stats.pnlPct)} tone={stats.pnl >= 0 ? "good" : "bad"} />
              <StatCard label="Celkové R" value={`${stats.r >= 0 ? "+" : ""}${fmt(stats.r, 2)}R`} sub={`Expectancy ${fmt(stats.expectancy, 2)}R/trade`} tone={stats.r >= 0 ? "good" : "bad"} />
              <StatCard label="Winrate" value={`${fmt(stats.winrate, 1)} %`} sub={`${stats.wins}W / ${stats.losses}L / ${stats.be}BE`} tone={stats.winrate >= 50 ? "good" : "warn"} />
              <StatCard label="Profit Factor" value={stats.pf === Infinity ? "∞" : fmt(stats.pf, 2)} sub={`Max DD ${fmtMoney(stats.maxDd, settings.currency)} / ${fmt(stats.maxDdPct, 2)} %`} tone={stats.pf >= 1.3 ? "good" : stats.pf >= 1 ? "warn" : "bad"} />
            </div>

            <Section title="Equity křivka">
              <MiniLineChart data={stats.curve} />
            </Section>

            <div className="grid gap-6 lg:grid-cols-3">
              <Breakdown title="Podle instrumentu" groups={byInstrument} settings={settings} />
              <Breakdown title="Podle setupu" groups={bySetup} settings={settings} />
              <Breakdown title="Podle chyby" groups={byMistake} settings={settings} />
            </div>

            <Section title="Risk monitor">
              <div className="grid gap-4 md:grid-cols-4">
                <StatCard label="Obchody dnes" value={`${allStats.todayTrades}/${settings.maxTradesPerDay}`} tone={allStats.todayTrades >= settings.maxTradesPerDay ? "bad" : "neutral"} />
                <StatCard label="Ztráty dnes" value={`${allStats.todayLosses}/${settings.maxLossesPerDay}`} tone={allStats.todayLosses >= settings.maxLossesPerDay ? "bad" : "neutral"} />
                <StatCard label="Denní PnL" value={fmtMoney(allStats.todayPnl, settings.currency)} tone={allStats.todayPnl >= 0 ? "good" : "bad"} />
                <StatCard label="Streaky" value={`${stats.maxWinStreak}W / ${stats.maxLossStreak}L`} sub="max win/loss streak" />
              </div>
            </Section>
          </div>
        )}

        {tab === "journal" && (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <Section
              title={`Obchody (${filteredTrades.length})`}
              right={<button onClick={() => { setEditing(null); setTab("add"); }} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">+ Přidat</button>}
            >
              <TradeTable trades={filteredTrades} settings={settings} onSelect={setSelectedTrade} onEdit={(t) => { setEditing(t); setTab("add"); }} onDelete={deleteTrade} />
            </Section>

            <TradeDetail trade={selectedTrade} settings={settings} onEdit={(t) => { setEditing(t); setTab("add"); }} />
          </div>
        )}

        {tab === "add" && (
          <TradeForm
            trade={editing}
            settings={settings}
            onCancel={() => { setEditing(null); setTab("journal"); }}
            onSave={upsertTrade}
          />
        )}

        {tab === "import" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Import CSV z MT5 / FundedNext">
              <p className="mb-4 text-sm text-slate-600">Nahraj CSV export historie obchodů. Aplikace se pokusí namapovat sloupce jako Time, Symbol, Type, Volume, Price, Profit, Commission, Swap.</p>
              <FileDrop accept=".csv,text/csv" onFile={importCsv} label="Vybrat CSV soubor" />
            </Section>
            <Section title="Import / obnova JSON zálohy">
              <p className="mb-4 text-sm text-slate-600">Použij JSON export z tohoto journalu pro obnovu celé databáze včetně nastavení.</p>
              <FileDrop accept=".json,application/json" onFile={importJson} label="Vybrat JSON zálohu" />
            </Section>
            <Section title="Poznámka k ukládání screenshotů">
              <div className="space-y-3 text-sm text-slate-600">
                <p>Screenshoty se ukládají jako base64 do localStorage. Na desítky screenshotů je to v pohodě, na stovky už může být lepší přidat backend nebo ukládání do Git repozitáře jako samostatné soubory.</p>
                <p>Doporučení: screenshot před vstupem + screenshot po výstupu. Pak se dá zpětně analyzovat, jestli byla chyba ve směru, SL, trpělivosti, news nebo v psychologii.</p>
              </div>
            </Section>
            <Section title="Bezpečnost procesu">
              <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600">
                <li>Po 2 ztrátách konec dne.</li>
                <li>Po denní ztrátě {settings.maxDailyLossPct}% konec dne.</li>
                <li>Risk live max malé procento účtu, dokud nebude journal dlouhodobě pozitivní.</li>
                <li>Nejdřív replay/demo, potom malé live riziko.</li>
              </ul>
            </Section>
          </div>
        )}

        {tab === "settings" && (
          <SettingsPanel settings={settings} setSettings={setSettings} onClear={() => {
            if (confirm("Smazat všechny obchody? Tohle nejde vrátit.")) setTrades([]);
          }} />
        )}
      </main>
    </div>
  );
}

function FiltersPanel({ filters, setFilters, instruments }: { filters: Filters; setFilters: React.Dispatch<React.SetStateAction<Filters>>; instruments: string[] }) {
  return (
    <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-8">
        <Field label="Hledat">
          <input className={inputClass} value={filters.query} onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))} placeholder="poznámka, chyba, setup..." />
        </Field>
        <Field label="Instrument">
          <select className={inputClass} value={filters.instrument} onChange={(e) => setFilters((f) => ({ ...f, instrument: e.target.value }))}>
            {instruments.map((i) => <option key={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="Směr">
          <select className={inputClass} value={filters.direction} onChange={(e) => setFilters((f) => ({ ...f, direction: e.target.value as Filters["direction"] }))}>
            <option>ALL</option><option>LONG</option><option>SHORT</option>
          </select>
        </Field>
        <Field label="Grade">
          <select className={inputClass} value={filters.grade} onChange={(e) => setFilters((f) => ({ ...f, grade: e.target.value as Filters["grade"] }))}>
            <option>ALL</option>{gradeOptions.map((g) => <option key={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Setup">
          <select className={inputClass} value={filters.setup} onChange={(e) => setFilters((f) => ({ ...f, setup: e.target.value as Filters["setup"] }))}>
            <option>ALL</option>{setupOptions.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Session">
          <select className={inputClass} value={filters.session} onChange={(e) => setFilters((f) => ({ ...f, session: e.target.value as Filters["session"] }))}>
            <option>ALL</option>{sessionOptions.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Od">
          <input type="date" className={inputClass} value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
        </Field>
        <Field label="Do">
          <input type="date" className={inputClass} value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100" onClick={() => setFilters(emptyFilters)}>Reset filtrů</button>
      </div>
    </div>
  );
}

function Breakdown({ title, groups, settings }: { title: string; groups: { key: string; items: Trade[] }[]; settings: Settings }) {
  const rows = groups
    .map((g) => ({ key: g.key, stats: computeStats(g.items, settings) }))
    .sort((a, b) => Math.abs(b.stats.pnl) - Math.abs(a.stats.pnl))
    .slice(0, 8);

  return (
    <Section title={title}>
      <div className="space-y-3">
        {rows.length === 0 ? <p className="text-sm text-slate-500">Zatím žádná data.</p> : rows.map((r) => (
          <div key={r.key} className="rounded-2xl bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="truncate text-sm font-bold">{r.key}</div>
              <div className={`text-sm font-bold ${colorForPnL(r.stats.pnl)}`}>{fmtMoney(r.stats.pnl, settings.currency)}</div>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
              <span>{r.stats.total} obchodů</span>
              <span>WR {fmt(r.stats.winrate, 1)} %</span>
              <span>{fmt(r.stats.r, 2)}R</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function TradeTable({ trades, settings, onSelect, onEdit, onDelete }: { trades: Trade[]; settings: Settings; onSelect: (t: Trade) => void; onEdit: (t: Trade) => void; onDelete: (id: string) => void }) {
  const sorted = [...trades].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-3">Datum</th>
            <th>Instrument</th>
            <th>Směr</th>
            <th>Setup</th>
            <th>Grade</th>
            <th>PnL</th>
            <th>%</th>
            <th>R</th>
            <th>WR model</th>
            <th>Chyba</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={11} className="py-10 text-center text-slate-500">Zatím žádné obchody.</td></tr>
          ) : sorted.map((t) => (
            <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="py-3"><button onClick={() => onSelect(t)} className="font-semibold text-blue-600 hover:underline">{t.date} {t.time}</button></td>
              <td className="font-bold">{t.instrument}</td>
              <td><Badge className={t.direction === "LONG" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}>{t.direction}</Badge></td>
              <td className="max-w-[220px] truncate text-slate-600">{t.setup}</td>
              <td><Badge className={bgForGrade(t.grade)}>{t.grade}</Badge></td>
              <td className={`font-bold ${colorForPnL(t.pnl)}`}>{fmtMoney(t.pnl, settings.currency)}</td>
              <td className={colorForPnL(t.pnlPct)}>{pct(t.pnlPct)}</td>
              <td className={colorForPnL(t.rMultiple)}>{fmt(t.rMultiple, 2)}R</td>
              <td>{t.probability ? `${fmt(t.probability, 1)} %` : "—"}</td>
              <td className={t.mistake === "Bez chyby" ? "text-slate-500" : "text-amber-700"}>{t.mistake}</td>
              <td className="text-right">
                <button onClick={() => onEdit(t)} className="mr-2 rounded-lg px-2 py-1 font-semibold text-blue-600 hover:bg-blue-50">Edit</button>
                <button onClick={() => onDelete(t.id)} className="rounded-lg px-2 py-1 font-semibold text-rose-600 hover:bg-rose-50">Smazat</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradeDetail({ trade, settings, onEdit }: { trade: Trade | null; settings: Settings; onEdit: (t: Trade) => void }) {
  if (!trade) {
    return <Section title="Detail tradu"><div className="text-sm text-slate-500">Klikni na obchod v tabulce.</div></Section>;
  }
  return (
    <Section title="Detail tradu" right={<button onClick={() => onEdit(trade)} className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white">Upravit</button>}>
      <div className="space-y-4">
        <div>
          <div className="text-2xl font-black">{trade.instrument} <span className={trade.direction === "LONG" ? "text-emerald-600" : "text-rose-600"}>{trade.direction}</span></div>
          <div className="text-sm text-slate-500">{trade.date} {trade.time} · {trade.session}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Info label="PnL" value={fmtMoney(trade.pnl, settings.currency)} tone={trade.pnl >= 0 ? "good" : "bad"} />
          <Info label="R" value={`${fmt(trade.rMultiple, 2)}R`} tone={trade.rMultiple >= 0 ? "good" : "bad"} />
          <Info label="Entry" value={fmt(trade.entry, 5)} />
          <Info label="Exit" value={fmt(trade.exit, 5)} />
          <Info label="SL" value={fmt(trade.sl, 5)} />
          <Info label="TP" value={fmt(trade.tp, 5)} />
          <Info label="Model P" value={trade.probability ? `${fmt(trade.probability, 1)} %` : "—"} />
          <Info label="Stop-risk" value={trade.stopRisk ? `${fmt(trade.stopRisk, 1)} %` : "—"} />
        </div>
        <div className="rounded-2xl bg-slate-50 p-3 text-sm">
          <div className="font-bold">Setup</div>
          <p className="mt-1 text-slate-600">{trade.setup} · <span className="font-bold">{trade.grade}</span></p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3 text-sm">
          <div className="font-bold">Chyba / poznámky</div>
          <p className="mt-1 text-slate-600">{trade.mistake}</p>
          <p className="mt-2 whitespace-pre-wrap text-slate-600">{trade.notes || "Bez poznámky."}</p>
        </div>
        {trade.screenshot ? <img src={trade.screenshot} alt="screenshot" className="rounded-2xl border border-slate-200" /> : <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Bez screenshotu</div>}
      </div>
    </Section>
  );
}

function Info({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "bad" }) {
  const cls = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : "text-slate-900";
  return <div className="rounded-xl bg-white p-3"><div className="text-xs uppercase text-slate-500">{label}</div><div className={`mt-1 font-bold ${cls}`}>{value}</div></div>;
}

function TradeForm({ trade, settings, onSave, onCancel }: { trade: Trade | null; settings: Settings; onSave: (trade: Trade) => void; onCancel: () => void }) {
  const [form, setForm] = useState<Trade>(() => trade || {
    id: uid(),
    date: today(),
    time: nowTime(),
    instrument: "US30",
    direction: "LONG",
    entry: 0,
    sl: 0,
    tp: 0,
    exit: 0,
    lot: 0,
    pnl: 0,
    accountSize: settings.accountSize,
    pnlPct: 0,
    rMultiple: 0,
    riskUsd: settings.accountSize * (settings.defaultRiskPct / 100),
    setup: "SSL sweep → BOS → FVG",
    grade: "B+",
    session: "NYSE",
    probability: 0,
    stopRisk: 0,
    evR: 0,
    rrPlanned: 0,
    htfBias: "",
    m15Context: "",
    m1Trigger: "",
    newsMode: "Normal",
    mistake: "Bez chyby",
    emotions: "",
    notes: "",
    createdAt: new Date().toISOString(),
    source: "manual",
  });

  const derivedMetrics = useMemo(
    () => ({
      rMultiple: calculateR(form.entry, form.sl, form.exit, form.direction),
      rrPlanned: calculateRR(form.entry, form.sl, form.tp, form.direction),
      pnlPct: calculatePnlPct(form.pnl, form.accountSize),
    }),
    [form.entry, form.sl, form.tp, form.exit, form.direction, form.pnl, form.accountSize],
  );

  function update<K extends keyof Trade>(key: K, value: Trade[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onScreenshot(file: File) {
    const reader = new FileReader();
    reader.onload = () => update("screenshot", String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <Section title={trade ? "Upravit trade" : "Přidat trade"} right={<button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100">Zpět</button>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Datum"><input type="date" className={inputClass} value={form.date} onChange={(e) => update("date", e.target.value)} /></Field>
          <Field label="Čas"><input type="time" className={inputClass} value={form.time} onChange={(e) => update("time", e.target.value)} /></Field>
          <Field label="Instrument"><input className={inputClass} value={form.instrument} onChange={(e) => update("instrument", e.target.value.toUpperCase())} /></Field>
          <Field label="Směr"><select className={inputClass} value={form.direction} onChange={(e) => update("direction", e.target.value as Direction)}><option>LONG</option><option>SHORT</option></select></Field>
          <Field label="Entry"><input type="number" step="any" className={inputClass} value={form.entry} onChange={(e) => update("entry", n(e.target.value))} /></Field>
          <Field label="SL"><input type="number" step="any" className={inputClass} value={form.sl} onChange={(e) => update("sl", n(e.target.value))} /></Field>
          <Field label="TP"><input type="number" step="any" className={inputClass} value={form.tp} onChange={(e) => update("tp", n(e.target.value))} /></Field>
          <Field label="Exit"><input type="number" step="any" className={inputClass} value={form.exit} onChange={(e) => update("exit", n(e.target.value))} /></Field>
          <Field label="Lot"><input type="number" step="any" className={inputClass} value={form.lot} onChange={(e) => update("lot", n(e.target.value))} /></Field>
          <Field label={`PnL ${settings.currency}`}><input type="number" step="any" className={inputClass} value={form.pnl} onChange={(e) => update("pnl", n(e.target.value))} /></Field>
          <Field label="Account size"><input type="number" step="any" className={inputClass} value={form.accountSize} onChange={(e) => update("accountSize", n(e.target.value))} /></Field>
          <Field label="Risk USD"><input type="number" step="any" className={inputClass} value={form.riskUsd} onChange={(e) => update("riskUsd", n(e.target.value))} /></Field>
          <Field label="Setup"><select className={inputClass} value={form.setup} onChange={(e) => update("setup", e.target.value as SetupType)}>{setupOptions.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Grade"><select className={inputClass} value={form.grade} onChange={(e) => update("grade", e.target.value as Grade)}>{gradeOptions.map((g) => <option key={g}>{g}</option>)}</select></Field>
          <Field label="Session"><select className={inputClass} value={form.session} onChange={(e) => update("session", e.target.value as SessionName)}>{sessionOptions.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="P TP před SL %"><input type="number" step="any" className={inputClass} value={form.probability} onChange={(e) => update("probability", clamp(n(e.target.value), 0, 100))} /></Field>
          <Field label="Stop-risk %"><input type="number" step="any" className={inputClass} value={form.stopRisk} onChange={(e) => update("stopRisk", clamp(n(e.target.value), 0, 100))} /></Field>
          <Field label="EV R"><input type="number" step="any" className={inputClass} value={form.evR} onChange={(e) => update("evR", n(e.target.value))} /></Field>
          <Field label="News"><select className={inputClass} value={form.newsMode} onChange={(e) => update("newsMode", e.target.value as NewsMode)}>{newsOptions.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Chyba"><select className={inputClass} value={form.mistake} onChange={(e) => update("mistake", e.target.value as MistakeTag)}>{mistakeOptions.map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Emoce"><input className={inputClass} value={form.emotions} onChange={(e) => update("emotions", e.target.value)} placeholder="strach, FOMO, klid..." /></Field>
          <div className="md:col-span-2 lg:col-span-3">
            <Field label="HTF bias"><input className={inputClass} value={form.htfBias} onChange={(e) => update("htfBias", e.target.value)} placeholder="1H bullish / 15M mixed..." /></Field>
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <Field label="15M kontext"><input className={inputClass} value={form.m15Context} onChange={(e) => update("m15Context", e.target.value)} placeholder="sweep NYH, OB nad cenou..." /></Field>
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <Field label="1M trigger"><input className={inputClass} value={form.m1Trigger} onChange={(e) => update("m1Trigger", e.target.value)} placeholder="BOS close, FVG retest, rejection..." /></Field>
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <Field label="Poznámky"><textarea className={`${inputClass} min-h-32`} value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Co bylo dobře, co špatně, proč vstup, proč exit..." /></Field>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-3xl bg-slate-900 p-5 text-white">
            <div className="text-sm text-slate-300">Výpočet</div>
            <div className={`mt-3 text-3xl font-black ${form.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtMoney(form.pnl, settings.currency)}</div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-slate-400">PnL %</div><div className="font-bold">{pct(derivedMetrics.pnlPct)}</div></div>
              <div><div className="text-slate-400">R</div><div className="font-bold">{fmt(derivedMetrics.rMultiple, 2)}R</div></div>
              <div><div className="text-slate-400">Plán RR</div><div className="font-bold">{fmt(derivedMetrics.rrPlanned, 2)}R</div></div>
              <div><div className="text-slate-400">Grade</div><div className="font-bold">{form.grade}</div></div>
            </div>
          </div>

          <Section title="Screenshot">
            <FileDrop accept="image/*" onFile={onScreenshot} label="Nahrát screenshot" />
            {form.screenshot ? <img src={form.screenshot} alt="preview" className="mt-4 rounded-2xl border border-slate-200" /> : null}
          </Section>

          <div className="flex gap-3">
            <button
              onClick={() => onSave({ ...form, ...derivedMetrics })}
              className="flex-1 rounded-2xl bg-blue-600 px-5 py-3 font-black text-white hover:bg-blue-700"
            >
              Uložit trade
            </button>
            <button onClick={onCancel} className="rounded-2xl border border-slate-300 px-5 py-3 font-bold hover:bg-slate-100">Zrušit</button>
          </div>
        </aside>
      </div>
    </Section>
  );
}

function FileDrop({ accept, onFile, label }: { accept: string; onFile: (file: File) => void; label: string }) {
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center hover:bg-slate-100"
      onClick={() => ref.current?.click()}
    >
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); }} />
      <div className="text-3xl">⬆️</div>
      <div className="mt-2 font-bold">{label}</div>
      <div className="mt-1 text-xs text-slate-500">Klikni nebo přetáhni soubor sem.</div>
    </div>
  );
}

function SettingsPanel({ settings, setSettings, onClear }: { settings: Settings; setSettings: React.Dispatch<React.SetStateAction<Settings>>; onClear: () => void }) {
  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }
  return (
    <Section title="Nastavení journalu">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Field label="Velikost účtu"><input type="number" className={inputClass} value={settings.accountSize} onChange={(e) => update("accountSize", n(e.target.value))} /></Field>
        <Field label="Měna"><input className={inputClass} value={settings.currency} onChange={(e) => update("currency", e.target.value.toUpperCase())} /></Field>
        <Field label="Default risk %"><input type="number" step="any" className={inputClass} value={settings.defaultRiskPct} onChange={(e) => update("defaultRiskPct", n(e.target.value))} /></Field>
        <Field label="Max denní ztráta %"><input type="number" step="any" className={inputClass} value={settings.maxDailyLossPct} onChange={(e) => update("maxDailyLossPct", n(e.target.value))} /></Field>
        <Field label="Max obchodů denně"><input type="number" className={inputClass} value={settings.maxTradesPerDay} onChange={(e) => update("maxTradesPerDay", n(e.target.value))} /></Field>
        <Field label="Max ztrát denně"><input type="number" className={inputClass} value={settings.maxLossesPerDay} onChange={(e) => update("maxLossesPerDay", n(e.target.value))} /></Field>
      </div>
      <div className="mt-6 rounded-3xl border border-rose-200 bg-rose-50 p-5">
        <h3 className="font-black text-rose-800">Danger zone</h3>
        <p className="mt-1 text-sm text-rose-700">Smazání obchodů nejde vrátit. Nejdřív si udělej JSON export.</p>
        <button onClick={onClear} className="mt-4 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700">Smazat všechny obchody</button>
      </div>
    </Section>
  );
}

export default App;
