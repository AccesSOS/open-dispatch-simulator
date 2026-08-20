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

export interface Edge {
  whenOption?: string;
  /** A question id within the same protocol, or '$determine'. */
  goto: string;
}

export interface Question {
  id: string;
  slot: string;
  stringId: string;
  selectsProtocol?: boolean;
  expect?: Expectation;
  next?: Edge[];
}

export interface DeterminantRule {
  id: string;
  when?: { slot: string; option: string }[];
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
  strings: Record<Locale, Record<string, string>>;
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
  | { type: 'protocol_selected'; protocolId: string; via: 'keywords' | 'fallback' }
  | { type: 'edge'; from: string; to: string }
  | {
      type: 'determinant';
      nodeId: string;
      protocolId: string;
      determinantId: string;
      response: string;
    }
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
  transcript: { role: 'dispatcher' | 'caller'; text: string }[];
}
