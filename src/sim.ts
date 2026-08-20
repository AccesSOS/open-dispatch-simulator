import { DispatchSession } from './engine.js';
import type { Locale, ProtocolPack, Question, SessionResult } from './types.js';

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

export function runCall(pack: ProtocolPack, script: CallerScript, maxTurns = 100): CallMetrics {
  let clarifies = 0;
  const session = new DispatchSession(pack, {
    locale: script.locale,
    onEvent: (e) => {
      if (e.type === 'clarify') clarifies++;
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
  };
}

export function runBatch(pack: ProtocolPack, scripts: CallerScript[]): BatchReport {
  const calls = scripts.map((s) => runCall(pack, s));
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
