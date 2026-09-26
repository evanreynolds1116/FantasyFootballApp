import { describe, expect, it } from "vitest";
import { displayName, parsePlayerCsv, splitCsv } from "./playerCsv";

describe("splitCsv", () => {
  it("handles quotes, escaped quotes, embedded commas, CRLF and a BOM", () => {
    expect(splitCsv('﻿a,b\r\n"Allen, Josh","say ""hi"""\r\n\r\n')).toEqual([
      ["a", "b"],
      ["Allen, Josh", 'say "hi"'],
    ]);
  });
});

describe("displayName", () => {
  it("flips MFL's Last, First format", () => {
    expect(displayName("Allen, Josh")).toBe("Josh Allen");
    expect(displayName("St. Brown, Amon-Ra")).toBe("Amon-Ra St. Brown");
    expect(displayName("Josh  Allen")).toBe("Josh Allen");
  });
});

describe("parsePlayerCsv", () => {
  it("maps common header spellings and normalizes positions and teams", () => {
    const csv = ["Player,Pos,NFL Team,Bye Week,MFL_ID", '"Allen, Josh",QB,buf,7,13589', "Tucker Justin,PK,BAL,14,", '"Bills, Buffalo",Def,BUF,,0501'].join("\n");
    const { players, errors } = parsePlayerCsv(csv);
    expect(errors).toEqual([]);
    expect(players).toEqual([
      { name: "Josh Allen", position: "QB", nflTeam: "BUF", byeWeek: 7, mflId: "13589" },
      { name: "Tucker Justin", position: "K", nflTeam: "BAL", byeWeek: 14 },
      { name: "Buffalo Bills", position: "DEF", nflTeam: "BUF", mflId: "0501" },
    ]);
  });

  it("only needs name and position columns", () => {
    expect(parsePlayerCsv("name,position\nSam Reed,rb").players).toEqual([{ name: "Sam Reed", position: "RB" }]);
  });

  it("skips bad rows with line numbers and keeps the rest", () => {
    const { players, errors } = parsePlayerCsv("name,position,bye\nGood One,WR,5\n,QB,\nBad Bye,TE,week9");
    expect(players.map((p) => p.name)).toEqual(["Good One", "Bad Bye"]);
    expect(errors).toEqual(["Line 3: missing a name or position — skipped.", 'Line 4: bye week "week9" isn\'t 1–18 — kept the player without it.']);
  });

  it("explains a missing header", () => {
    expect(parsePlayerCsv("Josh Allen,QB").errors[0]).toMatch(/column headings/);
    expect(parsePlayerCsv("").errors[0]).toMatch(/empty/);
  });
});
