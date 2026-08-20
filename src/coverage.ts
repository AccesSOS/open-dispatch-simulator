import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ProtocolPack, Question } from './types.js';

const schemaPath = fileURLToPath(new URL('../schema/rubric.schema.json', import.meta.url));
const ajv = new Ajv2020({ allErrors: true, formats: { date: true } });
const validateSchema = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));

export type RequirementScope = 'pack' | 'program';
export type Status = 'met' | 'partial' | 'unmet' | 'n/a';

export interface Check {
  kind:
    | 'caseEntry'
    | 'caseEntryOrder'
    | 'protocolSelector'
    | 'keyQuestions'
    | 'postDispatch'
    | 'responseLevels'
    | 'text'
    | 'cardJump'
    | 'complaints'
    | 'notRepresentable'
    | 'manual';
  slot?: string;
  firstSlot?: string;
  thenSlot?: string;
  min?: number;
  minProtocols?: 'all' | number;
  minSteps?: number;
  patterns?: string[];
  textScope?: 'postDispatch' | 'questions' | 'all';
  taxonomy?: string;
  note?: string;
}

export interface Requirement {
  id: string;
  citation: string;
  text: string;
  appliesTo: RequirementScope;
  notes?: string;
  check: Check;
}

export interface TaxonomyEntry {
  id: string;
  name: string;
  group?: string;
  patterns: string[];
}

export interface Taxonomy {
  name: string;
  citation?: string;
  entries: TaxonomyEntry[];
}

export interface Rubric {
  schemaVersion: '0.1';
  id: string;
  name: string;
  scope?: string;
  authority: { jurisdiction?: string; instrument: string; adopted?: string };
  provenance: { source: string; url?: string; license: string; retrieved?: string; notes?: string };
  taxonomies?: Record<string, Taxonomy>;
  requirements: Requirement[];
}

export class RubricValidationError extends Error {
  constructor(ref: string, public readonly problems: string[]) {
    super(`Invalid rubric (${ref}):\n  - ${problems.join('\n  - ')}`);
    this.name = 'RubricValidationError';
  }
}

export function loadRubric(data: unknown, ref = 'inline'): Rubric {
  if (!validateSchema(data)) {
    throw new RubricValidationError(
      ref,
      (validateSchema.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`),
    );
  }
  const rubric = data as Rubric;
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const r of rubric.requirements) {
    if (ids.has(r.id)) problems.push(`duplicate requirement id "${r.id}"`);
    ids.add(r.id);
    for (const p of [r.check.slot, r.check.firstSlot, r.check.thenSlot, ...(r.check.patterns ?? [])]) {
      if (p === undefined) continue;
      try {
        new RegExp(p, 'i');
      } catch {
        problems.push(`${r.id}: invalid regex ${JSON.stringify(p)}`);
      }
    }
    if (r.check.kind === 'complaints' && !r.check.taxonomy) {
      problems.push(`${r.id}: complaints check needs a taxonomy reference`);
    }
  }
  for (const [key, tax] of Object.entries(rubric.taxonomies ?? {})) {
    for (const e of tax.entries) {
      for (const p of e.patterns) {
        try {
          new RegExp(p, 'i');
        } catch {
          problems.push(`taxonomy ${key}/${e.id}: invalid regex ${JSON.stringify(p)}`);
        }
      }
    }
  }
  if (problems.length) throw new RubricValidationError(ref, problems);
  return rubric;
}

export function loadRubricFromFile(path: string): Rubric {
  return loadRubric(JSON.parse(readFileSync(path, 'utf8')), path);
}

export interface RequirementResult {
  id: string;
  citation: string;
  text: string;
  appliesTo: RequirementScope;
  notes?: string | undefined;
  status: Status;
  /** Where in the pack the requirement was (or was not) satisfied — auditable by hand. */
  evidence: string[];
  detail?: string | undefined;
}

export interface CoverageReport {
  packId: string;
  packName: string;
  locales: string[];
  rubricId: string;
  rubricName: string;
  citation: string;
  results: RequirementResult[];
  summary: {
    scored: number;
    met: number;
    partial: number;
    unmet: number;
    programScope: number;
    /** Fully-met share of scored (pack-scope) requirements, 0..1. */
    metRate: number;
  };
}

/** Every utterance in the pack, tagged with where it came from. */
interface Utterance {
  stringId: string;
  locale: string;
  text: string;
  from: 'postDispatch' | 'questions' | 'other';
}

function allQuestions(pack: ProtocolPack): Question[] {
  return [...pack.caseEntry, ...pack.protocols.flatMap((p) => p.keyQuestions)];
}

function utterances(pack: ProtocolPack): Utterance[] {
  const postDispatchIds = new Set(pack.protocols.flatMap((p) => p.postDispatch));
  const questionIds = new Set<string>();
  for (const q of allQuestions(pack)) {
    questionIds.add(q.stringId);
    if (q.confirmStringId) questionIds.add(q.confirmStringId);
  }
  const out: Utterance[] = [];
  for (const locale of pack.locales) {
    for (const [stringId, template] of Object.entries(pack.strings[locale] ?? {})) {
      const from = postDispatchIds.has(stringId)
        ? 'postDispatch'
        : questionIds.has(stringId)
          ? 'questions'
          : 'other';
      for (const text of Array.isArray(template) ? template : [template]) {
        out.push({ stringId, locale, text, from });
      }
    }
  }
  return out;
}

const rx = (p: string) => new RegExp(p, 'i');

/**
 * Classify a pack's protocols against a taxonomy of complaint types — the
 * shared vocabulary that lets two packs from different jurisdictions be lined
 * up card for card. Each entry keeps the protocol matching the most of its
 * patterns (ties broken by pack order), so the answer is the card a reader
 * would name, and is stable across runs.
 */
export function matchTaxonomy(
  pack: ProtocolPack,
  tax: Taxonomy,
): { covered: Map<string, string>; gaps: string[] } {
  const haystacks = pack.protocols.map((p) => ({
    id: p.id,
    text: [...Object.values(p.name), ...Object.values(p.keywords).flat()].join(' | '),
  }));
  const covered = new Map<string, string>();
  const gaps: string[] = [];
  for (const entry of tax.entries) {
    let best: { id: string; score: number } | null = null;
    for (const h of haystacks) {
      const score = entry.patterns.filter((p) => rx(p).test(h.text)).length;
      if (score > (best?.score ?? 0)) best = { id: h.id, score };
    }
    if (best) covered.set(entry.id, best.id);
    else gaps.push(entry.id);
  }
  return { covered, gaps };
}

interface CheckOutcome {
  status: Status;
  evidence: string[];
  detail?: string | undefined;
}

function evaluateCheck(
  check: Check,
  pack: ProtocolPack,
  rubric: Rubric,
  rubrics: Map<string, Rubric>,
): CheckOutcome {
  switch (check.kind) {
    case 'manual':
      return { status: 'n/a', evidence: [], detail: check.note };

    case 'notRepresentable':
      return { status: 'unmet', evidence: [], detail: check.note };

    case 'caseEntry': {
      const pattern = check.slot ? rx(check.slot) : null;
      const hits = pack.caseEntry.filter(
        (q) => !pattern || pattern.test(q.slot) || pattern.test(q.id),
      );
      const min = check.min ?? 1;
      return {
        status: hits.length >= min ? 'met' : hits.length ? 'partial' : 'unmet',
        evidence: hits.map((q) => `caseEntry:${q.id} (slot ${q.slot})`),
      };
    }

    case 'caseEntryOrder': {
      const first = rx(check.firstSlot ?? '.');
      const then = rx(check.thenSlot ?? '.');
      const idx = (r: RegExp) => pack.caseEntry.findIndex((q) => r.test(q.slot) || r.test(q.id));
      const a = idx(first);
      const b = idx(then);
      const qa = pack.caseEntry[a];
      const qb = pack.caseEntry[b];
      if (a < 0 || b < 0 || !qa || !qb) {
        return {
          status: 'unmet',
          evidence: [],
          detail: a < 0 ? 'no question matches the first slot' : 'no question matches the later slot',
        };
      }
      return {
        status: a < b ? 'met' : 'unmet',
        evidence: [`caseEntry:${qa.id} at #${a + 1}`, `caseEntry:${qb.id} at #${b + 1}`],
        detail: a < b ? undefined : 'asked in the reverse order',
      };
    }

    case 'protocolSelector': {
      const hits = pack.caseEntry.filter((q) => q.selectsProtocol);
      return {
        status: hits.length ? 'met' : 'unmet',
        evidence: hits.map((q) => `caseEntry:${q.id} selects the protocol`),
      };
    }

    case 'keyQuestions': {
      const withSection = pack.protocols.filter((p) => p.keyQuestions.length > 0);
      const need = check.minProtocols === 'all' || check.minProtocols === undefined
        ? pack.protocols.length
        : check.minProtocols;
      return {
        status: withSection.length >= need ? 'met' : withSection.length ? 'partial' : 'unmet',
        evidence: [`${withSection.length}/${pack.protocols.length} protocols carry key questions`],
        detail: withSection.length >= need
          ? undefined
          : `missing on ${pack.protocols
              .filter((p) => !p.keyQuestions.length)
              .map((p) => p.id)
              .join(', ')}`,
      };
    }

    case 'postDispatch': {
      const withSection = pack.protocols.filter((p) => p.postDispatch.length > 0);
      if (check.minSteps) {
        const scripted = pack.protocols.filter((p) => p.postDispatch.length >= check.minSteps!);
        return {
          status: scripted.length ? 'met' : 'unmet',
          evidence: scripted.map((p) => `${p.id}: ${p.postDispatch.length} ordered steps`),
          detail: scripted.length
            ? undefined
            : `no protocol carries ${check.minSteps} or more ordered instruction steps`,
        };
      }
      const need = check.minProtocols === 'all' || check.minProtocols === undefined
        ? pack.protocols.length
        : check.minProtocols;
      return {
        status: withSection.length >= need ? 'met' : withSection.length ? 'partial' : 'unmet',
        evidence: [`${withSection.length}/${pack.protocols.length} protocols carry post-dispatch instructions`],
        detail: withSection.length >= need
          ? undefined
          : `missing on ${pack.protocols
              .filter((p) => !p.postDispatch.length)
              .map((p) => p.id)
              .join(', ')}`,
      };
    }

    case 'responseLevels': {
      const levels = [...new Set(pack.protocols.flatMap((p) => p.determinants.map((d) => d.response)))];
      const min = check.min ?? 2;
      return {
        status: levels.length >= min ? 'met' : levels.length ? 'partial' : 'unmet',
        evidence: [`response levels: ${levels.join(', ')}`],
      };
    }

    case 'text': {
      const scope = check.textScope ?? 'all';
      const pool = utterances(pack).filter((u) => scope === 'all' || u.from === scope);
      const evidence: string[] = [];
      const missed: string[] = [];
      for (const p of check.patterns ?? []) {
        const hits = pool.filter((u) => rx(p).test(u.text));
        const hit = hits[0];
        if (hit) {
          const more = hits.length > 1 ? ` +${hits.length - 1} more` : '';
          evidence.push(`/${p}/ → ${hit.stringId} (${hit.locale})${more}`);
        } else missed.push(`/${p}/`);
      }
      const total = (check.patterns ?? []).length;
      return {
        status: evidence.length === total ? 'met' : evidence.length ? 'partial' : 'unmet',
        evidence,
        detail: missed.length ? `no match for ${missed.join(', ')}` : undefined,
      };
    }

    case 'cardJump': {
      const jumps: string[] = [];
      for (const q of allQuestions(pack)) {
        for (const e of q.next ?? []) {
          if (e.gotoProtocol) jumps.push(`${q.id} → ${e.gotoProtocol}`);
        }
      }
      return {
        status: jumps.length ? 'met' : 'unmet',
        evidence: jumps,
        detail: jumps.length ? undefined : 'no protocol-to-protocol jumps declared',
      };
    }

    case 'complaints': {
      const [rubricId = '', key = ''] = (check.taxonomy ?? '').split('#');
      const source = rubricId === rubric.id ? rubric : rubrics.get(rubricId);
      const tax = source?.taxonomies?.[key];
      if (!tax) {
        return { status: 'unmet', evidence: [], detail: `taxonomy ${check.taxonomy} not loaded` };
      }
      const { covered, gaps } = matchTaxonomy(pack, tax);
      const min = check.min ?? tax.entries.length;
      const lines = [...covered].map(([entryId, protocolId]) => `${entryId} → ${protocolId}`);
      return {
        status: covered.size >= min ? 'met' : covered.size ? 'partial' : 'unmet',
        evidence: [`${covered.size}/${tax.entries.length} ${tax.name}`, ...lines],
        detail: gaps.length ? `not covered: ${gaps.join(', ')}` : undefined,
      };
    }
  }
}

/**
 * Score one pack against one rubric. Every result carries the evidence that
 * produced it, so a reader can check the tool's work against the pack by hand —
 * a coverage claim nobody can audit is worth nothing.
 *
 * `rubrics` supplies any other loaded rubrics whose taxonomies this one cites.
 */
export function coverage(
  pack: ProtocolPack,
  rubric: Rubric,
  rubrics: Iterable<Rubric> = [],
): CoverageReport {
  const byId = new Map<string, Rubric>();
  for (const r of rubrics) byId.set(r.id, r);
  byId.set(rubric.id, rubric);

  const results: RequirementResult[] = rubric.requirements.map((req) => {
    const { status, evidence, detail } = req.appliesTo === 'program'
      ? { status: 'n/a' as Status, evidence: [], detail: req.check.note }
      : evaluateCheck(req.check, pack, rubric, byId);
    return {
      id: req.id,
      citation: req.citation,
      text: req.text,
      appliesTo: req.appliesTo,
      notes: req.notes,
      status,
      evidence,
      detail,
    };
  });

  const scoredResults = results.filter((r) => r.appliesTo === 'pack');
  const count = (s: Status) => scoredResults.filter((r) => r.status === s).length;
  const met = count('met');
  return {
    packId: pack.id,
    packName: pack.name[pack.defaultLocale] ?? pack.id,
    locales: pack.locales,
    rubricId: rubric.id,
    rubricName: rubric.name,
    citation: rubric.authority.instrument,
    results,
    summary: {
      scored: scoredResults.length,
      met,
      partial: count('partial'),
      unmet: count('unmet'),
      programScope: results.length - scoredResults.length,
      metRate: scoredResults.length ? met / scoredResults.length : 0,
    },
  };
}
