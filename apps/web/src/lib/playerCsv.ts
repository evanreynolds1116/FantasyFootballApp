import type { NewPlayer } from "./api";

export type CsvParseResult = {
  players: NewPlayer[];
  /** Row-level problems, 1-based line numbers as the person sees them in a spreadsheet. */
  errors: string[];
};

/** Header spellings accepted for each field (compared lower-cased, spaces/underscores/dashes removed). */
const HEADER_ALIASES: Record<keyof Omit<NewPlayer, "custom">, string[]> = {
  name: ["name", "player", "playername", "fullname"],
  position: ["position", "pos"],
  nflTeam: ["team", "nflteam", "nfl", "tm"],
  byeWeek: ["bye", "byeweek"],
  mflId: ["id", "mflid", "playerid"],
};

/** MFL (and some other exports) use these for positions the league's groups call K and DEF. */
const POSITION_ALIASES: Record<string, string> = { PK: "K", DST: "DEF", "D/ST": "DEF", DEF: "DEF", D: "DEF" };

/** Splits CSV text into rows of fields, honoring double-quoted fields (with "" escapes and embedded commas/newlines). */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[\s_-]/g, "");

/** "Allen, Josh" (MFL's format) → "Josh Allen". Team defenses like "Bills, Buffalo" flip the same way, which reads fine. */
export function displayName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  const parts = name.split(",");
  if (parts.length !== 2) return name;
  const [last, first] = parts.map((p) => p.trim());
  return first && last ? `${first} ${last}` : name;
}

export function normalizePosition(raw: string): string {
  const pos = raw.trim().toUpperCase();
  return POSITION_ALIASES[pos] ?? pos;
}

/**
 * Parses a player-pool CSV (FR-04). Needs a header row with at least a name
 * and a position column; NFL team, bye week and MFL id are optional. Bad rows
 * are reported and skipped rather than failing the whole file.
 */
export function parsePlayerCsv(text: string): CsvParseResult {
  const rows = splitCsv(text);
  if (rows.length === 0) return { players: [], errors: ["The file is empty."] };

  const header = rows[0]!.map(normalizeHeader);
  const col = (field: keyof typeof HEADER_ALIASES) => header.findIndex((h) => HEADER_ALIASES[field].includes(h));
  const cols = { name: col("name"), position: col("position"), nflTeam: col("nflTeam"), byeWeek: col("byeWeek"), mflId: col("mflId") };
  if (cols.name < 0 || cols.position < 0) {
    return { players: [], errors: ['The first row needs column headings, including "name" and "position".'] };
  }

  const players: NewPlayer[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((fields, i) => {
    const line = i + 2;
    const get = (c: number) => (c >= 0 ? (fields[c] ?? "").trim() : "");
    const name = displayName(get(cols.name));
    const position = normalizePosition(get(cols.position));
    if (!name || !position) {
      errors.push(`Line ${line}: missing a name or position — skipped.`);
      return;
    }
    const player: NewPlayer = { name, position };
    const nflTeam = get(cols.nflTeam).toUpperCase();
    if (nflTeam) player.nflTeam = nflTeam;
    const mflId = get(cols.mflId);
    if (mflId) player.mflId = mflId;
    const bye = get(cols.byeWeek);
    if (bye) {
      const n = Number(bye);
      if (Number.isInteger(n) && n >= 1 && n <= 18) player.byeWeek = n;
      else errors.push(`Line ${line}: bye week "${bye}" isn't 1–18 — kept the player without it.`);
    }
    players.push(player);
  });
  return { players, errors };
}
