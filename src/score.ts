import type { ProtocolPack, SessionEvent, SessionResult } from './types.js';

/**
 * Scoring a call against the protocol it was supposed to follow.
 *
 * `npm run sim` answers "did the call reach dispatch". That is the floor, not
 * the bar. Maine's EMDPRS §III.4.C lists the variables a licensed EMD centre
 * must track for every reviewed call, and they are the right axes here too:
 * all-caller questions, protocol selection, complaint-specific questions,
 * priority determination, pre-arrival instructions, post-dispatch instructions.
 *
 * Deterministic and keyless, like everything else. Two things it deliberately
 * does not claim: it cannot judge whether a determinant was *clinically*
 * appropriate — that needs a ground truth no synthetic call has — and it scores
 * a session this engine ran, not an arbitrary transcript. Scoring free text
 * from elsewhere would be a matching problem, and a wrong answer there would be
 * worse than no answer.
 */

export type AxisStatus = 'pass' | 'partial' | 'fail' | 'n/a';

export interface ScoreAxis {
  id:
    | 'all-caller-questions'
    | 'protocol-selection'
    | 'complaint-questions'
    | 'priority'
    | 'pre-arrival-instructions'
    | 'post-dispatch-instructions';
  label: string;
  citation: string;
  status: AxisStatus;
  detail: string;
  evidence: string[];
}

/**
 * How much of what was asked actually came back. This is a property of the
 * *caller*, not of protocol compliance — a caller who says "I don't know" three
 * times has not made the dispatcher non-compliant. Kept separate for that
 * reason, and it is the number an AI-caller harness actually wants.
 */
export interface InformationCapture {
  asked: number;
  answered: number;
  /** Questions asked as a choice whose answer never parsed, even after clarifying. */
  unparsed: string[];
  /** Slots where the caller said they do not know — a different thing from an
   * answer that did not parse, and not something re-asking would fix. */
  unknown: string[];
  /** answered / asked, 0..1. */
  rate: number;
}

export interface CallScore {
  packId: string;
  locale: string;
  protocolId: string | null;
  determinantId: string | null;
  response: string | null;
  axes: ScoreAxis[];
  information: InformationCapture;
  clarifies: number;
  /** Dispatcher utterances spoken. */
  utterances: number;
  summary: { pass: number; partial: number; fail: number; notApplicable: number };
}

interface Asked {
  questionId: string;
  slot: string;
  protocolId: string | null;
  phase: 'case_entry' | 'key_questions' | 'instructions';
}

/** Replay the engine's own narration into the facts the axes need. */
function digest(events: SessionEvent[]) {
  const asked: Asked[] = [];
  const answered = new Map<string, { option: string | null; text: string }>();
  const clarified = new Set<string>();
  let phase: Asked['phase'] = 'case_entry';
  let selection: { protocolId: string; via: 'keywords' | 'fallback' | 'jump' } | null = null;
  let determinant: { determinantId: string; response: string } | null = null;
  const scripts: string[] = [];
  const scriptSteps: { scriptId: string; stepId: string; kind: string }[] = [];
  const spoken: string[] = [];
  let clarifies = 0;
  // The pack can route a call straight to determination — "not breathing, send
  // now" — and both bundled EMD packs do exactly that. The engine only emits an
  // edge to a determine node when the pack declared one, so this is the pack
  // saying "skip the interrogation", not the interrogation being skipped.
  let fastTracked: string | null = null;

  for (const e of events) {
    switch (e.type) {
      case 'phase':
        if (e.phase === 'case_entry' || e.phase === 'key_questions' || e.phase === 'instructions') {
          phase = e.phase;
        }
        break;
      case 'ask':
        asked.push({ questionId: e.questionId, slot: e.slot, protocolId: e.protocolId, phase });
        break;
      case 'answer':
        answered.set(e.questionId, { option: e.option, text: e.text });
        break;
      case 'clarify':
        clarifies++;
        clarified.add(e.questionId);
        break;
      case 'protocol_selected':
        // A card jump replaces an earlier selection; the last one owns the call.
        selection = { protocolId: e.protocolId, via: e.via };
        break;
      case 'determinant':
        determinant = { determinantId: e.determinantId, response: e.response };
        break;
      case 'script_entered':
        scripts.push(e.scriptId);
        break;
      case 'script_step':
        scriptSteps.push({ scriptId: e.scriptId, stepId: e.stepId, kind: e.kind });
        if (e.kind === 'ask') {
          asked.push({ questionId: e.stepId, slot: '', protocolId: null, phase: 'instructions' });
        }
        break;
      case 'edge':
        if (e.to === '$dispatch' || e.to.endsWith(':$determine')) fastTracked = e.from;
        break;
      case 'utterance':
        spoken.push(e.stringId);
        break;
    }
  }
  return {
    asked, answered, clarified, selection, determinant, scripts, scriptSteps, spoken, clarifies,
    fastTracked,
  };
}

const axis = (
  id: ScoreAxis['id'],
  label: string,
  citation: string,
  status: AxisStatus,
  detail: string,
  evidence: string[] = [],
): ScoreAxis => ({ id, label, citation, status, detail, evidence });

/**
 * Score one call. `events` is the session's own `onEvent` stream; `result` is
 * what `session.result()` returned.
 */
export function scoreCall(
  pack: ProtocolPack,
  locale: string,
  events: SessionEvent[],
  result: SessionResult,
): CallScore {
  const d = digest(events);
  const protocol = pack.protocols.find((p) => p.id === result.protocolId) ?? null;

  const choiceQuestions = new Map<string, boolean>();
  for (const q of [...pack.caseEntry, ...pack.protocols.flatMap((p) => p.keyQuestions)]) {
    choiceQuestions.set(q.id, Boolean(q.expect));
  }
  for (const s of pack.scripts ?? []) {
    for (const step of s.steps) choiceQuestions.set(step.id, step.kind === 'ask');
  }

  const unparsedIn = (phase: Asked['phase']) =>
    d.asked
      .filter((a) => a.phase === phase && choiceQuestions.get(a.questionId))
      .filter((a) => {
        const got = d.answered.get(a.questionId);
        return got !== undefined && got.option === null;
      })
      .map((a) => a.questionId);

  // 1 — all-caller questions. Compliance is whether the dispatcher worked
  // through the card's entry sequence, and clarified when an answer did not
  // parse — not whether the caller happened to know the answers.
  const caseAsked = d.asked.filter((a) => a.phase === 'case_entry');
  const caseUnparsed = unparsedIn('case_entry');
  const unclarified = caseUnparsed.filter((q) => !d.clarified.has(q));
  const axes: ScoreAxis[] = [];
  axes.push(
    axis(
      'all-caller-questions',
      'Compliance to systematic "all caller" questions',
      'Maine EMDPRS §III.4.C.1',
      caseAsked.length === 0 ? 'fail' : unclarified.length ? 'partial' : 'pass',
      caseAsked.length === 0
        ? 'no case-entry question was asked'
        : unclarified.length
          ? `${unclarified.length} unparsed answer(s) were not clarified`
          : `${caseAsked.length} asked${caseUnparsed.length ? `, ${caseUnparsed.length} clarified` : ''}`,
      unclarified.map((q) => `not clarified: ${q}`),
    ),
  );

  // 2 — protocol selection
  const via = d.selection?.via ?? null;
  axes.push(
    axis(
      'protocol-selection',
      'Appropriate selection of protocol based on the complaint',
      'Maine EMDPRS §III.4.C.2',
      via === null ? 'fail' : via === 'fallback' ? 'partial' : 'pass',
      via === null
        ? 'no protocol was selected'
        : via === 'fallback'
          ? `the complaint matched no card's keywords; the pack's fallback took the call`
          : `selected via ${via}`,
      d.selection ? [`${d.selection.protocolId} (${d.selection.via})`] : [],
    ),
  );

  // 3 — complaint-specific questions
  const keyAsked = d.asked.filter((a) => a.phase === 'key_questions');
  const keyUnparsed = unparsedIn('key_questions');
  const keyUnclarified = keyUnparsed.filter((q) => !d.clarified.has(q));
  const declaresKeyQuestions = (protocol?.keyQuestions.length ?? 0) > 0;
  const status: AxisStatus = !declaresKeyQuestions
    ? 'n/a'
    : keyAsked.length === 0
      ? d.fastTracked
        ? 'n/a' // the card itself routed straight to dispatch
        : 'fail'
      : keyUnclarified.length
        ? 'partial'
        : 'pass';
  axes.push(
    axis(
      'complaint-questions',
      'Compliance to systematic "complaint-specific" questions',
      'Maine EMDPRS §III.4.C.3',
      status,
      !declaresKeyQuestions
        ? `${protocol?.id ?? 'the card'} declares no key questions`
        : keyAsked.length === 0
          ? d.fastTracked
            ? `the card routed straight to dispatch from ${d.fastTracked} — interrogation is skipped by design`
            : `${protocol?.id} declares ${protocol?.keyQuestions.length} key questions and none were asked`
          : keyUnclarified.length
            ? `${keyUnclarified.length} unparsed answer(s) were not clarified`
            : `${keyAsked.length} asked${keyUnparsed.length ? `, ${keyUnparsed.length} clarified` : ''}`,
      keyUnclarified.map((q) => `not clarified: ${q}`),
    ),
  );

  // 4 — priority determination
  const rule = protocol?.determinants.find((r) => r.id === d.determinant?.determinantId);
  const isDefault = rule ? !rule.when?.length : false;
  axes.push(
    axis(
      'priority',
      'Appropriate determination of call priority',
      'Maine EMDPRS §III.4.C.4',
      d.determinant ? 'pass' : 'fail',
      d.determinant
        ? `${d.determinant.response} via ${d.determinant.determinantId}${isDefault ? " (the card's default rule)" : ''}`
        : 'the call produced no response level',
      d.determinant ? [d.determinant.determinantId] : [],
    ),
  );

  // 5 — pre-arrival instructions (v0.3 instruction scripts)
  const declaresScripts = (protocol?.postDispatchScripts?.length ?? 0) > 0;
  const reachedTerminal = d.scriptSteps.some((s) => s.kind === 'stay');
  axes.push(
    axis(
      'pre-arrival-instructions',
      'Compliance to systematic "pre-arrival" instructions',
      'Maine EMDPRS §III.4.C.5',
      !declaresScripts ? 'n/a' : d.scripts.length === 0 ? 'fail' : reachedTerminal ? 'pass' : 'partial',
      !declaresScripts
        ? `${protocol?.id ?? 'the card'} hands off to no instruction script`
        : d.scripts.length === 0
          ? 'the card declares an instruction script and none ran'
          : reachedTerminal
            ? `${d.scripts.length} script(s), ${d.scriptSteps.length} steps read, reached a terminal step`
            : `${d.scripts.length} script(s) ran but the call ended before a terminal step`,
      d.scripts,
    ),
  );

  // 6 — post-dispatch instructions
  const postDispatch = protocol?.postDispatch ?? [];
  const readBack = postDispatch.filter((id) => d.spoken.includes(id));
  axes.push(
    axis(
      'post-dispatch-instructions',
      'Compliance to systematic "post-dispatch" instructions',
      'Maine EMDPRS §III.4.C.6',
      postDispatch.length === 0 ? 'fail' : readBack.length === postDispatch.length ? 'pass' : 'partial',
      postDispatch.length === 0
        ? `${protocol?.id ?? 'the card'} carries no post-dispatch instructions`
        : `${readBack.length} of ${postDispatch.length} read`,
      readBack.slice(0, 4),
    ),
  );

  const count = (s: AxisStatus) => axes.filter((a) => a.status === s).length;
  const allUnparsed = [
    ...unparsedIn('case_entry'),
    ...unparsedIn('key_questions'),
    ...unparsedIn('instructions'),
  ];
  const askedTotal = d.asked.length;
  const answeredTotal = askedTotal - allUnparsed.length;
  return {
    packId: pack.id,
    locale,
    protocolId: result.protocolId,
    determinantId: result.determinantId,
    response: result.response,
    axes,
    information: {
      asked: askedTotal,
      answered: answeredTotal,
      unparsed: allUnparsed,
      unknown: [...result.unknowns],
      rate: askedTotal ? answeredTotal / askedTotal : 0,
    },
    clarifies: d.clarifies,
    utterances: d.spoken.length,
    summary: {
      pass: count('pass'),
      partial: count('partial'),
      fail: count('fail'),
      notApplicable: count('n/a'),
    },
  };
}
