/**
 * Replay validation — observable-behavior study (docs/REPLAY.md).
 *
 * A case file records what a real dispatcher asked and told a caller, as
 * behavior codes, plus the facts the caller gave (placeholdered, keyed by the
 * same codes). The harness feeds those facts to the deterministic engine —
 * "I don't know" for anything the call never covered, never an invented
 * answer — and compares the engine's behavior with the human's.
 *
 * Everything this module reports is an aggregate over a set of case files.
 * Nothing here formats a per-call row, and nothing here is ever trained on.
 * The case files themselves live outside the repository (replay-private/).
 */

import { DispatchSession } from './engine.js';
import { lexiconFor } from './lexicon.js';
import type { Locale, ProtocolPack, SessionEvent } from './types.js';

// --- the behavior-code taxonomy (docs/REPLAY.md) ---

export const CORE_QUESTION_CODES = [
  'Q.location',
  'Q.callback',
  'Q.what_happened',
  'Q.num_patients',
  'Q.age',
  'Q.sex',
  'Q.conscious',
  'Q.breathing',
  'Q.breathing_quality',
  'Q.with_patient',
  'Q.scene_safety',
  'Q.history',
  'Q.caller_name',
] as const;

export const INSTRUCTION_CODES = [
  'I.help_on_way',
  'I.stay_on_line',
  'I.cpr_compressions',
  'I.cpr_breaths',
  'I.aed',
  'I.choking_maneuver',
  'I.positioning',
  'I.bleeding_pressure',
  'I.airway_clear',
  'I.unlock_door',
  'I.gather_meds',
  'I.dont_move',
  'I.keep_warm',
  'I.watch_and_report',
  'I.leave_for_safety',
] as const;

const SLUG = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export const isQuestionCode = (code: string): boolean =>
  (CORE_QUESTION_CODES as readonly string[]).includes(code) ||
  (code.startsWith('Q.kq:') && SLUG.test(code.slice(5)));

export const isInstructionCode = (code: string): boolean =>
  (INSTRUCTION_CODES as readonly string[]).includes(code) ||
  (code.startsWith('I.childbirth:') && SLUG.test(code.slice(13))) ||
  (code.startsWith('I.other:') && SLUG.test(code.slice(8)));

export const isCoreQuestion = (code: string): boolean =>
  (CORE_QUESTION_CODES as readonly string[]).includes(code);

// --- placeholders and the identifier scan ---

export const PLACEHOLDER_LOCATION = '12 Pine St';
export const PLACEHOLDER_CALLBACK = '555-0100';

/**
 * Tokens that may appear capitalized in a fact or note. Everything else must
 * be lowercase — a capitalized word is treated as a possible personal name or
 * place name, and the file is rejected. Brand names are written lowercase.
 */
const CAPITALIZED_ALLOWLIST = new Set([
  'i', "i'm", "i'd", "i'll", "i've", 'pine', 'st', 'cpr', 'aed', 'ems', 'emt', 'er', 'icu',
  'ok', 'dnr', 'copd', 'tv', 'iv', 'ekg', 'ecg', 'co', 'cad', 'psap', 'epipen', 'epi-pen',
]);

const STREET_TYPES =
  'st|street|ave|avenue|av|rd|road|ln|lane|dr|drive|blvd|boulevard|ct|court|pl|place|way|ter|terrace|' +
  'hwy|highway|rte|route|cir|circle|pkwy|parkway|trail|alley|square|crescent|close|' +
  'calle|avenida|calzada|carretera|camino|rue|chemin|impasse|allée|allee';

/**
 * Scan one string for anything that looks identifying. Returns reasons, empty
 * when clean. Deliberately strict: a false positive costs a coder a minute; a
 * false negative puts a real person's details in a file.
 */
export function scanForIdentifiers(text: string): string[] {
  const reasons: string[] = [];
  const lower = text.toLowerCase();
  const withoutPlaceholders = lower
    .split(PLACEHOLDER_LOCATION.toLowerCase())
    .join(' ')
    .split(PLACEHOLDER_CALLBACK)
    .join(' ');

  if (/\d{5,}/.test(withoutPlaceholders.replace(/[\s().-]/g, ''))) {
    // Phone numbers, zip codes and house numbers all have five or more digits;
    // no age, count or duration does.
    reasons.push('phone-like or long digit sequence');
  } else if (/\d{3}[\s.-]\d{4}/.test(withoutPlaceholders) || /\(\d{3}\)/.test(withoutPlaceholders)) {
    reasons.push('phone-like digit pattern');
  }
  const streetWithNumber = new RegExp(`\\b\\d+\\s+\\p{L}+(?:\\s+\\p{L}+)?\\s+(?:${STREET_TYPES})\\b`, 'u');
  const streetNamed = new RegExp(`\\b\\p{L}+\\s+(?:street|avenue|road|boulevard|drive|lane|court|highway|parkway|calle|avenida|rue)\\b`, 'u');
  if (streetWithNumber.test(withoutPlaceholders) || streetNamed.test(withoutPlaceholders)) {
    reasons.push(`street name other than the placeholder "${PLACEHOLDER_LOCATION}"`);
  }
  if (/\b(?:my name is|my name's|this is|i am|i'm|named|call me|mr|mrs|ms|dr|miss)\s+\p{Lu}/u.test(text)) {
    reasons.push('personal-name phrase');
  }
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text) || /https?:\/\//i.test(text) || /\bwww\./i.test(text)) {
    reasons.push('email address or URL');
  }
  for (const token of text.split(/\s+/)) {
    const m = /^[^\p{L}]*(\p{Lu}[\p{L}'’-]*)/u.exec(token);
    if (!m?.[1]) continue;
    if (CAPITALIZED_ALLOWLIST.has(m[1].toLowerCase())) continue;
    reasons.push(`capitalized word "${m[1]}" — possible name; write facts in lowercase`);
    break;
  }
  return reasons;
}

// --- case files ---

export interface ReplayObserved {
  questions: string[];
  instructions: string[];
  /** Questions asked before help was first announced; `null` when the dispatcher never announced help. */
  dispatchAfterQuestion: number | null;
  notes?: string;
}

export interface ReplayCase {
  source: string;
  sourceId: string | number;
  coder: string;
  codedOn: string;
  pack: string;
  impliedProtocol: string;
  facts: Record<string, string>;
  observed: ReplayObserved;
}

export interface CaseValidationContext {
  /** Known packs and their protocol ids; when given, `pack` and `impliedProtocol` are checked. */
  packs?: Record<string, string[]>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate a case file: shape, code vocabulary, placeholders, the identifier
 * scan, and the sanity rules (an observed question implies a fact for it,
 * even if that fact is "unknown"). Returns the reasons it fails; an empty
 * list means the file is usable.
 */
export function validateCase(data: unknown, ctx: CaseValidationContext = {}): string[] {
  const errors: string[] = [];
  if (!isRecord(data)) return ['case file is not a JSON object'];
  for (const key of ['source', 'coder', 'codedOn', 'pack', 'impliedProtocol'] as const) {
    if (typeof data[key] !== 'string' || !(data[key] as string).length) errors.push(`"${key}" must be a non-empty string`);
  }
  if (typeof data.sourceId !== 'string' && typeof data.sourceId !== 'number') errors.push('"sourceId" must be a string or number');
  if (typeof data.codedOn === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(data.codedOn)) errors.push('"codedOn" must be YYYY-MM-DD');

  const packs = ctx.packs;
  if (packs && typeof data.pack === 'string' && !(data.pack in packs)) errors.push(`unknown pack "${data.pack}"`);
  if (
    packs &&
    typeof data.pack === 'string' &&
    typeof data.impliedProtocol === 'string' &&
    data.impliedProtocol !== 'unknown' &&
    packs[data.pack] &&
    !packs[data.pack]!.includes(data.impliedProtocol)
  ) {
    errors.push(`"impliedProtocol" "${data.impliedProtocol}" is not a protocol of ${data.pack} (use "unknown" if unsure)`);
  }

  const facts = data.facts;
  if (!isRecord(facts)) {
    errors.push('"facts" must be an object keyed by question code');
  } else {
    for (const [code, value] of Object.entries(facts)) {
      if (!isQuestionCode(code)) errors.push(`fact key "${code}" is not a question code`);
      if (typeof value !== 'string' || !value.trim().length) {
        errors.push(`fact "${code}" must be a non-empty string`);
        continue;
      }
      if (code === 'Q.location' && value !== PLACEHOLDER_LOCATION) {
        errors.push(`Q.location must be the placeholder "${PLACEHOLDER_LOCATION}"`);
      }
      if (code === 'Q.callback' && value !== PLACEHOLDER_CALLBACK) {
        errors.push(`Q.callback must be the placeholder "${PLACEHOLDER_CALLBACK}"`);
      }
      if (code === 'Q.caller_name' && value.toLowerCase() !== 'unknown' && value !== 'given') {
        errors.push('Q.caller_name must be "given" or "unknown" — never the name itself');
      }
      for (const reason of scanForIdentifiers(value)) errors.push(`fact "${code}": ${reason}`);
    }
  }

  const observed = data.observed;
  if (!isRecord(observed)) {
    errors.push('"observed" must be an object');
    return errors;
  }
  const questions = observed.questions;
  const instructions = observed.instructions;
  if (!Array.isArray(questions) || !questions.every((q) => typeof q === 'string')) {
    errors.push('"observed.questions" must be an array of codes');
  } else {
    for (const q of questions as string[]) {
      if (!isQuestionCode(q)) errors.push(`observed question "${q}" is not a question code`);
      else if (isRecord(facts) && !(q in facts)) {
        errors.push(`observed ${q} has no fact — record the caller's answer, or "unknown"`);
      }
    }
    if (new Set(questions).size !== questions.length) errors.push('observed.questions repeats a code (code a question once)');
  }
  if (!Array.isArray(instructions) || !instructions.every((i) => typeof i === 'string')) {
    errors.push('"observed.instructions" must be an array of codes');
  } else {
    for (const i of instructions as string[]) {
      if (!isInstructionCode(i)) errors.push(`observed instruction "${i}" is not an instruction code`);
    }
  }
  const d = observed.dispatchAfterQuestion;
  if (d === null) {
    // The dispatcher never said help was coming — a real outcome (refused, transferred, caller
    // hung up). Kept out of the timing delta and counted on its own.
  } else if (!Number.isInteger(d) || (d as number) < 0) {
    errors.push('"observed.dispatchAfterQuestion" must be a non-negative integer, or null if help was never announced');
  } else if (Array.isArray(questions) && (d as number) > questions.length) {
    errors.push('"observed.dispatchAfterQuestion" exceeds the number of questions observed');
  }
  if (observed.notes !== undefined) {
    if (typeof observed.notes !== 'string') errors.push('"observed.notes" must be a string');
    else for (const reason of scanForIdentifiers(observed.notes)) errors.push(`notes: ${reason}`);
  }
  return errors;
}

// --- code maps: a pack's slots, strings and script steps → behavior codes ---

export interface CodeMap {
  pack: string;
  notes?: string;
  /** Question slot (case entry, key question, or script ask-step) → `Q.*` code. */
  slots: Record<string, string>;
  /** String id spoken by the engine (dispatch_confirm, post-dispatch lines) → `I.*` code(s). */
  strings: Record<string, string | string[]>;
  /** `scriptId/stepId` → `I.*` code(s), for steps inside instruction scripts. */
  steps?: Record<string, string | string[]>;
  /** Script id → `I.*` code(s) credited when the script is entered at all. */
  scripts?: Record<string, string | string[]>;
}

const codesOf = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Check a code map against the pack it describes: every key must exist in
 * the pack and every value must be a well-formed code. */
export function validateCodeMap(pack: ProtocolPack, map: CodeMap): string[] {
  const errors: string[] = [];
  if (map.pack !== pack.id) errors.push(`map is for "${map.pack}", pack is "${pack.id}"`);
  const slots = new Set<string>();
  for (const q of pack.caseEntry) slots.add(q.slot);
  for (const p of pack.protocols) for (const q of p.keyQuestions) slots.add(q.slot);
  for (const s of pack.scripts ?? []) for (const st of s.steps) if (st.slot) slots.add(st.slot);
  for (const [slot, code] of Object.entries(map.slots)) {
    if (!slots.has(slot)) errors.push(`slot "${slot}" does not exist in ${pack.id}`);
    if (!isQuestionCode(code)) errors.push(`slot "${slot}" maps to "${code}", not a question code`);
  }
  const strings = new Set(Object.keys(pack.strings[pack.defaultLocale] ?? {}));
  for (const [id, v] of Object.entries(map.strings)) {
    if (!strings.has(id)) errors.push(`string "${id}" does not exist in ${pack.id}`);
    for (const code of codesOf(v)) if (!isInstructionCode(code)) errors.push(`string "${id}" maps to "${code}", not an instruction code`);
  }
  const steps = new Set<string>();
  const scripts = new Set<string>();
  for (const s of pack.scripts ?? []) {
    scripts.add(s.id);
    for (const st of s.steps) steps.add(`${s.id}/${st.id}`);
  }
  for (const [key, v] of Object.entries(map.steps ?? {})) {
    if (!steps.has(key)) errors.push(`step "${key}" does not exist in ${pack.id}`);
    for (const code of codesOf(v)) if (!isInstructionCode(code)) errors.push(`step "${key}" maps to "${code}", not an instruction code`);
  }
  for (const [id, v] of Object.entries(map.scripts ?? {})) {
    if (!scripts.has(id)) errors.push(`script "${id}" does not exist in ${pack.id}`);
    for (const code of codesOf(v)) if (!isInstructionCode(code)) errors.push(`script "${id}" maps to "${code}", not an instruction code`);
  }
  return errors;
}

/** Every code a pack can produce, per the map — the universe for the miss list. */
export function producibleCodes(map: CodeMap): { questions: Set<string>; instructions: Set<string> } {
  const questions = new Set(Object.values(map.slots));
  const instructions = new Set<string>();
  for (const v of Object.values(map.strings)) for (const c of codesOf(v)) instructions.add(c);
  for (const v of Object.values(map.steps ?? {})) for (const c of codesOf(v)) instructions.add(c);
  for (const v of Object.values(map.scripts ?? {})) for (const c of codesOf(v)) instructions.add(c);
  return { questions, instructions };
}

// --- replaying one case ---

export interface EngineBehavior {
  /** Question codes the engine asked, first occurrence only, in order. */
  questions: string[];
  /** Every question the engine asked before announcing dispatch (mapped or not). */
  questionsBeforeDispatch: number;
  /** Instruction codes the engine gave, first occurrence only, in order. */
  instructions: string[];
  protocolId: string | null;
  selectedVia: 'keywords' | 'fallback' | 'jump' | null;
  /** Slots the engine asked that the map does not cover. */
  unmappedSlots: string[];
  /** Slots answered "I don't know" because the call never covered them. */
  unknownSlots: string[];
  turns: number;
  completed: boolean;
}

/** The phrase the engine's own lexicon recognises as "I don't know". */
export function unknownPhrase(pack: ProtocolPack, locale: Locale): string {
  const phrase = lexiconFor(locale, pack.lexicon).unknownTerms?.[0];
  if (!phrase) throw new Error(`No unknown-term in the ${locale} lexicon`);
  return phrase;
}

export interface ReplayOptions {
  locale?: Locale;
  maxTurns?: number;
}

export function replayCase(pack: ProtocolPack, map: CodeMap, c: ReplayCase, options: ReplayOptions = {}): EngineBehavior {
  const locale = options.locale ?? pack.defaultLocale;
  const dunno = unknownPhrase(pack, locale);
  const stepSlot = new Map<string, string>();
  for (const s of pack.scripts ?? []) for (const st of s.steps) if (st.slot) stepSlot.set(`${s.id}/${st.id}`, st.slot);

  const events: SessionEvent[] = [];
  const session = new DispatchSession(pack, { locale, onEvent: (e) => events.push(e) });
  session.start();
  const unmapped = new Set<string>();
  const unknown = new Set<string>();
  let turns = 0;
  const maxTurns = options.maxTurns ?? 200;
  while (!session.isDone() && turns < maxTurns) {
    const pending = session.pending();
    if (!pending) break;
    const code = map.slots[pending.slot];
    if (code === undefined) unmapped.add(pending.slot);
    const fact = code === undefined ? undefined : c.facts[code];
    let answer: string;
    if (fact === undefined || fact.trim().toLowerCase() === 'unknown') {
      answer = dunno;
      unknown.add(pending.slot);
    } else {
      answer = fact;
    }
    session.answer(answer);
    turns++;
  }

  const questions: string[] = [];
  const instructions: string[] = [];
  let askedBeforeDispatch = 0;
  let dispatched = false;
  let via: EngineBehavior['selectedVia'] = null;
  const pushUnique = (list: string[], code: string) => {
    if (!list.includes(code)) list.push(code);
  };
  for (const e of events) {
    if (e.type === 'ask' || (e.type === 'script_step' && e.kind === 'ask')) {
      const slot = e.type === 'ask' ? e.slot : stepSlot.get(`${e.scriptId}/${e.stepId}`);
      if (!dispatched) askedBeforeDispatch++;
      const code = slot === undefined ? undefined : map.slots[slot];
      if (code !== undefined) pushUnique(questions, code);
    }
    if (e.type === 'determinant') dispatched = true;
    if (e.type === 'protocol_selected') via = e.via;
    if (e.type === 'utterance') for (const code of codesOf(map.strings[e.stringId])) pushUnique(instructions, code);
    if (e.type === 'script_entered') for (const code of codesOf(map.scripts?.[e.scriptId])) pushUnique(instructions, code);
    if (e.type === 'script_step') {
      for (const code of codesOf(map.steps?.[`${e.scriptId}/${e.stepId}`])) pushUnique(instructions, code);
    }
  }
  return {
    questions,
    questionsBeforeDispatch: askedBeforeDispatch,
    instructions,
    protocolId: session.result().protocolId,
    selectedVia: via,
    unmappedSlots: [...unmapped],
    unknownSlots: [...unknown],
    turns,
    completed: session.isDone(),
  };
}

// --- aggregates ---

export interface RecallPrecision {
  /** Codes the dispatcher used, summed over cases. */
  observed: number;
  /** Codes the engine produced, summed over cases. */
  engine: number;
  /** Codes both used, summed over cases. */
  shared: number;
  recall: number | null;
  precision: number | null;
}

export interface CodeTally {
  code: string;
  /** Cases in which the dispatcher used the code. */
  observed: number;
  /** Cases in which the engine produced the code. */
  engine: number;
  /** Cases in which both did. */
  both: number;
}

export interface ReplayReport {
  pack: string;
  locale: Locale;
  cases: number;
  questions: { core: RecallPrecision; kq: RecallPrecision; perCode: CodeTally[] };
  opening: {
    evaluated: number;
    firstIdentical: number;
    firstThreeIdentical: number;
    /** Mean Kendall τ over cases with at least two shared codes. */
    kendallTau: number | null;
    kendallTauCases: number;
  };
  instructions: { all: RecallPrecision; perCode: CodeTally[] };
  dispatchTiming: {
    evaluated: number;
    /** Cases where the dispatcher never announced help at all. */
    neverAnnounced: number;
    /** Engine's questions-before-dispatch minus the dispatcher's, averaged. */
    meanDelta: number | null;
    medianDelta: number | null;
    engineEarlier: number;
    same: number;
    engineLater: number;
    /** Histogram of the delta, bucketed, for the write-up. */
    histogram: { bucket: string; cases: number }[];
  };
  protocol: {
    compared: number;
    agree: number;
    /** Cases whose coder marked the protocol `unknown`. */
    skipped: number;
    fallbackSelections: number;
    /** Engine protocol by coder protocol, as counts — an aggregate confusion table. */
    confusion: { implied: string; engine: string; cases: number }[];
  };
  /** Codes the dispatchers used that the pack never produces on any path. */
  missList: { questions: CodeTally[]; instructions: CodeTally[] };
  /** Slots the engine asked during these replays that the map does not cover. */
  unmappedSlots: { slot: string; cases: number }[];
  completed: number;
}

function ratio(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

function kendallTau(observed: string[], engine: string[]): number | null {
  const pos = new Map(engine.map((c, i) => [c, i] as const));
  const shared = observed.filter((c) => pos.has(c));
  if (shared.length < 2) return null;
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < shared.length; i++) {
    for (let j = i + 1; j < shared.length; j++) {
      if (pos.get(shared[i]!)! < pos.get(shared[j]!)!) concordant++;
      else discordant++;
    }
  }
  return (concordant - discordant) / (concordant + discordant);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function tallyCodes(pairs: { observed: string[]; engine: string[] }[]): Map<string, CodeTally> {
  const tallies = new Map<string, CodeTally>();
  const get = (code: string) => {
    let t = tallies.get(code);
    if (!t) tallies.set(code, (t = { code, observed: 0, engine: 0, both: 0 }));
    return t;
  };
  for (const p of pairs) {
    const o = new Set(p.observed);
    const e = new Set(p.engine);
    for (const c of o) {
      get(c).observed++;
      if (e.has(c)) get(c).both++;
    }
    for (const c of e) get(c).engine++;
  }
  return tallies;
}

function recallPrecision(tallies: Iterable<CodeTally>): RecallPrecision {
  let observed = 0;
  let engine = 0;
  let shared = 0;
  for (const t of tallies) {
    observed += t.observed;
    engine += t.engine;
    shared += t.both;
  }
  return { observed, engine, shared, recall: ratio(shared, observed), precision: ratio(shared, engine) };
}

const byCode = (a: CodeTally, b: CodeTally) => b.observed - a.observed || a.code.localeCompare(b.code);

/** Fold replayed cases into the aggregate report. Never keeps a per-case row. */
export function aggregate(
  pack: ProtocolPack,
  map: CodeMap,
  cases: { c: ReplayCase; b: EngineBehavior }[],
  locale: Locale = pack.defaultLocale,
): ReplayReport {
  const qTallies = tallyCodes(cases.map(({ c, b }) => ({ observed: c.observed.questions, engine: b.questions })));
  const iTallies = tallyCodes(cases.map(({ c, b }) => ({ observed: c.observed.instructions, engine: b.instructions })));
  const qAll = [...qTallies.values()];
  const core = recallPrecision(qAll.filter((t) => isCoreQuestion(t.code)));
  const kq = recallPrecision(qAll.filter((t) => !isCoreQuestion(t.code)));

  let firstIdentical = 0;
  let firstThreeIdentical = 0;
  let tauSum = 0;
  let tauCases = 0;
  let openingEvaluated = 0;
  for (const { c, b } of cases) {
    const o = c.observed.questions;
    const e = b.questions;
    if (o.length && e.length) {
      openingEvaluated++;
      if (o[0] === e[0]) firstIdentical++;
      if (o.length >= 3 && e.length >= 3 && o[0] === e[0] && o[1] === e[1] && o[2] === e[2]) firstThreeIdentical++;
    }
    const tau = kendallTau(o, e);
    if (tau !== null) {
      tauSum += tau;
      tauCases++;
    }
  }

  const timed = cases.filter(({ c }) => c.observed.dispatchAfterQuestion !== null);
  const deltas = timed.map(({ c, b }) => b.questionsBeforeDispatch - (c.observed.dispatchAfterQuestion as number));
  const buckets: [string, (d: number) => boolean][] = [
    ['≤ −5', (d) => d <= -5],
    ['−4 … −1', (d) => d >= -4 && d <= -1],
    ['0', (d) => d === 0],
    ['+1 … +4', (d) => d >= 1 && d <= 4],
    ['+5 … +9', (d) => d >= 5 && d <= 9],
    ['≥ +10', (d) => d >= 10],
  ];

  let compared = 0;
  let agree = 0;
  let skipped = 0;
  const confusion = new Map<string, { implied: string; engine: string; cases: number }>();
  for (const { c, b } of cases) {
    if (c.impliedProtocol === 'unknown') {
      skipped++;
      continue;
    }
    compared++;
    const engine = b.protocolId ?? '(none)';
    if (engine === c.impliedProtocol) agree++;
    const key = `${c.impliedProtocol} ${engine}`;
    const row = confusion.get(key) ?? { implied: c.impliedProtocol, engine, cases: 0 };
    row.cases++;
    confusion.set(key, row);
  }

  const producible = producibleCodes(map);
  const unmapped = new Map<string, number>();
  for (const { b } of cases) for (const s of b.unmappedSlots) unmapped.set(s, (unmapped.get(s) ?? 0) + 1);

  return {
    pack: pack.id,
    locale,
    cases: cases.length,
    questions: { core, kq, perCode: qAll.sort(byCode) },
    opening: {
      evaluated: openingEvaluated,
      firstIdentical,
      firstThreeIdentical,
      kendallTau: tauCases ? tauSum / tauCases : null,
      kendallTauCases: tauCases,
    },
    instructions: { all: recallPrecision(iTallies.values()), perCode: [...iTallies.values()].sort(byCode) },
    dispatchTiming: {
      evaluated: deltas.length,
      neverAnnounced: cases.length - timed.length,
      meanDelta: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null,
      medianDelta: median(deltas),
      engineEarlier: deltas.filter((d) => d < 0).length,
      same: deltas.filter((d) => d === 0).length,
      engineLater: deltas.filter((d) => d > 0).length,
      histogram: buckets.map(([bucket, test]) => ({ bucket, cases: deltas.filter(test).length })),
    },
    protocol: {
      compared,
      agree,
      skipped,
      fallbackSelections: cases.filter(({ b }) => b.selectedVia === 'fallback').length,
      confusion: [...confusion.values()].sort((a, b) => b.cases - a.cases || a.implied.localeCompare(b.implied)),
    },
    missList: {
      questions: qAll.filter((t) => t.observed > 0 && !producible.questions.has(t.code)).sort(byCode),
      instructions: [...iTallies.values()].filter((t) => t.observed > 0 && !producible.instructions.has(t.code)).sort(byCode),
    },
    unmappedSlots: [...unmapped.entries()].map(([slot, n]) => ({ slot, cases: n })).sort((a, b) => b.cases - a.cases),
    completed: cases.filter(({ b }) => b.completed).length,
  };
}

// --- rendering (Markdown; aggregates only) ---

const pct = (x: number | null): string => (x === null ? 'n/a' : `${(x * 100).toFixed(0)}%`);
const num = (x: number | null, digits = 2): string => (x === null ? 'n/a' : x.toFixed(digits));
const signed = (x: number | null): string => (x === null ? 'n/a' : `${x > 0 ? '+' : ''}${x.toFixed(1)}`);

function rpLine(label: string, rp: RecallPrecision): string {
  return `| ${label} | ${rp.observed} | ${rp.engine} | ${rp.shared} | ${pct(rp.recall)} | ${pct(rp.precision)} |`;
}

function tallyTable(tallies: CodeTally[]): string[] {
  if (!tallies.length) return ['_none_'];
  return [
    '| Code | Dispatcher (cases) | Engine (cases) | Both |',
    '| --- | ---: | ---: | ---: |',
    ...tallies.map((t) => `| \`${t.code}\` | ${t.observed} | ${t.engine} | ${t.both} |`),
  ];
}

export function formatReport(r: ReplayReport): string {
  const lines: string[] = [];
  lines.push(`## Replay — \`${r.pack}\` (${r.locale}), ${r.cases} case${r.cases === 1 ? '' : 's'}`);
  lines.push('');
  lines.push('Aggregates only. No per-call rows, no agency, no quotes. State the source mix and its biases next to these numbers.');
  lines.push('');
  lines.push(`Replays completed: ${r.completed}/${r.cases}.`);
  lines.push('');
  lines.push('### Questions');
  lines.push('');
  lines.push('| | Dispatcher | Engine | Shared | Recall | Precision |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  lines.push(rpLine('Core codes', r.questions.core));
  lines.push(rpLine('Card-specific (`Q.kq:*`)', r.questions.kq));
  lines.push('');
  lines.push(
    `Opening order: first question identical in ${r.opening.firstIdentical}/${r.opening.evaluated}; ` +
      `first three identical in ${r.opening.firstThreeIdentical}/${r.opening.evaluated}; ` +
      `Kendall τ over shared codes ${num(r.opening.kendallTau)} (${r.opening.kendallTauCases} cases with ≥2 shared).`,
  );
  lines.push('');
  lines.push('Per code (cases):');
  lines.push('');
  lines.push(...tallyTable(r.questions.perCode));
  lines.push('');
  lines.push('### Instructions');
  lines.push('');
  lines.push('| | Dispatcher | Engine | Shared | Recall | Precision |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  lines.push(rpLine('All `I.*` codes', r.instructions.all));
  lines.push('');
  lines.push(...tallyTable(r.instructions.perCode));
  lines.push('');
  lines.push('### Dispatch timing');
  lines.push('');
  lines.push(
    `Questions before help was announced, engine minus dispatcher: mean ${signed(r.dispatchTiming.meanDelta)}, ` +
      `median ${signed(r.dispatchTiming.medianDelta)} over ${r.dispatchTiming.evaluated} cases — ` +
      `engine earlier ${r.dispatchTiming.engineEarlier}, same ${r.dispatchTiming.same}, engine later ${r.dispatchTiming.engineLater}.` +
      (r.dispatchTiming.neverAnnounced ? ` The dispatcher never announced help in ${r.dispatchTiming.neverAnnounced} further case(s); the engine always does.` : ''),
  );
  lines.push('');
  lines.push('| Delta | Cases |');
  lines.push('| --- | ---: |');
  for (const h of r.dispatchTiming.histogram) lines.push(`| ${h.bucket} | ${h.cases} |`);
  lines.push('');
  lines.push('### Protocol');
  lines.push('');
  lines.push(
    `Agreement ${r.protocol.agree}/${r.protocol.compared} (${pct(ratio(r.protocol.agree, r.protocol.compared))}); ` +
      `${r.protocol.skipped} coded \`unknown\` and skipped; engine fell back to the default card in ${r.protocol.fallbackSelections} cases.`,
  );
  if (r.protocol.confusion.length) {
    lines.push('');
    lines.push('| Coder | Engine | Cases |');
    lines.push('| --- | --- | ---: |');
    for (const row of r.protocol.confusion) lines.push(`| \`${row.implied}\` | \`${row.engine}\` | ${row.cases} |`);
  }
  lines.push('');
  lines.push('### Miss list — what dispatchers did that this pack cannot do on any path');
  lines.push('');
  lines.push('Questions:');
  lines.push('');
  lines.push(...tallyTable(r.missList.questions));
  lines.push('');
  lines.push('Instructions:');
  lines.push('');
  lines.push(...tallyTable(r.missList.instructions));
  if (r.unmappedSlots.length) {
    lines.push('');
    lines.push('### Map coverage');
    lines.push('');
    lines.push('Slots the engine asked that `replay/codes/<pack>.json` does not map (they count toward timing, not toward precision):');
    lines.push('');
    for (const u of r.unmappedSlots) lines.push(`- \`${u.slot}\` (${u.cases})`);
  }
  lines.push('');
  return lines.join('\n');
}
