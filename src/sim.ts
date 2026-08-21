import { DispatchSession } from './engine.js';
import type {
  Condition,
  InstructionScript,
  SessionEvent,
  Locale,
  Persona,
  ProtocolPack,
  Question,
  ScriptStep,
  SessionResult,
} from './types.js';

/**
 * Caller simulation: run scripted callers through a pack at scale and score
 * the outcomes. This is the harness for "thousands of iterations" — sweep
 * every branch combination, verify every call reaches dispatch, and measure
 * how long intake takes.
 */

export interface CallerScript {
  id: string;
  locale: Locale;
  /** Answer for each slot the dispatcher may ask about. */
  slots: Record<string, string>;
  /** Used when the script has no answer for a slot (a confused caller). */
  fallbackAnswer?: string;
}

export interface CallMetrics {
  scriptId: string;
  locale: Locale;
  result: SessionResult;
  /** Caller turns spent, including turns consumed by clarify re-asks. */
  turns: number;
  clarifies: number;
  /** True when the call reached dispatch (the invariant every call must hit). */
  completed: boolean;
  /** v0.3: instruction-script steps read, as "<scriptId>#<stepId>". */
  scriptSteps: string[];
  /** The session's own narration, when `recordEvents` asked for it. Opt-in:
   * a branch sweep runs tens of thousands of calls and does not want them. */
  events?: SessionEvent[] | undefined;
}

export interface BatchReport {
  calls: CallMetrics[];
  total: number;
  completed: number;
  incomplete: string[];
  byProtocol: Record<string, number>;
  byDeterminant: Record<string, number>;
  byResponse: Record<string, number>;
  avgTurns: number;
  clarifyRate: number;
}

export interface RunOptions {
  maxTurns?: number;
  /** Dispatcher profile to run this call against (seeded, reproducible). */
  persona?: Persona;
  /** Keep the session's event stream on the result, for scoring. */
  recordEvents?: boolean;
}

export function runCall(pack: ProtocolPack, script: CallerScript, options: RunOptions = {}): CallMetrics {
  const maxTurns = options.maxTurns ?? 100;
  let clarifies = 0;
  const scriptSteps: string[] = [];
  const events: SessionEvent[] = [];
  const session = new DispatchSession(pack, {
    locale: script.locale,
    ...(options.persona && { persona: options.persona }),
    onEvent: (e) => {
      if (e.type === 'clarify') clarifies++;
      if (e.type === 'script_step') scriptSteps.push(`${e.scriptId}#${e.stepId}`);
      if (options.recordEvents) events.push(e);
    },
  });
  session.start();
  let turns = 0;
  while (!session.isDone() && turns < maxTurns) {
    const pending = session.pending();
    if (!pending) break;
    session.answer(script.slots[pending.slot] ?? script.fallbackAnswer ?? 'I am not sure');
    turns++;
  }
  return {
    scriptId: script.id,
    locale: script.locale,
    result: session.result(),
    turns,
    clarifies,
    completed: session.isDone(),
    scriptSteps,
    ...(options.recordEvents ? { events } : {}),
  };
}

export function runBatch(
  pack: ProtocolPack,
  scripts: CallerScript[],
  options: RunOptions = {},
): BatchReport {
  const calls = scripts.map((s) => runCall(pack, s, options));
  const count = (keyOf: (m: CallMetrics) => string | null) => {
    const acc: Record<string, number> = {};
    for (const m of calls) {
      const k = keyOf(m) ?? '(none)';
      acc[k] = (acc[k] ?? 0) + 1;
    }
    return acc;
  };
  const completed = calls.filter((m) => m.completed);
  return {
    calls,
    total: calls.length,
    completed: completed.length,
    incomplete: calls.filter((m) => !m.completed).map((m) => m.scriptId),
    byProtocol: count((m) => m.result.protocolId),
    byDeterminant: count((m) => m.result.determinantId),
    byResponse: count((m) => m.result.response),
    avgTurns: calls.reduce((a, m) => a + m.turns, 0) / Math.max(1, calls.length),
    clarifyRate: calls.filter((m) => m.clarifies > 0).length / Math.max(1, calls.length),
  };
}

const FREE_SLOT_DEFAULTS: Record<string, string> = {
  address: '100 Test Street',
  callback: '555-0100',
  age: '40',
};

function cartesian<T>(sets: T[][]): T[][] {
  return sets.reduce<T[][]>((acc, set) => acc.flatMap((combo) => set.map((v) => [...combo, v])), [
    [],
  ]);
}

/**
 * Exhaustive branch sweep: one script per protocol per combination of choice
 * options (case-entry choices included). Unreachable combinations — options
 * for questions a branch skips — are generated too; they simply go unasked,
 * which is exactly how real coverage of a decision tree behaves.
 */
export function sweepScripts(pack: ProtocolPack, locale: Locale): CallerScript[] {
  const scripts: CallerScript[] = [];
  const selector = pack.caseEntry.find((q) => q.selectsProtocol);
  const caseChoiceQs = pack.caseEntry.filter((q) => q.expect);

  for (const p of pack.protocols) {
    const complaint =
      p.id === pack.fallbackProtocol
        ? 'zzz unmatched complaint zzz'
        : p.keywords[locale]?.[0] ?? p.id;
    const choiceQs: Question[] = [...caseChoiceQs, ...p.keyQuestions.filter((q) => q.expect)];
    const combos = cartesian(choiceQs.map((q) => q.expect!.options));
    for (const combo of combos) {
      const slots: Record<string, string> = { ...FREE_SLOT_DEFAULTS };
      if (selector) slots[selector.slot] = complaint;
      combo.forEach((option, i) => {
        const q = choiceQs[i]!;
        slots[q.slot] = option.keywords[locale]?.[0] ?? option.id;
      });
      scripts.push({
        id: `${p.id}/${combo.map((o, i) => `${choiceQs[i]!.slot}=${o.id}`).join(',') || 'direct'}`,
        locale,
        slots,
        fallbackAnswer: 'unknown',
      });
    }
  }
  return scripts;
}

/** Result of a script-path sweep: the caller scripts, plus what was skipped. */
export interface ScriptSweep {
  scripts: CallerScript[];
  /** Steps the sweep could not reach, as "<scriptId>#<stepId>". */
  unreachable: string[];
  /** Entries whose path enumeration hit the cap — coverage is not exhaustive. */
  capped: string[];
}

/** Paths kept per (protocol, script) pair. Overrun is reported, never silent. */
const MAX_PATHS_PER_ENTRY = 400;

/** A concrete value that makes `cond` hold, drawn from the pack's own vocabulary. */
function slotValueFor(pack: ProtocolPack, cond: Condition, locale: Locale): string | undefined {
  if ('option' in cond) {
    const questions: (Question | ScriptStep)[] = [
      ...pack.caseEntry,
      ...pack.protocols.flatMap((p) => p.keyQuestions),
      ...(pack.scripts ?? []).flatMap((s) => s.steps),
    ];
    for (const q of questions) {
      if (q.slot !== cond.slot) continue;
      const option = q.expect?.options.find((o) => o.id === cond.option);
      const keyword = option?.keywords[locale]?.[0];
      if (keyword) return keyword;
    }
    return undefined;
  }
  if (cond.lt !== undefined) return String(cond.lt - 1);
  if (cond.lte !== undefined) return String(cond.lte);
  if (cond.gt !== undefined) return String(cond.gt + 1);
  if (cond.gte !== undefined) return String(cond.gte);
  return undefined;
}

/**
 * Every root-to-terminal walk through an instruction script, as the option
 * answers a caller would have to give to take it.
 *
 * Scripts are a DAG (the loader guarantees it), so this terminates. An edge
 * guarded by `when` is solved back into the answers a caller would have to have
 * given earlier in the call — a script may branch on what the card already
 * asked, and without solving those the branch is generated but never taken.
 * Conditions with no expressible value are left unsolved, which is why the
 * sweep reports the steps it never actually reached rather than assuming it
 * reached them all.
 */
function scriptPaths(
  pack: ProtocolPack,
  entryScriptId: string,
  locale: Locale,
  cap: number,
): { answers: Record<string, string>[]; capped: boolean } {
  const solve = (conds: Condition[] | undefined, answers: Record<string, string>) => {
    if (!conds?.length) return answers;
    const solved = { ...answers };
    for (const cond of conds) {
      const value = slotValueFor(pack, cond, locale);
      if (value !== undefined) solved[cond.slot] = value;
    }
    return solved;
  };
  const byId = new Map((pack.scripts ?? []).map((s) => [s.id, s]));
  const out: Record<string, string>[] = [];
  let capped = false;

  const walk = (script: InstructionScript, index: number, answers: Record<string, string>): void => {
    if (out.length >= cap) {
      capped = true;
      return;
    }
    const step = script.steps[index];
    if (!step || step.kind === 'stay') {
      out.push(answers);
      return;
    }
    const edges = step.next ?? [];
    const hasDefault = edges.some((e) => e.whenOption === undefined && !e.when?.length);
    const follow = (edge: (typeof edges)[number] | null, given: Record<string, string>) => {
      const withAnswers = solve(edge?.when, given);
      if (!edge) {
        const nextStep = script.steps[index + 1];
        if (!nextStep) out.push(withAnswers);
        else walk(script, index + 1, withAnswers);
        return;
      }
      if (edge.gotoScript !== undefined) {
        const target = byId.get(edge.gotoScript);
        if (target) walk(target, 0, withAnswers);
        else out.push(withAnswers);
        return;
      }
      if (edge.goto === '$end') {
        out.push(withAnswers);
        return;
      }
      const at = script.steps.findIndex((s) => s.id === edge.goto);
      if (at < 0) out.push(withAnswers);
      else walk(script, at, withAnswers);
    };

    if (step.kind === 'ask' && step.slot) {
      for (const option of step.expect?.options ?? []) {
        const answer = option.keywords[locale]?.[0] ?? option.id;
        const edge =
          edges.find((e) => e.whenOption === option.id) ??
          edges.find((e) => e.whenOption === undefined) ??
          null;
        follow(edge, { ...answers, [step.slot]: answer });
      }
      return;
    }
    if (!edges.length) {
      follow(null, answers);
      return;
    }
    for (const edge of edges) follow(edge, answers);
    if (!hasDefault) follow(null, answers);
  };

  const entry = byId.get(entryScriptId);
  if (entry) walk(entry, 0, {});
  return { answers: out, capped };
}

/**
 * Branch sweep for v0.3 instruction scripts: one caller per walk through each
 * script a protocol can hand off to, with the slot values needed to route into
 * that protocol and select that script.
 *
 * Kept separate from sweepScripts on purpose. Multiplying protocol branches by
 * instruction branches would put the sweep into the millions of calls for no
 * extra coverage — each family exercises its own decision surface.
 */
export function sweepInstructionScripts(pack: ProtocolPack, locale: Locale): ScriptSweep {
  const scripts: CallerScript[] = [];
  const capped: string[] = [];
  const selector = pack.caseEntry.find((q) => q.selectsProtocol);
  const reached = new Set<string>();

  for (const p of pack.protocols) {
    for (const entry of p.postDispatchScripts ?? []) {
      const base: Record<string, string> = { ...FREE_SLOT_DEFAULTS };
      if (selector) {
        base[selector.slot] =
          p.id === pack.fallbackProtocol
            ? 'zzz unmatched complaint zzz'
            : p.keywords[locale]?.[0] ?? p.id;
      }
      for (const cond of entry.when ?? []) {
        const value = slotValueFor(pack, cond, locale);
        if (value !== undefined) base[cond.slot] = value;
      }
      const { answers, capped: hitCap } = scriptPaths(pack, entry.script, locale, MAX_PATHS_PER_ENTRY);
      if (hitCap) capped.push(`${p.id}/${entry.script}`);
      answers.forEach((path, i) => {
        scripts.push({
          id: `${p.id}/${entry.script}/path${i}`,
          locale,
          slots: { ...base, ...path },
          fallbackAnswer: 'unknown',
        });
      });
    }
  }

  // Which steps the sweep actually reaches is a fact, not an assumption.
  for (const m of scripts.map((s) => runCall(pack, s))) {
    for (const step of m.scriptSteps) reached.add(step);
  }
  const unreachable: string[] = [];
  for (const script of pack.scripts ?? []) {
    for (const step of script.steps) {
      const id = `${script.id}#${step.id}`;
      if (!reached.has(id)) unreachable.push(id);
    }
  }
  return { scripts, unreachable, capped };
}
