import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { KIND_REQUIREMENTS, NUMERIC_KINDS } from './extract.js';
import { lexiconFor } from './lexicon.js';
import { containsKeyword } from './match.js';
import type { Condition, ExtractKind, ProtocolPack, Question } from './types.js';

const schemaPath = fileURLToPath(new URL('../schema/pack.schema.json', import.meta.url));

const ajv = new Ajv2020({ allErrors: true, formats: { date: true } });
const validateSchema = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));

/** Schema versions in order, so feature gates read "at least this version". */
const SCHEMA_VERSIONS = ['0.1', '0.2', '0.3', '0.4'] as const;
const atLeast = (declared: string, required: (typeof SCHEMA_VERSIONS)[number]): boolean =>
  SCHEMA_VERSIONS.indexOf(declared as (typeof SCHEMA_VERSIONS)[number]) >=
  SCHEMA_VERSIONS.indexOf(required);

/** Engine-required string ids that every locale catalog must define. */
export const REQUIRED_STRING_IDS = ['greeting', 'closing', 'dispatch_confirm', 'clarify'] as const;

export class PackValidationError extends Error {
  constructor(packRef: string, public readonly problems: string[]) {
    super(`Invalid protocol pack (${packRef}):\n  - ${problems.join('\n  - ')}`);
    this.name = 'PackValidationError';
  }
}

export function loadPackFromFile(path: string): ProtocolPack {
  return loadPack(JSON.parse(readFileSync(path, 'utf8')), path);
}

/**
 * Validate a pack against the JSON schema plus the referential rules the
 * schema alone cannot express. Throws PackValidationError listing every
 * problem found; a pack that loads is safe for the engine to execute.
 */
export function loadPack(data: unknown, packRef = 'inline'): ProtocolPack {
  if (!validateSchema(data)) {
    const problems = (validateSchema.errors ?? []).map(
      (e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`,
    );
    throw new PackValidationError(packRef, problems);
  }
  const pack = data as ProtocolPack;
  const problems: string[] = [];

  if (!pack.locales.includes(pack.defaultLocale)) {
    problems.push(`defaultLocale "${pack.defaultLocale}" is not in locales`);
  }

  // Collect every referenced stringId and slot.
  const stringIds = new Set<string>(REQUIRED_STRING_IDS);
  const slots = new Set<string>();
  const extractNumberSlots = new Set<string>();
  const extractors = new Map<string, ExtractKind>();
  const collectQuestion = (q: Question) => {
    stringIds.add(q.stringId);
    if (q.confirmStringId) stringIds.add(q.confirmStringId);
    slots.add(q.slot);
    if (q.extract) {
      extractors.set(q.id, q.extract);
      if (NUMERIC_KINDS.has(q.extract)) extractNumberSlots.add(q.slot);
    }
  };
  pack.caseEntry.forEach(collectQuestion);
  for (const p of pack.protocols) {
    p.keyQuestions.forEach(collectQuestion);
    p.postDispatch.forEach((id) => stringIds.add(id));
  }
  for (const script of pack.scripts ?? []) {
    for (const step of script.steps) {
      stringIds.add(step.stringId);
      if (step.slot) slots.add(step.slot);
    }
  }

  // v0.3 dispatcher-facing content. Kept in its own set: these strings must
  // exist in every locale like any other, but the engine must have no path to
  // speaking them, so they may never double as a spoken id.
  const noteStringIds = new Set<string>();
  for (const p of pack.protocols) {
    const notes = p.dispatcherNotes;
    if (!notes) continue;
    for (const id of [...(notes.prompts ?? []), ...(notes.shortReport ?? []), ...(notes.useful ?? [])]) {
      if (stringIds.has(id)) {
        problems.push(
          `protocol "${p.id}" dispatcherNotes string "${id}" is also spoken to the caller`,
        );
      }
      noteStringIds.add(id);
    }
  }

  // v0.4 extractors, and the vocabulary they need. A pack that asks for
  // word-aware extraction in a locale nothing covers is rejected rather than
  // quietly falling back to digits — the same posture as a missing string.
  const v04Kinds = [...extractors].filter(([, kind]) => kind !== 'number');
  if (!atLeast(pack.schemaVersion, '0.4') && v04Kinds.length) {
    for (const [id, kind] of v04Kinds) {
      problems.push(`question "${id}" extract: "${kind}" requires schemaVersion 0.4 (pack declares ${pack.schemaVersion})`);
    }
  }
  if (pack.lexicon && !atLeast(pack.schemaVersion, '0.4')) {
    problems.push(`lexicon requires schemaVersion 0.4 (pack declares ${pack.schemaVersion})`);
  }
  for (const [id, kind] of extractors) {
    for (const needed of KIND_REQUIREMENTS[kind]) {
      for (const locale of pack.locales) {
        const table = lexiconFor(locale, pack.lexicon)[needed];
        const empty = table === undefined || (Array.isArray(table) ? !table.length : !Object.keys(table).length);
        if (empty) {
          problems.push(
            `question "${id}" extract: "${kind}" needs lexicon.${needed} for locale "${locale}" — the engine ships none, so the pack must declare it`,
          );
        }
      }
    }
  }
  for (const locale of Object.keys(pack.lexicon ?? {})) {
    if (!pack.locales.includes(locale)) {
      problems.push(`lexicon declares locale "${locale}", which the pack does not`);
    }
  }

  // v0.3 features must not appear in a pack that declares an older schema:
  // an old engine reading them would silently skip the instructions.
  if (!atLeast(pack.schemaVersion, '0.3')) {
    if (pack.scripts?.length) problems.push(`scripts require schemaVersion 0.3 (pack declares ${pack.schemaVersion})`);
    for (const p of pack.protocols) {
      if (p.postDispatchScripts?.length) {
        problems.push(`protocol "${p.id}" postDispatchScripts requires schemaVersion 0.3`);
      }
      if (p.dispatcherNotes) {
        problems.push(`protocol "${p.id}" dispatcherNotes requires schemaVersion 0.3`);
      }
    }
  }

  // Every stringId must exist in every declared locale — the "grounded or
  // silent" property is enforced here, at load time, not at runtime.
  for (const locale of pack.locales) {
    const catalog = pack.strings[locale];
    if (!catalog) {
      problems.push(`missing string catalog for locale "${locale}"`);
      continue;
    }
    for (const id of [...stringIds, ...noteStringIds]) {
      if (catalog[id] === undefined) {
        problems.push(`locale "${locale}" is missing string "${id}"`);
      }
    }
    // Templates (every variant) may only interpolate declared slots.
    for (const [id, template] of Object.entries(catalog)) {
      const variants = Array.isArray(template) ? template : [template];
      if (variants.length === 0) problems.push(`locale "${locale}" string "${id}" has no variants`);
      for (const variant of variants) {
        for (const m of variant.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)) {
          if (!slots.has(m[1]!)) {
            problems.push(`locale "${locale}" string "${id}" interpolates unknown slot "{${m[1]}}"`);
          }
        }
      }
    }
  }

  // Per-locale coverage for name and keywords.
  for (const locale of pack.locales) {
    if (pack.name[locale] === undefined) problems.push(`pack name missing locale "${locale}"`);
  }

  // Protocol-level referential checks.
  const protocolIds = new Set(pack.protocols.map((p) => p.id));
  if (!protocolIds.has(pack.fallbackProtocol)) {
    problems.push(`fallbackProtocol "${pack.fallbackProtocol}" does not exist`);
  }
  if (!pack.caseEntry.some((q) => q.selectsProtocol)) {
    problems.push('no caseEntry question has selectsProtocol: true');
  }

  for (const p of pack.protocols) {
    for (const locale of pack.locales) {
      if (!p.keywords[locale]?.length && p.id !== pack.fallbackProtocol) {
        problems.push(`protocol "${p.id}" has no keywords for locale "${locale}"`);
      }
      if (p.name[locale] === undefined) {
        problems.push(`protocol "${p.id}" name missing locale "${locale}"`);
      }
    }
    const nodeIds = new Set(p.keyQuestions.map((q) => q.id));
    const optionIdsBySlot = new Map<string, Set<string>>();
    for (const q of [...pack.caseEntry, ...p.keyQuestions]) {
      if (q.expect) {
        optionIdsBySlot.set(q.slot, new Set(q.expect.options.map((o) => o.id)));
        for (const o of q.expect.options) {
          for (const locale of pack.locales) {
            if (!o.keywords[locale]?.length) {
              problems.push(
                `question "${q.id}" option "${o.id}" has no keywords for locale "${locale}"`,
              );
            }
          }
        }
      }
      for (const edge of q.next ?? []) {
        if ((edge.goto === undefined) === (edge.gotoProtocol === undefined)) {
          problems.push(`question "${q.id}" edge must have exactly one of goto/gotoProtocol`);
        }
        if (edge.goto !== undefined && edge.goto !== '$determine' && !nodeIds.has(edge.goto)) {
          problems.push(`protocol "${p.id}" question "${q.id}" edge targets unknown "${edge.goto}"`);
        }
        if (edge.gotoProtocol !== undefined && !protocolIds.has(edge.gotoProtocol)) {
          problems.push(`question "${q.id}" edge jumps to unknown protocol "${edge.gotoProtocol}"`);
        }
        if (edge.whenOption && q.expect && !q.expect.options.some((o) => o.id === edge.whenOption)) {
          problems.push(`question "${q.id}" edge condition uses unknown option "${edge.whenOption}"`);
        }
        for (const cond of edge.when ?? []) {
          checkCondition(cond, `question "${q.id}" edge`);
        }
      }
    }
    for (const rule of p.determinants) {
      for (const cond of rule.when ?? []) {
        checkCondition(cond, `determinant "${rule.id}"`);
      }
    }

    function checkCondition(cond: Condition, where: string) {
      if ('option' in cond) {
        const options = optionIdsBySlot.get(cond.slot);
        if (!options) {
          problems.push(`${where} references slot "${cond.slot}" with no choice question`);
        } else if (!options.has(cond.option)) {
          problems.push(`${where} references unknown option "${cond.option}" on slot "${cond.slot}"`);
        }
      } else if (!extractNumberSlots.has(cond.slot)) {
        problems.push(`${where} has a numeric condition on slot "${cond.slot}" but no question declares a numeric extractor for it`);
      }
    }
    const last = p.determinants[p.determinants.length - 1];
    if (last && last.when?.length) {
      problems.push(`protocol "${p.id}" has no default determinant (last rule must omit "when")`);
    }
  }

  // An option is matched by scanning the options in order and taking the first
  // whose keyword appears in the answer. So if an earlier option's keyword sits
  // inside a later one's, the later option can never win with that phrase:
  // "no shock indicated" contains the whole word "shock", which made the AED
  // card's no-shock branch unreachable until the options were reordered. That
  // was found by a coverage sweep; it should have been found at load.
  const checkShadowing = (
    where: string,
    options: { id: string; keywords: Record<string, string[]> }[],
  ) => {
    for (const locale of pack.locales) {
      options.forEach((option, index) => {
        for (const keyword of option.keywords[locale] ?? []) {
          for (const earlier of options.slice(0, index)) {
            const shadow = (earlier.keywords[locale] ?? []).find((k) => containsKeyword(keyword, k));
            if (shadow !== undefined) {
              problems.push(
                `${where} option "${option.id}" keyword "${keyword}" (${locale}) is unreachable: ` +
                  `the earlier option "${earlier.id}" matches it on "${shadow}". Put the more ` +
                  `specific option first.`,
              );
            }
          }
        }
      });
    }
  };
  for (const q of [...pack.caseEntry, ...pack.protocols.flatMap((p) => p.keyQuestions)]) {
    if (q.expect) checkShadowing(`question "${q.id}"`, q.expect.options);
  }
  for (const script of pack.scripts ?? []) {
    for (const step of script.steps) {
      if (step.expect) checkShadowing(`script "${script.id}" step "${step.id}"`, step.expect.options);
    }
  }

  // --- v0.3 instruction scripts ---

  // Conditions inside scripts may reference any slot the pack collects, so
  // they resolve against a pack-wide option registry rather than one card's.
  const globalOptions = new Map<string, Set<string>>();
  const registerOptions = (q: { slot: string; expect?: { options: { id: string }[] } }) => {
    if (!q.expect) return;
    const set = globalOptions.get(q.slot) ?? new Set<string>();
    for (const o of q.expect.options) set.add(o.id);
    globalOptions.set(q.slot, set);
  };
  pack.caseEntry.forEach(registerOptions);
  for (const p of pack.protocols) p.keyQuestions.forEach(registerOptions);
  for (const script of pack.scripts ?? []) {
    for (const step of script.steps) {
      if (step.slot && step.expect) registerOptions({ slot: step.slot, expect: step.expect });
    }
  }

  const checkGlobalCondition = (cond: Condition, where: string) => {
    if ('option' in cond) {
      const options = globalOptions.get(cond.slot);
      if (!options) problems.push(`${where} references slot "${cond.slot}" with no choice question`);
      else if (!options.has(cond.option)) {
        problems.push(`${where} references unknown option "${cond.option}" on slot "${cond.slot}"`);
      }
    } else if (!extractNumberSlots.has(cond.slot)) {
      problems.push(
        `${where} has a numeric condition on slot "${cond.slot}" but no question declares a numeric extractor for it`,
      );
    }
  };

  const scripts = pack.scripts ?? [];
  const scriptIds = new Set<string>();
  for (const script of scripts) {
    if (scriptIds.has(script.id)) problems.push(`duplicate script id "${script.id}"`);
    scriptIds.add(script.id);
    for (const locale of pack.locales) {
      if (script.name[locale] === undefined) {
        problems.push(`script "${script.id}" name missing locale "${locale}"`);
      }
    }
    const stepIds = new Set<string>();
    for (const step of script.steps) {
      if (stepIds.has(step.id)) problems.push(`script "${script.id}" has duplicate step id "${step.id}"`);
      stepIds.add(step.id);
    }
    for (const step of script.steps) {
      for (const o of step.expect?.options ?? []) {
        for (const locale of pack.locales) {
          if (!o.keywords[locale]?.length) {
            problems.push(
              `script "${script.id}" step "${step.id}" option "${o.id}" has no keywords for locale "${locale}"`,
            );
          }
        }
      }
      for (const edge of step.next ?? []) {
        const where = `script "${script.id}" step "${step.id}" edge`;
        if ((edge.goto === undefined) === (edge.gotoScript === undefined)) {
          problems.push(`${where} must have exactly one of goto/gotoScript`);
        }
        if (edge.goto !== undefined && edge.goto !== '$end' && !stepIds.has(edge.goto)) {
          problems.push(`${where} targets unknown step "${edge.goto}"`);
        }
        if (edge.whenOption && !step.expect?.options.some((o) => o.id === edge.whenOption)) {
          problems.push(`${where} uses unknown option "${edge.whenOption}"`);
        }
        for (const cond of edge.when ?? []) checkGlobalCondition(cond, where);
      }
    }
  }
  for (const script of scripts) {
    for (const step of script.steps) {
      for (const edge of step.next ?? []) {
        if (edge.gotoScript !== undefined && !scriptIds.has(edge.gotoScript)) {
          problems.push(
            `script "${script.id}" step "${step.id}" jumps to unknown script "${edge.gotoScript}"`,
          );
        }
      }
    }
  }
  for (const p of pack.protocols) {
    for (const entry of p.postDispatchScripts ?? []) {
      if (!scriptIds.has(entry.script)) {
        problems.push(`protocol "${p.id}" postDispatchScripts references unknown script "${entry.script}"`);
      }
      for (const cond of entry.when ?? []) {
        checkGlobalCondition(cond, `protocol "${p.id}" postDispatchScripts entry "${entry.script}"`);
      }
    }
  }

  // Scripts must be a DAG. Termination is then structural rather than a
  // runtime step budget: a pack that loads cannot loop the caller forever.
  if (!problems.length && scripts.length) {
    const byId = new Map(scripts.map((s) => [s.id, s]));
    const key = (scriptId: string, stepId: string) => `${scriptId}#${stepId}`;
    const successors = (scriptId: string, index: number): string[] => {
      const script = byId.get(scriptId)!;
      const step = script.steps[index]!;
      const out: string[] = [];
      let hasDefault = false;
      for (const edge of step.next ?? []) {
        if (edge.whenOption === undefined && !edge.when?.length) hasDefault = true;
        if (edge.gotoScript !== undefined) {
          const target = byId.get(edge.gotoScript);
          if (target?.steps[0]) out.push(key(target.id, target.steps[0].id));
        } else if (edge.goto !== undefined && edge.goto !== '$end') {
          out.push(key(scriptId, edge.goto));
        }
      }
      const nextInSequence = script.steps[index + 1];
      if (!hasDefault && step.kind !== 'stay' && nextInSequence) {
        out.push(key(scriptId, nextInSequence.id));
      }
      return out;
    };
    const index = new Map<string, [string, number]>();
    for (const script of scripts) {
      script.steps.forEach((step, i) => index.set(key(script.id, step.id), [script.id, i]));
    }
    const state = new Map<string, 'open' | 'closed'>();
    const walk = (node: string, trail: string[]): void => {
      const seen = state.get(node);
      if (seen === 'closed') return;
      if (seen === 'open') {
        problems.push(`instruction scripts contain a cycle: ${[...trail, node].join(' → ')}`);
        return;
      }
      state.set(node, 'open');
      const at = index.get(node);
      if (at) for (const next of successors(at[0], at[1])) walk(next, [...trail, node]);
      state.set(node, 'closed');
    };
    for (const script of scripts) {
      if (script.steps[0]) walk(key(script.id, script.steps[0].id), []);
    }
  }

  if (problems.length) throw new PackValidationError(packRef, problems);
  return pack;
}
