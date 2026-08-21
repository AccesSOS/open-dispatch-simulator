import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DispatchSession, loadPack, loadPackFromFile, PackValidationError } from '../src/index.js';
import type { Locale, ProtocolPack } from '../src/index.js';

const packsDir = fileURLToPath(new URL('../packs', import.meta.url));
const packs: ProtocolPack[] = readdirSync(packsDir).map((d) =>
  loadPackFromFile(join(packsDir, d, 'pack.json')),
);
const openises = packs.find((p) => p.id === 'us-openises-emd')!;

const PRE: Record<Locale, string[]> = {
  en: ['12 Pine St', '555-0100', 'chest pain', 'one', '58'],
  es: ['Calle Reforma 10', '555-0100', 'dolor de pecho', 'uno', '58'],
  fr: ['12 rue des Lilas', '555-0100', 'douleur à la poitrine', 'une', '58'],
};

/** Answer the consciousness question with `answer` and report what was recorded. */
function answerConscious(answer: string, locale: Locale = 'en') {
  let clarifies = 0;
  const s = new DispatchSession(openises, {
    locale,
    onEvent: (e) => {
      if (e.type === 'clarify') clarifies++;
    },
  });
  s.start();
  for (const a of PRE[locale]!) s.answer(a);
  s.answer(answer);
  const r = s.result();
  return {
    choice: r.choices['conscious'] ?? null,
    unknown: r.unknowns.includes('conscious'),
    clarifies,
  };
}

test('"I don\'t know" is not "no", in any of the three locales', () => {
  // It contains the word "not"; "no sé" contains "no"; "je ne sais pas"
  // contains "pas". Every one of those is a negative keyword in this pack.
  const cases: [Locale, string][] = [
    ['en', 'I do not know'],
    ['en', "I don't know"],
    ['en', 'not sure'],
    ['en', 'no idea'],
    ['es', 'no sé'],
    ['es', 'ni idea'],
    ['fr', 'je ne sais pas'],
    ['fr', 'aucune idée'],
  ];
  for (const [locale, answer] of cases) {
    const got = answerConscious(answer, locale);
    assert.equal(got.choice, null, `${locale}: "${answer}" was recorded as ${got.choice}`);
    assert.equal(got.unknown, true, `${locale}: "${answer}" was not recorded as unknown`);
  }
});

test('a caller who says they do not know is not asked again', () => {
  // Re-asking someone who just said they cannot answer is the antipattern the
  // call-taking guidelines warn about: it costs time and gains nothing.
  assert.equal(answerConscious('I do not know').clarifies, 0);
  // An answer that is merely unintelligible still gets one clarify.
  const garbled = answerConscious('mmhm the thing by the porch');
  assert.equal(garbled.choice, null);
  assert.equal(garbled.unknown, false);
  assert.ok(garbled.clarifies > 0);
});

test('a real yes or no still lands, and is not swallowed as unknown', () => {
  for (const [locale, no, yes] of [
    ['en', 'no', 'yes'],
    ['es', 'no', 'sí'],
    ['fr', 'non', 'oui'],
  ] as [Locale, string, string][]) {
    assert.equal(answerConscious(no, locale).choice, 'no');
    assert.equal(answerConscious(yes, locale).choice, 'yes');
  }
});

test("the pack's own vocabulary beats the generic unknown list on a tie", () => {
  // The M10 card offers "not sure" as a real answer to how the caller knows the
  // person is dead. The generic list must not steal it.
  const pack = loadPack({
    schemaVersion: '0.2',
    id: 'tie', name: { en: 'Tie' },
    jurisdiction: { country: 'US', emergencyNumber: '911' },
    provenance: { source: 'synthetic', license: 'CC0-1.0' },
    locales: ['en'], defaultLocale: 'en',
    caseEntry: [
      { id: 'q_c', slot: 'complaint', stringId: 's_c', selectsProtocol: true },
      {
        id: 'q_how', slot: 'how_know', stringId: 's_how',
        expect: {
          type: 'choice',
          options: [
            { id: 'unsure', keywords: { en: ['not sure'] } },
            { id: 'certain', keywords: { en: ['certain', 'definitely'] } },
          ],
        },
      },
    ],
    protocols: [{
      id: 'only', name: { en: 'Only' }, keywords: { en: ['anything'] },
      keyQuestions: [], determinants: [{ id: 'd', response: 'COLD' }], postDispatch: ['s_pd'],
    }],
    fallbackProtocol: 'only',
    strings: { en: {
      greeting: '911.', closing: 'Bye.', dispatch_confirm: 'Sending help.', clarify: 'Sorry?',
      s_c: 'What happened?', s_how: 'How do you know?', s_pd: 'Wait there.',
    } },
  }) as ProtocolPack;

  const s = new DispatchSession(pack);
  s.start();
  s.answer('anything');
  s.answer('not sure');
  const r = s.result();
  assert.equal(r.choices['how_know'], 'unsure', "the pack's own option must win the tie");
  assert.deepEqual(r.unknowns, []);

  // …and the rule cuts the other way too: when the generic phrase is the more
  // specific match, it wins, and the caller is recorded as not knowing.
  const s2 = new DispatchSession(pack);
  s2.start();
  s2.answer('anything');
  s2.answer('I have no way to tell');
  assert.equal(s2.result().choices['how_know'], undefined);
  assert.deepEqual(s2.result().unknowns, ['how_know']);
});

test('an option shadowed by an earlier one is rejected at load', () => {
  // This is the AED bug: "no shock indicated" contains the whole word "shock",
  // so with `shock` offered first the no-shock branch was unreachable. It was
  // found by a coverage sweep; it belongs at load time.
  const build = (order: 'shock-first' | 'no-shock-first') => {
    const shock = { id: 'shock', keywords: { en: ['shock'] } };
    const noShock = { id: 'no_shock', keywords: { en: ['no shock'] } };
    return loadPack({
      schemaVersion: '0.2', id: 'shadow', name: { en: 'Shadow' },
      jurisdiction: { country: 'US', emergencyNumber: '911' },
      provenance: { source: 'synthetic', license: 'CC0-1.0' },
      locales: ['en'], defaultLocale: 'en',
      caseEntry: [
        { id: 'q_c', slot: 'complaint', stringId: 's_c', selectsProtocol: true },
        {
          id: 'q_aed', slot: 'aed', stringId: 's_aed',
          expect: {
            type: 'choice',
            options: order === 'shock-first' ? [shock, noShock] : [noShock, shock],
          },
        },
      ],
      protocols: [{
        id: 'only', name: { en: 'Only' }, keywords: { en: ['anything'] },
        keyQuestions: [], determinants: [{ id: 'd', response: 'COLD' }], postDispatch: ['s_pd'],
      }],
      fallbackProtocol: 'only',
      strings: { en: {
        greeting: '911.', closing: 'Bye.', dispatch_confirm: 'Sending help.', clarify: 'Sorry?',
        s_c: 'What happened?', s_aed: 'What does it say?', s_pd: 'Wait there.',
      } },
    });
  };

  try {
    build('shock-first');
    assert.fail('expected PackValidationError');
  } catch (e) {
    assert.ok(e instanceof PackValidationError);
    assert.ok(
      e.problems.some((p) => /keyword "no shock" \(en\) is unreachable/.test(p)),
      e.problems.join('; '),
    );
  }
  // The specific option first is fine.
  assert.ok(build('no-shock-first'));
});

test('no shipped pack has an unreachable option keyword', () => {
  // The generic negative "never" made "never like this" — a real yes answer on
  // the headache card — unreachable in all three locales. The sweep could not
  // see it, because the sweep never says those words.
  for (const pack of packs) {
    assert.ok(pack.id, 'every bundled pack loads under the shadowing check');
  }
  const headache = openises.protocols.find((p) => p.id === 'm7_headache')!;
  const different = headache.keyQuestions.find((q) => q.slot === 'm7_different')!;
  const yes = different.expect!.options.find((o) => o.id === 'yes')!;
  const no = different.expect!.options.find((o) => o.id === 'no')!;
  assert.ok(yes.keywords['en']!.includes('never like this'));
  assert.ok(!no.keywords['en']!.includes('never'), '"never" must not shadow it');
});
