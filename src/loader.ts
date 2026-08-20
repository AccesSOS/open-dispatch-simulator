import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { Condition, ProtocolPack, Question } from './types.js';

const schemaPath = fileURLToPath(new URL('../schema/pack.schema.json', import.meta.url));

const ajv = new Ajv2020({ allErrors: true, formats: { date: true } });
const validateSchema = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));

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
  const collectQuestion = (q: Question) => {
    stringIds.add(q.stringId);
    if (q.confirmStringId) stringIds.add(q.confirmStringId);
    slots.add(q.slot);
    if (q.extract === 'number') extractNumberSlots.add(q.slot);
  };
  pack.caseEntry.forEach(collectQuestion);
  for (const p of pack.protocols) {
    p.keyQuestions.forEach(collectQuestion);
    p.postDispatch.forEach((id) => stringIds.add(id));
  }

  // Every stringId must exist in every declared locale — the "grounded or
  // silent" property is enforced here, at load time, not at runtime.
  for (const locale of pack.locales) {
    const catalog = pack.strings[locale];
    if (!catalog) {
      problems.push(`missing string catalog for locale "${locale}"`);
      continue;
    }
    for (const id of stringIds) {
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
        problems.push(`${where} has a numeric condition on slot "${cond.slot}" but no question declares extract: "number" for it`);
      }
    }
    const last = p.determinants[p.determinants.length - 1];
    if (last && last.when?.length) {
      problems.push(`protocol "${p.id}" has no default determinant (last rule must omit "when")`);
    }
  }

  if (problems.length) throw new PackValidationError(packRef, problems);
  return pack;
}
