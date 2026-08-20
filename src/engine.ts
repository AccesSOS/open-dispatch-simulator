import { determineNodeId, keyQuestionNodeId } from './graph.js';
import type {
  Condition,
  Locale,
  Persona,
  Phase,
  Protocol,
  ProtocolPack,
  Question,
  SessionEvent,
  SessionResult,
  Utterance,
} from './types.js';

/** Keyword matching on word boundaries (Unicode-aware): the keyword "no"
 * matches "no, he isn't" but never "not" or "know"; phrases like
 * "not breathing" match as whole-word sequences. */
const normalize = (s: string): string =>
  ' ' + s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
const containsKeyword = (text: string, keyword: string): boolean =>
  normalize(text).includes(normalize(keyword));

/** Small deterministic PRNG (mulberry32) so persona behavior is reproducible. */
const mulberry32 = (seed: number) => (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export interface SessionOptions {
  locale?: Locale;
  /** Live narration of the session's walk through the decision tree —
   * nodeIds match packGraph(), so visualizers can animate the call. */
  onEvent?: (event: SessionEvent) => void;
  /** How many times an unmatched answer to a choice question is met with a
   * clarify-and-re-ask before the dispatcher moves on (default 1).
   * persona.clarifyAttempts takes precedence when both are set. */
  clarifyAttempts?: number;
  /** Behavioral profile of this dispatcher (seeded, reproducible). */
  persona?: Persona;
}

/**
 * One simulated emergency call, driven turn-by-turn from the dispatcher's
 * side. Structurally grounded: every utterance is rendered from the pack's
 * string catalog for the active locale — the engine has no other way to
 * produce text, so it cannot say anything the loaded playbook does not say.
 *
 * SIMULATION ONLY. Not certified for live emergency call-taking.
 */
export class DispatchSession {
  readonly locale: Locale;
  private phase: Phase = 'idle';
  private readonly answers: Record<string, string> = {};
  private readonly choices: Record<string, string> = {};
  private readonly numbers: Record<string, number> = {};
  private readonly transcript: { role: 'dispatcher' | 'caller'; text: string }[] = [];
  private protocol: Protocol | null = null;
  private determinantId: string | null = null;
  private response: string | null = null;
  private queue: Question[] = [];
  private current: Question | null = null;

  private readonly onEvent: ((event: SessionEvent) => void) | undefined;
  private readonly clarifyAttempts: number;
  private readonly confirmRate: number;
  private readonly rng: () => number;
  private clarifies = 0;

  constructor(private readonly pack: ProtocolPack, options: SessionOptions = {}) {
    this.locale = options.locale ?? pack.defaultLocale;
    this.onEvent = options.onEvent;
    this.clarifyAttempts = options.persona?.clarifyAttempts ?? options.clarifyAttempts ?? 1;
    this.confirmRate = options.persona?.confirmRate ?? 0;
    this.rng = mulberry32(options.persona?.seed ?? 1);
    if (!pack.locales.includes(this.locale)) {
      throw new Error(`Pack "${pack.id}" does not support locale "${this.locale}"`);
    }
  }

  /** Open the call: greeting plus the first case-entry question. */
  start(): Utterance[] {
    if (this.phase !== 'idle') throw new Error('Session already started');
    this.phase = 'case_entry';
    this.emit({ type: 'phase', phase: 'case_entry' });
    this.queue = [...this.pack.caseEntry];
    const out = [this.say('greeting')];
    out.push(...this.advance());
    return out;
  }

  /** Feed the caller's reply; returns the dispatcher's next utterances. */
  answer(text: string): Utterance[] {
    if (this.phase !== 'case_entry' && this.phase !== 'key_questions') {
      throw new Error(`Cannot answer in phase "${this.phase}"`);
    }
    const q = this.current;
    if (!q) throw new Error('No question is pending');
    this.transcript.push({ role: 'caller', text });
    if (q.expect) {
      const matched = this.matchOption(q, text);
      if (!matched && this.clarifies < this.clarifyAttempts) {
        // A real dispatcher doesn't shrug at an unintelligible yes/no answer:
        // clarify and re-ask, then move on if it still doesn't parse.
        this.clarifies++;
        this.emit({ type: 'clarify', nodeId: this.nodeIdFor(q), questionId: q.id, attempt: this.clarifies });
        return [this.say('clarify'), this.say(q.stringId)];
      }
      if (matched) this.choices[q.slot] = matched;
    }
    this.clarifies = 0;
    this.answers[q.slot] = text;
    if (q.extract === 'number') {
      const m = text.match(/-?\d+(?:[.,]\d+)?/);
      if (m) this.numbers[q.slot] = Number(m[0].replace(',', '.'));
    }
    this.emit({
      type: 'answer',
      nodeId: this.nodeIdFor(q),
      questionId: q.id,
      slot: q.slot,
      text,
      option: this.choices[q.slot] ?? null,
    });
    // Persona read-back: "Okay, {address}." Only consumes randomness when the
    // question offers a confirm and the persona ever confirms, so default
    // sessions stay bit-identical across persona-less runs.
    const confirm =
      q.confirmStringId && this.confirmRate > 0 && this.rng() < this.confirmRate
        ? [this.say(q.confirmStringId)]
        : [];
    if (q.selectsProtocol) this.protocol = this.selectProtocol(text);

    // Conditional edges override sequential flow. Evaluated in pack order;
    // an edge with neither whenOption nor when is the default.
    const edge = q.next?.find(
      (e) =>
        (e.whenOption === undefined || e.whenOption === this.choices[q.slot]) &&
        (e.when ?? []).every((c) => this.condHolds(c)),
    );
    if (edge) {
      if (edge.gotoProtocol) {
        // "Go to the C1 card": the target protocol takes over the call.
        const target = this.mustProtocol(edge.gotoProtocol);
        this.emit({
          type: 'edge',
          from: this.nodeIdFor(q),
          to: target.keyQuestions[0]
            ? keyQuestionNodeId(target.id, target.keyQuestions[0])
            : determineNodeId(target.id),
        });
        this.protocol = target;
        this.emit({ type: 'protocol_selected', protocolId: target.id, via: 'jump' });
        if (this.phase === 'case_entry') {
          this.phase = 'key_questions';
          this.emit({ type: 'phase', phase: 'key_questions' });
        }
        this.queue = [...target.keyQuestions];
        return [...confirm, ...this.advance()];
      }
      if (edge.goto === '$determine') {
        this.emit({
          type: 'edge',
          from: this.nodeIdFor(q),
          to: this.protocol ? determineNodeId(this.protocol.id) : '$dispatch',
        });
        return [...confirm, ...this.determine()];
      }
      const target = this.protocol?.keyQuestions.find((n) => n.id === edge.goto);
      if (!target) throw new Error(`Edge target "${edge.goto}" not found`); // loader prevents this
      this.emit({ type: 'edge', from: this.nodeIdFor(q), to: this.nodeIdFor(target) });
      this.queue = this.queueFrom(target);
    }
    return [...confirm, ...this.advance()];
  }

  isDone(): boolean {
    return this.phase === 'done';
  }

  /** The question awaiting an answer, or null (call not started / complete). */
  pending(): { questionId: string; slot: string; protocolId: string | null } | null {
    const q = this.current;
    if (!q) return null;
    return {
      questionId: q.id,
      slot: q.slot,
      protocolId: this.phase === 'key_questions' ? this.protocol?.id ?? null : null,
    };
  }

  result(): SessionResult {
    return {
      protocolId: this.protocol?.id ?? null,
      determinantId: this.determinantId,
      response: this.response,
      answers: { ...this.answers },
      choices: { ...this.choices },
      numbers: { ...this.numbers },
      transcript: [...this.transcript],
    };
  }

  /** Evaluate a choice or numeric condition against collected state. A
   * numeric condition never matches when no number was captured. */
  private condHolds(c: Condition): boolean {
    if ('option' in c) return this.choices[c.slot] === c.option;
    const v = this.numbers[c.slot];
    if (v === undefined) return false;
    if (c.gt !== undefined && !(v > c.gt)) return false;
    if (c.gte !== undefined && !(v >= c.gte)) return false;
    if (c.lt !== undefined && !(v < c.lt)) return false;
    if (c.lte !== undefined && !(v <= c.lte)) return false;
    return true;
  }

  // --- internals ---

  /** Resume sequential flow at `target` within the current protocol. */
  private queueFrom(target: Question): Question[] {
    const nodes = this.protocol?.keyQuestions ?? [];
    return nodes.slice(nodes.indexOf(target));
  }

  /** Ask the next queued question, or move phases when a queue empties. */
  private advance(): Utterance[] {
    const next = this.queue.shift();
    if (next) {
      this.current = next;
      const out = [this.say(next.stringId)];
      this.emit({
        type: 'ask',
        nodeId: this.nodeIdFor(next),
        questionId: next.id,
        slot: next.slot,
        protocolId: this.phase === 'key_questions' ? this.protocol?.id ?? null : null,
      });
      return out;
    }
    this.current = null;
    if (this.phase === 'case_entry') {
      this.phase = 'key_questions';
      this.emit({ type: 'phase', phase: 'key_questions' });
      this.protocol ??= this.mustProtocol(this.pack.fallbackProtocol);
      this.queue = [...this.protocol.keyQuestions];
      return this.advance();
    }
    return this.determine();
  }

  /** Pick the determinant, confirm dispatch, read post-dispatch instructions. */
  private determine(): Utterance[] {
    const protocol = this.protocol ?? this.mustProtocol(this.pack.fallbackProtocol);
    const rule =
      protocol.determinants.find((r) => (r.when ?? []).every((c) => this.condHolds(c))) ??
      protocol.determinants[protocol.determinants.length - 1]!;
    this.determinantId = rule.id;
    this.response = rule.response;
    this.phase = 'done';
    this.current = null;
    this.emit({
      type: 'determinant',
      nodeId: determineNodeId(protocol.id),
      protocolId: protocol.id,
      determinantId: rule.id,
      response: rule.response,
    });
    this.emit({ type: 'phase', phase: 'done' });
    return [
      this.say('dispatch_confirm'),
      ...protocol.postDispatch.map((id) => this.say(id)),
      this.say('closing'),
    ];
  }

  /** Render a template from the active locale's catalog. Grounding guard:
   * unknown ids and unfilled slots throw rather than improvise. */
  private say(stringId: string): Utterance {
    const entry = this.pack.strings[this.locale]?.[stringId];
    if (entry === undefined) {
      throw new Error(`String "${stringId}" missing for locale "${this.locale}"`);
    }
    // Variant catalogs stay grounded: the persona only ever picks among the
    // pack's own equivalent phrasings.
    const template = Array.isArray(entry)
      ? entry.length > 1
        ? entry[Math.floor(this.rng() * entry.length)]!
        : entry[0]!
      : entry;
    const text = template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, slot: string) => {
      const value = this.answers[slot];
      if (value === undefined) throw new Error(`Slot "{${slot}}" not yet collected for "${stringId}"`);
      return value;
    });
    const utterance: Utterance = { role: 'dispatcher', stringId, text };
    this.transcript.push({ role: 'dispatcher', text });
    this.emit({ type: 'utterance', stringId, text });
    return utterance;
  }

  private emit(event: SessionEvent): void {
    this.onEvent?.(event);
  }

  /** Graph node id for a question in the current phase (matches packGraph). */
  private nodeIdFor(q: Question): string {
    return this.phase === 'case_entry' || !this.protocol
      ? q.id
      : keyQuestionNodeId(this.protocol.id, q);
  }

  private matchOption(q: Question, text: string): string | undefined {
    for (const option of q.expect?.options ?? []) {
      const keywords = option.keywords[this.locale] ?? [];
      if (keywords.some((k) => containsKeyword(text, k))) return option.id;
    }
    return undefined;
  }

  private selectProtocol(complaint: string): Protocol {
    for (const p of this.pack.protocols) {
      const keywords = p.keywords[this.locale] ?? [];
      if (keywords.some((k) => containsKeyword(complaint, k))) {
        this.emit({ type: 'protocol_selected', protocolId: p.id, via: 'keywords' });
        return p;
      }
    }
    const fallback = this.mustProtocol(this.pack.fallbackProtocol);
    this.emit({ type: 'protocol_selected', protocolId: fallback.id, via: 'fallback' });
    return fallback;
  }

  private mustProtocol(id: string): Protocol {
    const p = this.pack.protocols.find((x) => x.id === id);
    if (!p) throw new Error(`Protocol "${id}" not found`); // loader prevents this
    return p;
  }
}
