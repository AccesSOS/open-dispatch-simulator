import type {
  Locale,
  Phase,
  Protocol,
  ProtocolPack,
  Question,
  SessionResult,
  Utterance,
} from './types.js';

export interface SessionOptions {
  locale?: Locale;
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

  constructor(private readonly pack: ProtocolPack, options: SessionOptions = {}) {
    this.locale = options.locale ?? pack.defaultLocale;
    if (!pack.locales.includes(this.locale)) {
      throw new Error(`Pack "${pack.id}" does not support locale "${this.locale}"`);
    }
  }

  /** Open the call: greeting plus the first case-entry question. */
  start(): Utterance[] {
    if (this.phase !== 'idle') throw new Error('Session already started');
    this.phase = 'case_entry';
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
    if (q.selectsProtocol) this.protocol = this.selectProtocol(text);

    // Conditional edges override sequential flow.
    const edge =
      q.next?.find((e) => e.whenOption !== undefined && e.whenOption === this.choices[q.slot]) ??
      q.next?.find((e) => e.whenOption === undefined);
    if (edge) {
      if (edge.goto === '$determine') return this.determine();
      const target = this.protocol?.keyQuestions.find((n) => n.id === edge.goto);
      if (!target) throw new Error(`Edge target "${edge.goto}" not found`); // loader prevents this
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
      return [this.say(next.stringId)];
    }
    this.current = null;
    if (this.phase === 'case_entry') {
      this.phase = 'key_questions';
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
    return utterance;
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
      if (keywords.some((k) => normalized.includes(k.toLowerCase()))) return p;
    }
    return this.mustProtocol(this.pack.fallbackProtocol);
  }

  private mustProtocol(id: string): Protocol {
    const p = this.pack.protocols.find((x) => x.id === id);
    if (!p) throw new Error(`Protocol "${id}" not found`); // loader prevents this
    return p;
  }
}
