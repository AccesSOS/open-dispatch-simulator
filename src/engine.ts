import { determineNodeId, keyQuestionNodeId } from './graph.js';
import type {
  Locale,
  Phase,
  Protocol,
  ProtocolPack,
  Question,
  SessionEvent,
  SessionResult,
  Utterance,
} from './types.js';

export interface SessionOptions {
  locale?: Locale;
  /** Live narration of the session's walk through the decision tree —
   * nodeIds match packGraph(), so visualizers can animate the call. */
  onEvent?: (event: SessionEvent) => void;
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
  private readonly transcript: { role: 'dispatcher' | 'caller'; text: string }[] = [];
  private protocol: Protocol | null = null;
  private determinantId: string | null = null;
  private response: string | null = null;
  private queue: Question[] = [];
  private current: Question | null = null;

  private readonly onEvent: ((event: SessionEvent) => void) | undefined;

  constructor(private readonly pack: ProtocolPack, options: SessionOptions = {}) {
    this.locale = options.locale ?? pack.defaultLocale;
    this.onEvent = options.onEvent;
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
    this.answers[q.slot] = text;
    if (q.expect) {
      const matched = this.matchOption(q, text);
      if (matched) this.choices[q.slot] = matched;
    }
    this.emit({
      type: 'answer',
      nodeId: this.nodeIdFor(q),
      questionId: q.id,
      slot: q.slot,
      text,
      option: this.choices[q.slot] ?? null,
    });
    if (q.selectsProtocol) this.protocol = this.selectProtocol(text);

    // Conditional edges override sequential flow.
    const edge =
      q.next?.find((e) => e.whenOption !== undefined && e.whenOption === this.choices[q.slot]) ??
      q.next?.find((e) => e.whenOption === undefined);
    if (edge) {
      if (edge.goto === '$determine') {
        this.emit({
          type: 'edge',
          from: this.nodeIdFor(q),
          to: this.protocol ? determineNodeId(this.protocol.id) : '$dispatch',
        });
        return this.determine();
      }
      const target = this.protocol?.keyQuestions.find((n) => n.id === edge.goto);
      if (!target) throw new Error(`Edge target "${edge.goto}" not found`); // loader prevents this
      this.emit({ type: 'edge', from: this.nodeIdFor(q), to: this.nodeIdFor(target) });
      this.queue = this.queueFrom(target);
    }
    return this.advance();
  }

  isDone(): boolean {
    return this.phase === 'done';
  }

  result(): SessionResult {
    return {
      protocolId: this.protocol?.id ?? null,
      determinantId: this.determinantId,
      response: this.response,
      answers: { ...this.answers },
      choices: { ...this.choices },
      transcript: [...this.transcript],
    };
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
      protocol.determinants.find((r) =>
        (r.when ?? []).every((c) => this.choices[c.slot] === c.option),
      ) ?? protocol.determinants[protocol.determinants.length - 1]!;
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
    const template = this.pack.strings[this.locale]?.[stringId];
    if (template === undefined) {
      throw new Error(`String "${stringId}" missing for locale "${this.locale}"`);
    }
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
    const normalized = text.toLowerCase();
    for (const option of q.expect?.options ?? []) {
      const keywords = option.keywords[this.locale] ?? [];
      if (keywords.some((k) => normalized.includes(k.toLowerCase()))) return option.id;
    }
    return undefined;
  }

  private selectProtocol(complaint: string): Protocol {
    const normalized = complaint.toLowerCase();
    for (const p of this.pack.protocols) {
      const keywords = p.keywords[this.locale] ?? [];
      if (keywords.some((k) => normalized.includes(k.toLowerCase()))) {
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
