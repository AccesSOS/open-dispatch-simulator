import type { ProtocolPack, Protocol, Question } from './types.js';
import { matchTaxonomy } from './coverage.js';
import type { Taxonomy } from './coverage.js';

/**
 * Structural diff of two protocol packs.
 *
 * Deliberately structural, never textual: what a pack asks, what it can decide,
 * and where it can jump — not how closely two packs' wordings resemble each
 * other. Similarity scoring is what we refuse to publish against proprietary
 * systems (docs/PRIVATE-PACKS.md), and a metric that exists gets quoted.
 *
 * Two packs from different jurisdictions share no protocol ids, so cards are
 * aligned by id first and then through a shared complaint taxonomy — the same
 * one the coverage rubrics use.
 */

export interface SetDiff<T = string> {
  onlyA: T[];
  onlyB: T[];
  both: T[];
}

export interface CaseEntryDiff extends SetDiff {
  /** Slots both packs ask, but at a different point in the sequence. */
  reordered: { slot: string; positionA: number; positionB: number }[];
}

export interface ProtocolPairDiff {
  /** How the two cards were lined up. */
  via: 'id' | 'taxonomy';
  taxonomyEntry?: string;
  idA: string;
  idB: string;
  nameA: string;
  nameB: string;
  slots: SetDiff;
  /** Slots the determinants actually branch on — the card's decision surface. */
  decisionSlots: SetDiff;
  responseLevels: SetDiff;
  jumpsOut: SetDiff;
  determinantCount: { a: number; b: number };
  postDispatchSteps: { a: number; b: number };
}

export interface PackDiffResult {
  a: { id: string; name: string; locales: string[]; protocols: number };
  b: { id: string; name: string; locales: string[]; protocols: number };
  locales: SetDiff;
  caseEntry: CaseEntryDiff;
  /** Complaint coverage: which taxonomy entries each pack carries a card for. */
  complaints?: SetDiff & { taxonomy: string };
  /**
   * Each pack's response vocabulary, with how many protocols can produce each
   * level. Level names are jurisdiction-specific and are never auto-mapped:
   * CODE_RED and SIMULTANEOUS_ALS_BLS are different jurisdictions' words, and
   * asserting they mean the same thing is a clinical claim, not a diff.
   */
  responseLevels: {
    a: { level: string; protocols: number }[];
    b: { level: string; protocols: number }[];
    sharedNames: string[];
  };
  protocols: {
    onlyA: string[];
    onlyB: string[];
    matched: ProtocolPairDiff[];
  };
  /** True when nothing structural differs. */
  identical: boolean;
}

export interface DiffOptions {
  /** Shared complaint vocabulary used to align cards across jurisdictions. */
  taxonomy?: { id: string; taxonomy: Taxonomy };
}

const setDiff = <T>(a: Iterable<T>, b: Iterable<T>): SetDiff<T> => {
  // Materialize both sides once: callers pass Map.keys(), and an iterator read
  // twice is empty the second time.
  const A = [...new Set(a)];
  const Bs = [...new Set(b)];
  const As = new Set(A);
  const B = new Set(Bs);
  return {
    onlyA: A.filter((x) => !B.has(x)),
    onlyB: Bs.filter((x) => !As.has(x)),
    both: A.filter((x) => B.has(x)),
  };
};

const isEmpty = (d: SetDiff) => d.onlyA.length === 0 && d.onlyB.length === 0;

const slotsOf = (qs: Question[]) => qs.map((q) => q.slot);

function decisionSlotsOf(p: Protocol): string[] {
  const slots = new Set<string>();
  for (const d of p.determinants) for (const c of d.when ?? []) slots.add(c.slot);
  return [...slots];
}

function jumpsOf(p: Protocol): string[] {
  const out = new Set<string>();
  for (const q of p.keyQuestions) {
    for (const e of q.next ?? []) if (e.gotoProtocol) out.add(e.gotoProtocol);
  }
  return [...out];
}

function pairDiff(
  a: Protocol,
  b: Protocol,
  via: ProtocolPairDiff['via'],
  taxonomyEntry?: string,
): ProtocolPairDiff {
  const pick = (p: Protocol) => Object.values(p.name)[0] ?? p.id;
  return {
    via,
    ...(taxonomyEntry ? { taxonomyEntry } : {}),
    idA: a.id,
    idB: b.id,
    nameA: pick(a),
    nameB: pick(b),
    slots: setDiff(slotsOf(a.keyQuestions), slotsOf(b.keyQuestions)),
    decisionSlots: setDiff(decisionSlotsOf(a), decisionSlotsOf(b)),
    responseLevels: setDiff(
      a.determinants.map((d) => d.response),
      b.determinants.map((d) => d.response),
    ),
    jumpsOut: setDiff(jumpsOf(a), jumpsOf(b)),
    determinantCount: { a: a.determinants.length, b: b.determinants.length },
    postDispatchSteps: { a: a.postDispatch.length, b: b.postDispatch.length },
  };
}

function levelCensus(pack: ProtocolPack) {
  const counts = new Map<string, number>();
  for (const p of pack.protocols) {
    for (const level of new Set(p.determinants.map((d) => d.response))) {
      counts.set(level, (counts.get(level) ?? 0) + 1);
    }
  }
  return [...counts].map(([level, protocols]) => ({ level, protocols }));
}

export function diffPacks(a: ProtocolPack, b: ProtocolPack, opts: DiffOptions = {}): PackDiffResult {
  const posA = new Map(a.caseEntry.map((q, i) => [q.slot, i]));
  const posB = new Map(b.caseEntry.map((q, i) => [q.slot, i]));
  const caseEntrySets = setDiff(posA.keys(), posB.keys());
  const caseEntry: CaseEntryDiff = {
    ...caseEntrySets,
    reordered: caseEntrySets.both
      .filter((slot) => posA.get(slot) !== posB.get(slot))
      .map((slot) => ({ slot, positionA: posA.get(slot)! + 1, positionB: posB.get(slot)! + 1 })),
  };

  const byIdA = new Map(a.protocols.map((p) => [p.id, p]));
  const byIdB = new Map(b.protocols.map((p) => [p.id, p]));
  const matched: ProtocolPairDiff[] = [];
  const usedA = new Set<string>();
  const usedB = new Set<string>();

  for (const p of a.protocols) {
    const other = byIdB.get(p.id);
    if (other) {
      matched.push(pairDiff(p, other, 'id'));
      usedA.add(p.id);
      usedB.add(other.id);
    }
  }

  let complaints: PackDiffResult['complaints'];
  if (opts.taxonomy) {
    const { id, taxonomy } = opts.taxonomy;
    const ma = matchTaxonomy(a, taxonomy);
    const mb = matchTaxonomy(b, taxonomy);
    complaints = { taxonomy: id, ...setDiff(ma.covered.keys(), mb.covered.keys()) };
    for (const entry of complaints.both) {
      const ida = ma.covered.get(entry)!;
      const idb = mb.covered.get(entry)!;
      if (usedA.has(ida) || usedB.has(idb)) continue;
      matched.push(pairDiff(byIdA.get(ida)!, byIdB.get(idb)!, 'taxonomy', entry));
      usedA.add(ida);
      usedB.add(idb);
    }
  }

  const result: PackDiffResult = {
    a: { id: a.id, name: Object.values(a.name)[0] ?? a.id, locales: a.locales, protocols: a.protocols.length },
    b: { id: b.id, name: Object.values(b.name)[0] ?? b.id, locales: b.locales, protocols: b.protocols.length },
    locales: setDiff(a.locales, b.locales),
    caseEntry,
    ...(complaints ? { complaints } : {}),
    responseLevels: {
      a: levelCensus(a),
      b: levelCensus(b),
      sharedNames: setDiff(
        a.protocols.flatMap((p) => p.determinants.map((d) => d.response)),
        b.protocols.flatMap((p) => p.determinants.map((d) => d.response)),
      ).both,
    },
    protocols: {
      onlyA: a.protocols.filter((p) => !usedA.has(p.id)).map((p) => p.id),
      onlyB: b.protocols.filter((p) => !usedB.has(p.id)).map((p) => p.id),
      matched,
    },
    identical: false,
  };

  result.identical =
    isEmpty(result.locales) &&
    isEmpty(caseEntry) &&
    caseEntry.reordered.length === 0 &&
    result.protocols.onlyA.length === 0 &&
    result.protocols.onlyB.length === 0 &&
    matched.every(
      (m) =>
        isEmpty(m.slots) &&
        isEmpty(m.decisionSlots) &&
        isEmpty(m.responseLevels) &&
        isEmpty(m.jumpsOut) &&
        m.determinantCount.a === m.determinantCount.b &&
        m.postDispatchSteps.a === m.postDispatchSteps.b,
    );

  return result;
}
