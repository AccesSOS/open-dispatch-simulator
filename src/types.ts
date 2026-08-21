/** Types mirroring schema/pack.schema.json (v0.4). */

import type { ExtractKind } from './extract.js';
import type { Lexicon } from './lexicon.js';

export type { ExtractKind, Lexicon };

export type Locale = string;

export type LocalizedText = Record<Locale, string>;
export type LocalizedKeywords = Record<Locale, string[]>;

export interface Jurisdiction {
  country: string;
  region?: string;
  emergencyNumber: string;
}

export interface Provenance {
  source: string;
  url?: string;
  license: string;
  digitizedDate?: string;
  notes?: string;
}

export interface ChoiceOption {
  id: string;
  keywords: LocalizedKeywords;
}

export interface Expectation {
  type: 'choice';
  options: ChoiceOption[];
}

/** Choice condition on a slot's answered option, or numeric condition on a
 * slot whose question declares extract: 'number'. */
export type Condition =
  | { slot: string; option: string }
  | { slot: string; gt?: number; gte?: number; lt?: number; lte?: number };

export interface Edge {
  whenOption?: string;
  /** v0.2: extra conditions on previously collected slots; all must hold. */
  when?: Condition[];
  /** A question id within the same protocol, or '$determine'. */
  goto?: string;
  /** v0.2: jump to another protocol's key questions ("go to the C1 card"). */
  gotoProtocol?: string;
}

export interface Question {
  id: string;
  slot: string;
  stringId: string;
  selectsProtocol?: boolean;
  /** Optional read-back a persona may speak after the answer ("Okay, {address}."). */
  confirmStringId?: string;
  /** Pull a value out of the answer rather than keeping the whole sentence.
   * v0.2: 'number'. v0.4: 'age' (unit-aware), 'count', 'address', 'phone'. */
  extract?: ExtractKind;
  expect?: Expectation;
  next?: Edge[];
}

/** A catalog entry: one template, or equivalent variants a persona picks from. */
export type StringTemplate = string | string[];

export interface DeterminantRule {
  id: string;
  when?: Condition[];
  response: string;
}

/** v0.3: an edge inside an instruction script. */
export interface ScriptEdge {
  whenOption?: string;
  when?: Condition[];
  /** A step id within the same script, or '$end'. */
  goto?: string;
  /** Hand off to another script ("jump to I1: AED Instructions"). */
  gotoScript?: string;
}

/**
 * v0.3: one line of an interactive instruction script. `say` reads and moves
 * on; `ask` captures the caller's answer and branches on it; `stay` is the
 * terminal line the dispatcher holds on ("keep doing it until help arrives").
 */
export interface ScriptStep {
  id: string;
  kind: 'say' | 'ask' | 'stay';
  stringId: string;
  slot?: string;
  expect?: Expectation;
  next?: ScriptEdge[];
}

/**
 * v0.3: a telephone procedure the dispatcher reads out and steers by the
 * caller's answers — CPR, choking, childbirth, AED. Scripts form a DAG (the
 * loader rejects cycles), so every run terminates.
 */
export interface InstructionScript {
  id: string;
  name: LocalizedText;
  /** The card this digitizes, e.g. "I2: Adult CPR Instructions". */
  source?: string;
  steps: ScriptStep[];
}

/** v0.3: which script a card hands off to, and when. First match wins. */
export interface PostDispatchScript {
  script: string;
  when?: Condition[];
}

/**
 * v0.3: content for the dispatcher that is never spoken — the cards' "Call
 * Taker Prompts", "Dispatcher Short Report" and "Useful Information". The
 * loader keeps these stringIds disjoint from everything the engine can say,
 * so the grounding contract stays a structural guarantee rather than a habit.
 */
export interface DispatcherNotes {
  prompts?: string[];
  shortReport?: string[];
  useful?: string[];
}

export interface Protocol {
  id: string;
  name: LocalizedText;
  keywords: LocalizedKeywords;
  keyQuestions: Question[];
  determinants: DeterminantRule[];
  postDispatch: string[];
  postDispatchScripts?: PostDispatchScript[];
  dispatcherNotes?: DispatcherNotes;
}

export interface ProtocolPack {
  schemaVersion: '0.1' | '0.2' | '0.3' | '0.4';
  id: string;
  name: LocalizedText;
  jurisdiction: Jurisdiction;
  provenance: Provenance;
  locales: Locale[];
  defaultLocale: Locale;
  caseEntry: Question[];
  protocols: Protocol[];
  fallbackProtocol: string;
  /** v0.4: per-locale extractor vocabulary, layered over the engine's tables. */
  lexicon?: Record<Locale, Lexicon>;
  scripts?: InstructionScript[];
  strings: Record<Locale, Record<string, StringTemplate>>;
}

/**
 * A dispatcher's behavioral profile. Real PSAPs vary; personas let one pack
 * simulate that range. Fully deterministic given the same seed, so eval runs
 * are reproducible.
 */
export interface Persona {
  /** Seeds phrasing-variant and confirmation choices (default 1). */
  seed?: number;
  /** Clarify-and-re-ask attempts for unparsed choice answers (default 1). */
  clarifyAttempts?: number;
  /** Probability (0..1) that a question with confirmStringId gets its answer
   * read back to the caller (default 0). */
  confirmRate?: number;
}

export interface Utterance {
  role: 'dispatcher';
  stringId: string;
  text: string;
}

export type Phase = 'idle' | 'case_entry' | 'key_questions' | 'instructions' | 'done';

/**
 * Live narration of a session's walk through the decision tree, for
 * visualizers, eval harnesses, and (later) voice bridges. `nodeId` values
 * match the ids produced by packGraph().
 */
export type SessionEvent =
  | { type: 'phase'; phase: Phase }
  | { type: 'ask'; nodeId: string; questionId: string; slot: string; protocolId: string | null }
  | {
      type: 'answer';
      nodeId: string;
      questionId: string;
      slot: string;
      text: string;
      option: string | null;
    }
  | { type: 'protocol_selected'; protocolId: string; via: 'keywords' | 'fallback' | 'jump' }
  | { type: 'edge'; from: string; to: string }
  | {
      type: 'determinant';
      nodeId: string;
      protocolId: string;
      determinantId: string;
      response: string;
    }
  | { type: 'clarify'; nodeId: string; questionId: string; attempt: number }
  | { type: 'script_entered'; scriptId: string; via: 'protocol' | 'jump' }
  | { type: 'script_step'; nodeId: string; scriptId: string; stepId: string; kind: ScriptStep['kind'] }
  | { type: 'utterance'; stringId: string; text: string };

/** A pack rendered as a graph for visualization. */
export interface GraphNode {
  id: string;
  kind: 'case_entry' | 'key_question' | 'determine' | 'dispatch' | 'script_step';
  protocolId?: string;
  scriptId?: string;
  questionId?: string;
  stepKind?: ScriptStep['kind'];
  slot?: string;
  stringId?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** Option id for conditional edges, or a protocol name for selection edges. */
  label?: string;
}

export interface PackGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SessionResult {
  protocolId: string | null;
  determinantId: string | null;
  response: string | null;
  answers: Record<string, string>;
  choices: Record<string, string>;
  /** Magnitudes captured by numeric extractors — an age is in years. */
  numbers: Record<string, number>;
  /** v0.4: values pulled out of the answers, for read-backs and templates. */
  values: Record<string, string>;
  /** Slots where the caller said, in so many words, that they do not know.
   * Distinct from an answer that simply did not parse. */
  unknowns: string[];
  /** v0.3: instruction scripts entered after dispatch, in order. */
  scripts: string[];
  transcript: { role: 'dispatcher' | 'caller'; text: string }[];
}
