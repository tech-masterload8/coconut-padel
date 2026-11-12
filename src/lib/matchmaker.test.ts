import { describe, expect, it } from "vitest";
import {
  generateMexicanoRound,
  generateRound,
  previewUpcomingRounds,
  roundToActivate,
  roundsAheadOfPlay,
  scheduledTailCeiling,
  shouldHoldForFullRound,
  statusesForBatch,
  type PastMatch,
} from "./matchmaker";
import {
  computeStandings,
  isScoreTarget,
  isValidMatchScore,
  parsePointAdjustment,
  sanitizePointDraft,
  scoreLabel,
  toScoreSystem,
} from "./scoring";

describe("tennis point", () => {
  it("total: kedua skor harus berjumlah sama dengan total game", () => {
    expect(isValidMatchScore(3, 2, "tennis_total", 5)).toBe(true);
    expect(isValidMatchScore(5, 0, "tennis_total", 5)).toBe(true);
    expect(isValidMatchScore(2, 2, "tennis_total", 4)).toBe(true);
    expect(isValidMatchScore(3, 3, "tennis_total", 5)).toBe(false);
    expect(isValidMatchScore(6, -1, "tennis_total", 5)).toBe(false);
  });

  it("race: pemenang tepat di target dan lawannya di bawah target", () => {
    expect(isValidMatchScore(4, 0, "tennis_race", 4)).toBe(true);
    expect(isValidMatchScore(3, 4, "tennis_race", 4)).toBe(true);
    expect(isValidMatchScore(4, 4, "tennis_race", 4)).toBe(false);
    expect(isValidMatchScore(3, 2, "tennis_race", 4)).toBe(false);
    expect(isValidMatchScore(5, 2, "tennis_race", 4)).toBe(false);
  });

  it("hanya menerima pilihan yang ditawarkan", () => {
    expect(isScoreTarget("tennis_total", 5)).toBe(true);
    expect(isScoreTarget("tennis_total", 2)).toBe(false);
    expect(isScoreTarget("tennis_race", 6)).toBe(true);
    expect(isScoreTarget("tennis_race", 7)).toBe(false);
    expect(isScoreTarget("points", 5)).toBe(false);
  });

  it("turnamen lama tanpa sistem poin dibaca sebagai poin Americano", () => {
    expect(toScoreSystem("")).toBe("points");
    expect(scoreLabel("points", 24)).toBe("24 poin");
    expect(scoreLabel("tennis_total", 5)).toBe("Tennis · total 5");
    expect(scoreLabel("tennis_race", 4)).toBe("Tennis · race to 4");
  });
});

describe("mexicano", () => {
  const roster = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, present: true }));
  const ranksInOrder = (count: number) =>
    new Map(Array.from({ length: count }, (_, index) => [`p${index + 1}`, index + 1] as const));

  it("mengisi lapangan urut klasemen, 1 & 4 lawan 2 & 3", () => {
    const round = generateMexicanoRound({
      players: roster(8),
      courtCount: 2,
      pastMatches: [],
      ranks: ranksInOrder(8),
      roundNumber: 2,
    });

    expect(round.matches).toEqual([
      { court: 1, teamA: ["p1", "p4"], teamB: ["p2", "p3"] },
      { court: 2, teamA: ["p5", "p8"], teamB: ["p6", "p7"] },
    ]);
    expect(round.sittingOut).toEqual([]);
  });

  it("yang paling sedikit main didahulukan, sisanya duduk", () => {
    const pastMatches: PastMatch[] = [{ teamA: ["p1", "p2"], teamB: ["p3", "p4"] }];
    const round = generateMexicanoRound({
      players: roster(5),
      courtCount: 1,
      pastMatches,
      ranks: ranksInOrder(5),
      roundNumber: 2,
    });

    const playing = round.matches.flatMap((match) => [...match.teamA, ...match.teamB]);
    expect(playing).toContain("p5");
    expect(round.sittingOut).toHaveLength(1);
    expect(round.sittingOut[0]).not.toBe("p5");
  });

  it("ronde pertama tetap terisi walau semua peringkat sama", () => {
    const round = generateMexicanoRound({
      players: roster(9),
      courtCount: 2,
      pastMatches: [],
      ranks: new Map(),
      roundNumber: 1,
    });

    const playing = round.matches.flatMap((match) => [...match.teamA, ...match.teamB]);
    expect(round.matches).toHaveLength(2);
    expect(new Set(playing).size).toBe(8);
    expect(round.sittingOut).toHaveLength(1);
  });
});

describe("americano scoring", () => {
  it("menerima skor yang jumlahnya sama dengan poin pertandingan", () => {
    expect(isValidMatchScore(16, 8, "points", 24)).toBe(true);
    expect(isValidMatchScore(12, 12, "points", 24)).toBe(true);
    expect(isValidMatchScore(17, 8, "points", 24)).toBe(false);
  });

  it("membagi poin tim ke setiap pemain lalu merangking seperti PDLUP", () => {
    const standings = computeStandings(
      ["a", "b", "c", "d"],
      [
        { teamA: ["a", "b"], teamB: ["c", "d"], teamAScore: 16, teamBScore: 8 },
        { teamA: ["a", "c"], teamB: ["b", "d"], teamAScore: 10, teamBScore: 14 },
      ],
    );

    expect(standings[0].playerId).toBe("b");
    expect(standings.find((row) => row.playerId === "a")?.points).toBe(26);
    expect(standings.find((row) => row.playerId === "b")?.points).toBe(30);
    expect(standings.find((row) => row.playerId === "c")?.points).toBe(18);
    expect(standings.find((row) => row.playerId === "d")?.points).toBe(22);
  });

  it("menerima poin penyesuaian minus", () => {
    expect(sanitizePointDraft("−4")).toBe("-4");
    expect(sanitizePointDraft("-4")).toBe("-4");
    expect(parsePointAdjustment("-4")).toBe(-4);
    expect(parsePointAdjustment("−8")).toBe(-8);
    expect(parsePointAdjustment("-")).toBeNull();
    expect(parsePointAdjustment("")).toBe(0);
  });

  it("menambahkan poin penyesuaian ke total klasemen", () => {
    const standings = computeStandings(
      ["a", "b"],
      [{ teamA: ["a", "b"], teamB: ["c", "d"], teamAScore: 16, teamBScore: 8 }],
      { a: -4, b: 8 },
    );

    expect(standings.find((row) => row.playerId === "a")?.points).toBe(12);
    expect(standings.find((row) => row.playerId === "b")?.points).toBe(24);
    expect(standings[0].playerId).toBe("b");
  });
});

describe("ronde penuh", () => {
  it("menahan match baru selama masih ada lapangan yang main", () => {
    expect(shouldHoldForFullRound("full", 1)).toBe(true);
    expect(shouldHoldForFullRound("full", 0)).toBe(false);
    expect(shouldHoldForFullRound("continuous", 2)).toBe(false);
  });

  it("memutar yang duduk begitu semua lapangan selesai, untuk 9 pemain di 2 lapangan", () => {
    const players = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, present: true }));
    const first = generateRound({
      players,
      courtCount: 2,
      pastMatches: [],
      roundNumber: 1,
    });
    expect(first.matches).toHaveLength(2);
    expect(first.sittingOut).toHaveLength(1);

    const sat = first.sittingOut[0];
    const second = generateRound({
      players,
      courtCount: 2,
      pastMatches: first.matches.map((match) => ({ teamA: match.teamA, teamB: match.teamB })),
      roundNumber: 2,
    });
    const playing = second.matches.flatMap((match) => [...match.teamA, ...match.teamB]);
    expect(playing).toContain(sat);
    expect(second.sittingOut).not.toContain(sat);
  });

  it("menampilkan 20 ronde ke depan dan tetap menggilir pemain yang duduk", () => {
    const players = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, present: true }));
    const first = generateRound({
      players,
      courtCount: 2,
      pastMatches: [],
      roundNumber: 1,
    });
    const upcoming = previewUpcomingRounds({
      players,
      courtCount: 2,
      pastMatches: first.matches.map((match) => ({ teamA: match.teamA, teamB: match.teamB })),
      nextRoundNumber: 2,
    });

    expect(upcoming).toHaveLength(20);
    expect(upcoming[0].roundNumber).toBe(2);
    expect(upcoming[19].roundNumber).toBe(21);
    expect(upcoming[0].matches).toHaveLength(2);
    const playingNext = upcoming[0].matches.flatMap((match) => [...match.teamA, ...match.teamB]);
    expect(playingNext).toContain(first.sittingOut[0]);

    const sitters = [first.sittingOut[0], ...upcoming.slice(0, 8).map((round) => round.sittingOut[0])];
    expect(new Set(sitters).size).toBe(sitters.length);
  });

  it("menjaga 20 ronde setelah ronde yang sedang dimainkan", () => {
    expect(roundsAheadOfPlay([])).toBe(21);
    expect(
      roundsAheadOfPlay([
        { roundNumber: 1, status: "pending" },
        { roundNumber: 8, status: "scheduled" },
      ]),
    ).toBe(13);
    expect(
      roundsAheadOfPlay([
        { roundNumber: 1, status: "completed" },
        { roundNumber: 2, status: "scheduled" },
        { roundNumber: 8, status: "scheduled" },
      ]),
    ).toBe(14);
    expect(roundsAheadOfPlay([{ roundNumber: 8, status: "completed" }])).toBe(21);
    expect(
      roundsAheadOfPlay([
        { roundNumber: 6, status: "pending" },
        { roundNumber: 26, status: "scheduled" },
      ]),
    ).toBe(0);
  });

  it("menahan ronde terjadwal sampai ronde yang sedang main selesai", () => {
    const matches = [
      { roundNumber: 1, status: "pending" },
      { roundNumber: 2, status: "scheduled" },
      { roundNumber: 3, status: "scheduled" },
    ];
    expect(roundToActivate(matches)).toBeNull();
    expect(scheduledTailCeiling(matches)).toBe(1);
    expect(statusesForBatch(3, true)).toEqual(["scheduled", "scheduled", "scheduled"]);
  });

  it("mengaktifkan ronde terjadwal paling awal setelah tidak ada yang main", () => {
    const matches = [
      { roundNumber: 1, status: "completed" },
      { roundNumber: 2, status: "scheduled" },
      { roundNumber: 4, status: "scheduled" },
    ];
    expect(roundToActivate(matches)).toBe(2);
    expect(scheduledTailCeiling(matches)).toBe(1);
    expect(statusesForBatch(3, false)).toEqual(["pending", "scheduled", "scheduled"]);
  });
});

describe("americano matchmaker", () => {
  it("mengisi beberapa lapangan sekaligus", () => {
    const round = generateRound({
      players: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, present: true })),
      courtCount: 2,
      pastMatches: [],
      roundNumber: 1,
    });
    expect(round.matches).toHaveLength(2);
    expect(round.sittingOut).toHaveLength(0);
  });

  it("mendudukkan pemain jika jumlahnya tidak kelipatan 4", () => {
    const round = generateRound({
      players: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, present: true })),
      courtCount: 1,
      pastMatches: [],
      roundNumber: 1,
    });
    expect(round.matches).toHaveLength(1);
    expect(round.sittingOut).toHaveLength(1);
  });

  it("mengutamakan pemain telat yang belum main", () => {
    const first = generateRound({
      players: [
        { id: "hadir-1", present: true },
        { id: "hadir-2", present: true },
        { id: "hadir-3", present: true },
        { id: "hadir-4", present: true },
        { id: "telat", present: false },
      ],
      courtCount: 1,
      pastMatches: [],
      roundNumber: 1,
    });

    const next = generateRound({
      players: [
        { id: "hadir-1", present: true },
        { id: "hadir-2", present: true },
        { id: "hadir-3", present: true },
        { id: "hadir-4", present: true },
        { id: "telat", present: true },
      ],
      courtCount: 1,
      pastMatches: first.matches.map((match) => ({
        teamA: match.teamA,
        teamB: match.teamB,
      })),
      roundNumber: 2,
    });

    const playing = [
      ...next.matches[0].teamA,
      ...next.matches[0].teamB,
    ];
    expect(playing).toContain("telat");
    expect(next.sittingOut).not.toContain("telat");
  });

  it("menyebar repeat pairing rata saat pemain sedikit dan ronde banyak", () => {
    const players = ["a", "b", "c", "d"].map((id) => ({ id, present: true }));
    const past: PastMatch[] = [];
    const pairCounts = new Map<string, number>();

    for (let round = 1; round <= 6; round += 1) {
      const generated = generateRound({
        players,
        courtCount: 1,
        pastMatches: past,
        roundNumber: round,
      });
      const match = generated.matches[0];
      past.push({ teamA: match.teamA, teamB: match.teamB });
      for (const team of [match.teamA, match.teamB]) {
        const key = [...team].sort().join("-");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }

    // 4 pemain punya 6 kemungkinan pasangan; setelah 6 ronde semua harus
    // terpakai tepat 2 kali — tidak ada pasangan yang diulang berlebihan.
    expect(pairCounts.size).toBe(6);
    for (const count of pairCounts.values()) {
      expect(count).toBe(2);
    }
  });

  it("memilih pasangan yang paling jarang dipasangkan", () => {
    const past: PastMatch[] = [
      { teamA: ["a", "b"], teamB: ["c", "d"] },
      { teamA: ["a", "b"], teamB: ["c", "d"] },
      { teamA: ["a", "c"], teamB: ["b", "d"] },
    ];
    const next = generateRound({
      players: ["a", "b", "c", "d"].map((id) => ({ id, present: true })),
      courtCount: 1,
      pastMatches: past,
      roundNumber: 4,
    });
    const teams = [next.matches[0].teamA, next.matches[0].teamB].map((team) =>
      [...team].sort().join("-"),
    );
    // a-d dan b-c belum pernah sepasangan, jadi harus dipilih.
    expect(teams).toContain("a-d");
    expect(teams).toContain("b-c");
  });

  it("tidak mengulang partner hanya karena lawannya sudah sering ketemu", () => {
    const past: PastMatch[] = [{ teamA: ["a", "c"], teamB: ["b", "d"] }];
    for (let index = 0; index < 2; index += 1) {
      past.push({ teamA: ["a", "x"], teamB: ["c", "y"] });
      past.push({ teamA: ["b", "x"], teamB: ["d", "y"] });
    }

    const next = generateRound({
      players: ["a", "b", "c", "d"].map((id) => ({ id, present: true })),
      courtCount: 1,
      pastMatches: past,
      roundNumber: 4,
    });
    const teams = [next.matches[0].teamA, next.matches[0].teamB].map((team) =>
      [...team].sort().join("-"),
    );
    // a-c dan b-d sudah sering jadi lawan, tapi mereka belum separtner
    // dengan yang lain. Partner baru tetap didahulukan.
    expect(teams).not.toContain("a-c");
    expect(teams).not.toContain("b-d");
    expect(teams).toHaveLength(2);
  });

  it("17 pemain di 2 lapangan belum mengulang pasangan atau lawan pada 9 pertandingan pertama", () => {
    const ids = Array.from({ length: 17 }, (_, index) => `p${index + 1}`);
    const past: PastMatch[] = [];
    const active: Array<PastMatch | null> = [null, null];
    let seq = 0;
    const started: Array<{ match: PastMatch; seq: number }> = [];
    const partner = new Map<string, number>();
    const opponent = new Map<string, number>();
    const together = new Map<string, number>();
    const key = (a: string, b: string) => [a, b].sort().join("-");
    const bump = (map: Map<string, number>, a: string, b: string) => map.set(key(a, b), (map.get(key(a, b)) ?? 0) + 1);

    for (let tick = 0; started.length < 9 && tick < 80; tick += 1) {
      const busy = new Set(active.filter((match) => match).flatMap((match) => [...match!.teamA, ...match!.teamB]));
      const free = ids.filter((id) => !busy.has(id));
      const empty = active.flatMap((match, index) => (match ? [] : [index]));
      if (empty.length > 0 && free.length >= 4) {
        const generated = generateRound({
          players: free.map((id) => ({ id, present: true })),
          courtCount: empty.length,
          pastMatches: [...past, ...active.filter((match): match is PastMatch => match !== null)],
          roundNumber: tick + 1,
        });
        generated.matches.forEach((match, index) => {
          const stored = { teamA: match.teamA, teamB: match.teamB };
          active[empty[index]] = stored;
          started.push({ match: stored, seq: seq += 1 });
          bump(partner, match.teamA[0], match.teamA[1]);
          bump(partner, match.teamB[0], match.teamB[1]);
          for (const a of match.teamA) for (const b of match.teamB) bump(opponent, a, b);
          const four = [...match.teamA, ...match.teamB];
          for (let left = 0; left < four.length; left += 1) {
            for (let right = left + 1; right < four.length; right += 1) bump(together, four[left], four[right]);
          }
        });
      } else {
        const playing = active.map((match, index) => ({ match, index })).filter((slot) => slot.match);
        const oldest = started.filter((item) => active.includes(item.match)).sort((a, b) => a.seq - b.seq)[0];
        if (!oldest || playing.length === 0) break;
        const court = active.indexOf(oldest.match);
        past.push(oldest.match);
        active[court] = null;
      }
    }

    expect(Math.max(...partner.values())).toBe(1);
    expect(Math.max(...opponent.values())).toBe(1);
    expect(Math.max(...together.values())).toBe(1);
  });

  it("mendudukkan pemain yang sudah separtner, bukan yang masih membuka pasangan baru", () => {
    const past: PastMatch[] = [
      { teamA: ["a", "b"], teamB: ["c", "d"] },
      { teamA: ["a", "c"], teamB: ["b", "d"] },
      { teamA: ["a", "d"], teamB: ["b", "c"] },
      { teamA: ["e", "x"], teamB: ["y", "z"] },
      { teamA: ["e", "y"], teamB: ["x", "z"] },
      { teamA: ["e", "z"], teamB: ["x", "y"] },
    ];
    const next = generateRound({
      players: ["a", "b", "c", "d", "e"].map((id) => ({ id, present: true })),
      courtCount: 1,
      pastMatches: past,
      roundNumber: 7,
    });
    const playing = [...next.matches[0].teamA, ...next.matches[0].teamB];
    expect(playing).toContain("e");
    expect(next.sittingOut).not.toContain("e");
  });
});
