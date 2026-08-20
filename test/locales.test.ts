import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DispatchSession, loadPackFromFile } from '../src/index.js';
import type { ProtocolPack, Question } from '../src/index.js';

const packsDir = fileURLToPath(new URL('../packs', import.meta.url));
const packs: ProtocolPack[] = readdirSync(packsDir).map((d) =>
  loadPackFromFile(join(packsDir, d, 'pack.json')),
);

const allQuestions = (p: ProtocolPack): Question[] => [
  ...p.caseEntry,
  ...p.protocols.flatMap((x) => x.keyQuestions),
];

/**
 * The loader already guarantees a locale is *present* everywhere. These are the
 * checks it cannot make: that a locale is present and also carries its weight.
 */

test('no locale is a copy of the default one', () => {
  for (const pack of packs) {
    const base = pack.strings[pack.defaultLocale]!;
    for (const locale of pack.locales) {
      if (locale === pack.defaultLocale) continue;
      const catalog = pack.strings[locale]!;
      const copied = Object.keys(base).filter(
        (id) => JSON.stringify(catalog[id]) === JSON.stringify(base[id]),
      );
      assert.deepEqual(
        copied,
        [],
        `${pack.id}/${locale}: ${copied.length} strings are byte-identical to ${pack.defaultLocale}`,
      );
    }
  }
});

test('every answer option is recognisable by more than one word, in every locale', () => {
  // A locale that ships a single way to say "no" does not fail to load — it
  // fails the caller, by meeting a perfectly clear answer with "I need a yes or
  // no answer". Spanish carried exactly that on 201 options.
  const thin: string[] = [];
  for (const pack of packs) {
    const steps = (pack.scripts ?? []).flatMap((s) => s.steps);
    for (const q of [...allQuestions(pack), ...steps]) {
      for (const option of q.expect?.options ?? []) {
        for (const locale of pack.locales) {
          const keywords = option.keywords[locale] ?? [];
          if (keywords.length < 2) {
            thin.push(`${pack.id}/${q.id}/${option.id}/${locale}: ${keywords.length}`);
          }
        }
      }
    }
  }
  assert.deepEqual(thin, []);
});

test('every locale names the pack, every protocol, and every instruction script', () => {
  for (const pack of packs) {
    for (const locale of pack.locales) {
      assert.ok(pack.name[locale], `${pack.id}: no name in ${locale}`);
      for (const p of pack.protocols) {
        assert.ok(p.name[locale], `${pack.id}/${p.id}: no name in ${locale}`);
        if (p.id !== pack.fallbackProtocol) {
          assert.ok(p.keywords[locale]?.length, `${pack.id}/${p.id}: no keywords in ${locale}`);
        }
      }
      for (const s of pack.scripts ?? []) {
        assert.ok(s.name[locale], `${pack.id}/${s.id}: no name in ${locale}`);
      }
    }
  }
});

test('a Spanish caller can decline in more than one way', () => {
  const pack = packs.find((p) => p.id === 'us-openises-emd')!;
  for (const answer of ['no', 'para nada', 'ninguno', 'en absoluto', 'tampoco']) {
    let clarifies = 0;
    const s = new DispatchSession(pack, {
      locale: 'es',
      onEvent: (e) => {
        if (e.type === 'clarify') clarifies++;
      },
    });
    s.start();
    for (const a of ['Calle Reforma 10', '555-0100', 'le duele el pecho', 'uno', '58']) s.answer(a);
    s.answer(answer);
    assert.equal(clarifies, 0, `"${answer}" was met with a clarify`);
    assert.equal(s.result().choices['conscious'], 'no', `"${answer}" did not read as no`);
  }
});

test('the answer vocabulary widened without moving a single outcome', () => {
  // Enrichment appends, so the branch sweep — which answers with an option's
  // first keyword — still says exactly what it said before. Pinned here because
  // prepending is the easy mistake, and it would silently rewrite every
  // simulated call while the suite stayed green.
  const pack = packs.find((p) => p.id === 'us-openises-emd')!;
  const firsts: Record<string, string> = {};
  for (const q of allQuestions(pack)) {
    for (const option of q.expect?.options ?? []) {
      for (const locale of pack.locales) {
        firsts[`${q.id}/${option.id}/${locale}`] = option.keywords[locale]![0]!;
      }
    }
  }
  assert.equal(firsts['q_conscious/no/en'], 'no');
  assert.equal(firsts['q_conscious/no/es'], 'no');
  assert.equal(firsts['q_conscious/no/fr'], 'non');
  assert.equal(firsts['q_conscious/yes/en'], 'yes');
  assert.equal(firsts['q_conscious/yes/es'], 'sí');
  assert.equal(firsts['q_conscious/yes/fr'], 'oui');
});
