import type { Lexicon } from './lexicon.js';

/**
 * Deterministic value extraction from a caller's answer.
 *
 * A caller does not answer in fields. Asked for an address they say "uh, we're
 * at 12 Pine Street, the blue house on the corner", and a read-back that
 * repeats all of that is not a read-back — it is an echo. These extractors pull
 * the value out so the dispatcher can confirm what it actually recorded, and so
 * a card can route on it.
 *
 * No model, no network: regex and the pack's own vocabulary. Every extractor
 * returns null rather than guessing, and the engine falls back to the caller's
 * words — losing information is never the failure mode.
 */

export type ExtractKind = 'number' | 'age' | 'count' | 'address' | 'phone';

export interface Extracted {
  /** What the dispatcher reads back, and what {slot} interpolates to. */
  value: string;
  /** Normalized magnitude for numeric conditions — years, for an age. */
  number?: number;
}

const rx = (source: string) => new RegExp(source, 'iu');
const rxg = (source: string) => new RegExp(source, 'giu');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = "[\\p{L}\\p{N}'’.-]+";

// JavaScript's \b is defined over [A-Za-z0-9_] even under /u, so it reports no
// boundary after "bebé" or "allée" — every accented term in the lexicon would
// silently never match. These lookarounds are the Unicode-aware equivalent.
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
/** A lexicon term, bounded so it matches as a whole word in any script. */
const term = (word: string) => `${B}${escape(word)}${E}`;

const DIGITS = /-?\d+(?:[.,]\d+)?/u;
const parseDigits = (s: string) => Number(s.replace(',', '.'));

/** Phrases from a lexicon table, longest first so "a couple of" beats "a". */
function byLengthDesc(table: Record<string, number> | undefined): [string, number][] {
  return Object.entries(table ?? {}).sort((a, b) => b[0].length - a[0].length);
}

/** First spoken numeral in the text, with the span it was written as. */
function spokenNumber(text: string, lex: Lexicon): { value: number; text: string; at: number } | null {
  let best: { value: number; text: string; at: number } | null = null;
  for (const [word, value] of byLengthDesc(lex.numbers)) {
    const m = rx(term(word)).exec(text);
    if (!m) continue;
    if (!best || m.index < best.at || (m.index === best.at && m[0].length > best.text.length)) {
      best = { value, text: m[0], at: m.index };
    }
  }
  return best;
}

function extractNumber(text: string): Extracted | null {
  const m = DIGITS.exec(text);
  return m ? { value: m[0], number: parseDigits(m[0]) } : null;
}

function extractCount(text: string, lex: Lexicon): Extracted | null {
  const digits = DIGITS.exec(text);
  const spoken = spokenNumber(text, lex);
  // Whichever comes first in the sentence is the one the caller meant.
  if (digits && (!spoken || digits.index <= spoken.at)) {
    const n = parseDigits(digits[0]);
    return { value: String(n), number: n };
  }
  if (spoken) return { value: String(spoken.value), number: spoken.value };
  return null;
}

function extractAge(text: string, lex: Lexicon): Extracted | null {
  const units = byLengthDesc(lex.ageUnits);
  if (units.length) {
    const unitAlt = units.map(([u]) => escape(u)).join('|');
    const quantity = `${DIGITS.source}|${WORD}`;
    // Languages disagree about which comes first: "six months old" and
    // "6 meses", but "miezi 6". Try both orders and take whichever the caller
    // actually said first.
    const forms: [RegExp, 'quantity-first' | 'unit-first'][] = [
      [rxg(`${B}(${quantity})[\\s-]+(${unitAlt})${E}`), 'quantity-first'],
      [rxg(`${B}(${unitAlt})[\\s-]+(${quantity})${E}`), 'unit-first'],
    ];
    // Every candidate pairing, then the earliest one whose quantity is actually
    // a number. "ana miezi 6" offers "ana miezi" first, and "ana" is not a
    // numeral in any table — so the pairing is discarded rather than the whole
    // unit reading being lost.
    let best: { at: number; years: number; quantity: string; unit: string } | null = null;
    for (const [re, order] of forms) {
      for (const m of text.matchAll(re)) {
        const [, first = '', second = ''] = m;
        const quantityText = order === 'quantity-first' ? first : second;
        const unitText = order === 'quantity-first' ? second : first;
        const years = lex.ageUnits?.[unitText.toLowerCase()];
        if (years === undefined) continue;
        const digits = DIGITS.exec(quantityText);
        const n = digits ? parseDigits(digits[0]) : lex.numbers?.[quantityText.toLowerCase()];
        if (n === undefined) continue;
        const at = m.index ?? 0;
        if (!best || at < best.at) {
          best = { at, years: n * years, quantity: quantityText, unit: unitText };
        }
      }
    }
    if (best) return { value: `${best.quantity} ${best.unit}`, number: best.years };
  }
  for (const [word, years] of byLengthDesc(lex.ageTerms)) {
    const m = rx(term(word)).exec(text);
    if (m) return { value: m[0], number: years };
  }
  const digits = DIGITS.exec(text);
  if (digits) return { value: digits[0], number: parseDigits(digits[0]) };
  const spoken = spokenNumber(text, lex);
  return spoken ? { value: String(spoken.value), number: spoken.value } : null;
}

function extractPhone(text: string): Extracted | null {
  const m = /\(?\+?\d[\d\s().+-]{5,}\d\)?/u.exec(text);
  if (!m) return null;
  return { value: m[0].replace(/\s+/g, ' ').trim() };
}

function extractAddress(text: string, lex: Lexicon): Extracted | null {
  const types = (lex.streetTypes ?? []).map(escape).join('|');
  const units = (lex.unitTypes ?? []).map(escape).join('|');
  const subunit = units ? `(?:[,\\s]+(?:${units})${E}\\.?\\s*#?\\s*[\\p{L}\\d-]+)?` : '';
  const number = `\\d+[a-z]?${E}`;

  const candidates: string[] = [];
  if (types) {
    // "12 Pine Street", "12 rue des Lilas" — number leads.
    candidates.push(`${B}${number}(?:\\s+${WORD}){0,4}?\\s+(?:${types})${E}${subunit}`);
    // "Calle Reforma 10" — the street type leads and the number trails.
    candidates.push(`${B}(?:${types})${E}(?:\\s+${WORD}){0,4}?\\s+${number}${subunit}`);
  }
  // No street type anywhere: a house number and the words after it.
  candidates.push(`${B}${number}(?:\\s+${WORD}){1,3}`);

  let best: { text: string; at: number } | null = null;
  for (const source of candidates) {
    const m = rx(source).exec(text);
    if (!m) continue;
    // Earliest match wins; among matches starting together, the longest does.
    if (!best || m.index < best.at || (m.index === best.at && m[0].length > best.text.length)) {
      best = { text: m[0], at: m.index };
    }
  }
  if (!best) return null;
  const value = best.text.replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim();
  return value ? { value } : null;
}

/**
 * Pull a value of `kind` out of `text`, or null when nothing recognisable is
 * there — in which case the caller's own words stand.
 */
export function extractValue(kind: ExtractKind, text: string, lex: Lexicon): Extracted | null {
  switch (kind) {
    case 'number':
      return extractNumber(text);
    case 'count':
      return extractCount(text, lex);
    case 'age':
      return extractAge(text, lex);
    case 'phone':
      return extractPhone(text);
    case 'address':
      return extractAddress(text, lex);
  }
}

/** Kinds that yield a magnitude usable in numeric conditions. */
export const NUMERIC_KINDS: ReadonlySet<ExtractKind> = new Set(['number', 'age', 'count']);

/** Kinds that need lexicon vocabulary to work at all. */
export const KIND_REQUIREMENTS: Record<ExtractKind, (keyof Lexicon)[]> = {
  number: [],
  phone: [],
  count: ['numbers'],
  age: ['ageUnits'],
  address: ['streetTypes'],
};
