/** Types mirroring schema/pack.schema.json (v0.1). */

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
  /** v0.2: structurally extract the first number in the answer for numeric conditions. */
  extract?: 'number';
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

export interface Protocol {
  id: string;
  name: LocalizedText;
  keywords: LocalizedKeywords;
  keyQuestions: Question[];
  determinants: DeterminantRule[];
  postDispatch: string[];
}

export interface ProtocolPack {
  schemaVersion: '0.1';
  id: string;
  name: LocalizedText;
  jurisdiction: Jurisdiction;
  provenance: Provenance;
  locales: Locale[];
  defaultLocale: Locale;
  caseEntry: Question[];
  protocols: Protocol[];
  fallbackProtocol: string;
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

export type Phase = 'idle' | 'case_entry' | 'key_questions' | 'done';

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
  | { type: 'utterance'; stringId: string; text: string };

/** A pack rendered as a graph for visualization. */
export interface GraphNode {
  id: string;
  kind: 'case_entry' | 'key_question' | 'determine' | 'dispatch';
  protocolId?: string;
  questionId?: string;
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
  /** Numbers captured by extract: 'number' questions. */
  numbers: Record<string, number>;
  transcript: { role: 'dispatcher' | 'caller'; text: string }[];
}
