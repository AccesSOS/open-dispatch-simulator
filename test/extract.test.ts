import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  DispatchSession,
  extractValue,
  lexiconFor,
  loadPack,
  loadPackFromFile,
  PackValidationError,
} from '../src/index.js';
import type { ExtractKind, Locale, ProtocolPack } from '../src/index.js';

const lex = (locale: Locale) => lexiconFor(locale, undefined);

const check = (kind: ExtractKind, locale: Locale, text: string) =>
  extractValue(kind, text, lex(locale));

test('age is unit-aware: six months is half a year, not six', () => {
  const cases: [Locale, string, string, number][] = [
    ['en', 'he is six months old', 'six months', 0.5],
    ['en', '6 months', '6 months', 0.5],
    ['en', '18 months old', '18 months', 1.5],
    ['en', 'about 3 weeks', '3 weeks', 3 / 52],
    ['en', 'she is 58', '58', 58],
    ['en', 'she is 58 years old', '58 years', 58],
    ['es', 'tiene 6 meses', '6 meses', 0.5],
    ['es', 'tiene 58 años', '58 años', 58],
    ['fr', 'il a six mois', 'six mois', 0.5],
    ['fr', 'elle a 5 années', '5 années', 5],
  ];
  for (const [locale, text, value, years] of cases) {
    const got = check('age', locale, text);
    assert.ok(got, `${locale}: "${text}" extracted nothing`);
    assert.equal(got.value, value, `${locale}: "${text}"`);
    assert.ok(Math.abs(got.number! - years) < 1e-9, `${locale}: "${text}" → ${got.number}, want ${years}`);
  }
});

test('words for a newborn resolve, in every shipped locale', () => {
  // Accented terms are the reason the extractors do not use \b: JavaScript's
  // word boundary is ASCII-only, so "bebé" would never have matched.
  const cases: [Locale, string, number][] = [
    ['en', 'he is a newborn', 0],
    ['en', 'my baby', 0.5],
    ['en', 'a toddler', 2],
    ['es', 'es un bebé', 0.5],
    ['es', 'un recién nacido', 0],
    ['fr', 'un nouveau-né', 0],
    ['fr', 'un nourrisson', 0.5],
  ];
  for (const [locale, text, years] of cases) {
    const got = check('age', locale, text);
    assert.ok(got, `${locale}: "${text}" extracted nothing`);
    assert.equal(got.number, years, `${locale}: "${text}"`);
  }
});

test('counts read digits and spoken numerals, whichever comes first', () => {
  assert.deepEqual(check('count', 'en', 'two people are hurt'), { value: '2', number: 2 });
  assert.deepEqual(check('count', 'en', 'just one'), { value: '1', number: 1 });
  assert.deepEqual(check('count', 'en', 'a couple of them'), { value: '2', number: 2 });
  assert.deepEqual(check('count', 'en', 'there are 3'), { value: '3', number: 3 });
  assert.deepEqual(check('count', 'es', 'somos tres'), { value: '3', number: 3 });
  assert.deepEqual(check('count', 'fr', 'deux personnes'), { value: '2', number: 2 });
});

test('addresses come out of the sentence, number-first or type-first', () => {
  const cases: [Locale, string, string][] = [
    ['en', 'uh we are at 12 Pine Street, the blue house on the corner', '12 Pine Street'],
    ['en', '12 Pine St apt 4B', '12 Pine St apt 4B'],
    ['en', '1200 Riverside, near the park', '1200 Riverside'],
    ['es', 'estamos en Calle Reforma 10, colonia Juárez', 'Calle Reforma 10'],
    ['es', 'estamos en la Avenida Insurgentes 300, cerca del parque', 'Avenida Insurgentes 300'],
    ['fr', '12 rue des Lilas, deuxième étage', '12 rue des Lilas'],
    ['fr', '12 allée des Roses', '12 allée des Roses'],
  ];
  for (const [locale, text, want] of cases) {
    assert.equal(check('address', locale, text)?.value, want, `${locale}: "${text}"`);
  }
});

test('phone numbers keep their shape', () => {
  assert.equal(check('phone', 'en', 'my number is 555-0100 but it is spotty')?.value, '555-0100');
  assert.equal(check('phone', 'en', 'you can reach me at (415) 555 0100')?.value, '(415) 555 0100');
  assert.equal(check('phone', 'es', 'el teléfono es 55 1234 5678')?.value, '55 1234 5678');
});

test('extraction that recognises nothing returns null, and the answer stands', () => {
  for (const [kind, text] of [
    ['age', 'I have no idea'],
    ['address', 'somewhere downtown'],
    ['phone', 'I do not know'],
    ['count', 'lots of people'],
  ] as [ExtractKind, string][]) {
    assert.equal(check(kind, 'en', text), null, `${kind}: "${text}"`);
  }
});

// --- integration with a pack -------------------------------------------------

const openises = loadPackFromFile(
  fileURLToPath(new URL('../packs/us-openises-emd/pack.json', import.meta.url)),
);

function run(slots: Record<string, string>, locale: Locale = 'en', confirm = false) {
  const s = new DispatchSession(openises, {
    locale,
    ...(confirm ? { persona: { seed: 3, confirmRate: 1 } } : {}),
  });
  s.start();
  let guard = 0;
  while (!s.isDone() && guard++ < 80) {
    const pending = s.pending();
    if (!pending) break;
    s.answer(slots[pending.slot] ?? 'no');
  }
  return s;
}

const ARREST = {
  location: 'uh we are at 12 Pine Street, the blue house on the corner',
  callback: 'my number is 555-0100 but it is spotty',
  emergency: 'the baby is not breathing',
  num_hurt: 'just two of us',
  conscious: 'no',
  breathing: 'no',
  sex: 'female',
  caller_name: 'Ana',
  i2_knows_cpr: 'yes',
  i3_knows_cpr: 'yes',
  i4_knows_cpr: 'yes',
  i2_need_help: 'no',
  i3_need_help: 'no',
  i4_need_help: 'no',
};

test('a read-back confirms the value, not the whole sentence', () => {
  const s = run({ ...ARREST, age: '58' }, 'en', true);
  const said = s.result().transcript.filter((t) => t.role === 'dispatcher').map((t) => t.text);
  assert.ok(said.includes('I have 12 Pine Street — is that correct?'), said.join(' | '));
  assert.ok(said.includes('I have 555-0100 — is that correct?'));
  assert.deepEqual(s.result().values['location'], '12 Pine Street');
  // …and the caller's own words are still on the record.
  assert.equal(s.result().answers['location'], ARREST.location);
});

test('the age deck routes on years, so "six months old" reaches the infant card', () => {
  const deck = (age: string) => run({ ...ARREST, age }).result().scripts[0];
  assert.equal(deck('he is six months old'), 'i4a_infant_cpr_entry');
  assert.equal(deck('6 months'), 'i4a_infant_cpr_entry');
  assert.equal(deck('he is a newborn'), 'i4a_infant_cpr_entry');
  assert.equal(deck('18 months old'), 'i3a_child_cpr_entry');
  assert.equal(deck('she is 5 years old'), 'i3a_child_cpr_entry');
  assert.equal(deck('58'), 'i2a_adult_cpr_entry');
  // An age nobody can give still lands somewhere: the last route is unconditional.
  assert.equal(deck('I have no idea'), 'i2a_adult_cpr_entry');
});

test('extraction works in every locale the pack declares', () => {
  const es = run(
    {
      location: 'estamos en Calle Reforma 10, colonia Juárez',
      callback: 'mi número es 555-0100',
      emergency: 'no respira',
      num_hurt: 'somos dos',
      age: 'tiene 6 meses',
      conscious: 'no',
      breathing: 'no',
      sex: 'mujer',
      caller_name: 'Ana',
      i4_knows_cpr: 'sí',
      i4_need_help: 'no',
    },
    'es',
    true,
  ).result();
  assert.equal(es.values['location'], 'Calle Reforma 10');
  assert.equal(es.values['age'], '6 meses');
  assert.equal(es.numbers['age'], 0.5);
  assert.equal(es.values['num_hurt'], '2');
  assert.equal(es.scripts[0], 'i4a_infant_cpr_entry');
});

test('personas do not touch what was extracted', () => {
  const baseline = run({ ...ARREST, age: 'six months old' }).result();
  for (const seed of [2, 7, 2029]) {
    const s = new DispatchSession(openises, { persona: { seed, confirmRate: 1, clarifyAttempts: 2 } });
    s.start();
    let guard = 0;
    while (!s.isDone() && guard++ < 80) {
      const pending = s.pending();
      if (!pending) break;
      s.answer(({ ...ARREST, age: 'six months old' } as Record<string, string>)[pending.slot] ?? 'no');
    }
    assert.deepEqual(s.result().values, baseline.values, `seed ${seed}`);
    assert.deepEqual(s.result().numbers, baseline.numbers, `seed ${seed}`);
    assert.deepEqual(s.result().scripts, baseline.scripts, `seed ${seed}`);
  }
});

// --- loader gates ------------------------------------------------------------

function packWith(patch: (p: Record<string, unknown>) => void): ProtocolPack {
  const p: Record<string, unknown> = {
    schemaVersion: '0.4',
    id: 'test-extract',
    name: { en: 'Test' },
    jurisdiction: { country: 'US', emergencyNumber: '911' },
    provenance: { source: 'synthetic', license: 'CC0-1.0' },
    locales: ['en'],
    defaultLocale: 'en',
    caseEntry: [
      { id: 'q_loc', slot: 'location', stringId: 's_loc', extract: 'address' },
      { id: 'q_age', slot: 'age', stringId: 's_age', extract: 'age' },
      { id: 'q_c', slot: 'complaint', stringId: 's_c', selectsProtocol: true },
    ],
    protocols: [
      {
        id: 'only',
        name: { en: 'Only' },
        keywords: { en: ['anything'] },
        keyQuestions: [],
        determinants: [{ id: 'd', when: [{ slot: 'age', lt: 1 }], response: 'HOT' }, { id: 'd2', response: 'COLD' }],
        postDispatch: ['s_pd'],
      },
    ],
    fallbackProtocol: 'only',
    strings: {
      en: {
        greeting: '911.', closing: 'Bye.', dispatch_confirm: 'Sending help.', clarify: 'Sorry?',
        s_loc: 'Address?', s_age: 'How old?', s_c: 'What happened?', s_pd: 'Wait there.',
      },
    },
  };
  patch(p);
  return loadPack(p) as ProtocolPack;
}

test('an age extractor satisfies a numeric condition, no separate number question needed', () => {
  const pack = packWith(() => {});
  assert.equal(pack.schemaVersion, '0.4');
});

test('v0.4 extractors are refused in a pack that declares an older schema', () => {
  try {
    packWith((p) => {
      p['schemaVersion'] = '0.3';
    });
    assert.fail('expected PackValidationError');
  } catch (e) {
    assert.ok(e instanceof PackValidationError);
    assert.ok(e.problems.some((x) => x.includes('extract: "address" requires schemaVersion 0.4')));
  }
});

test('a word-aware extractor with no vocabulary for a locale is rejected, not degraded', () => {
  try {
    packWith((p) => {
      (p['locales'] as string[]).push('sw');
      (p['strings'] as Record<string, unknown>)['sw'] = (p['strings'] as Record<string, unknown>)['en'];
      (p['name'] as Record<string, string>)['sw'] = 'Jaribu';
      (p['protocols'] as { keywords: Record<string, string[]> }[])[0]!.keywords['sw'] = ['kitu'];
      (p['protocols'] as { name: Record<string, string> }[])[0]!.name['sw'] = 'Moja';
    });
    assert.fail('expected PackValidationError');
  } catch (e) {
    assert.ok(e instanceof PackValidationError);
    assert.ok(
      e.problems.some((x) => x.includes('needs lexicon.streetTypes for locale "sw"')),
      e.problems.join('; '),
    );
    assert.ok(e.problems.some((x) => x.includes('needs lexicon.ageUnits for locale "sw"')));
  }
});

test('a pack may supply its own vocabulary for a locale the engine does not ship', () => {
  const pack = packWith((p) => {
    (p['locales'] as string[]).push('sw');
    (p['strings'] as Record<string, unknown>)['sw'] = (p['strings'] as Record<string, unknown>)['en'];
    (p['name'] as Record<string, string>)['sw'] = 'Jaribu';
    (p['protocols'] as { keywords: Record<string, string[]> }[])[0]!.keywords['sw'] = ['kitu'];
    (p['protocols'] as { name: Record<string, string> }[])[0]!.name['sw'] = 'Moja';
    p['lexicon'] = {
      sw: {
        ageUnits: { mwaka: 1, miaka: 1, mwezi: 1 / 12, miezi: 1 / 12 },
        streetTypes: ['barabara', 'mtaa'],
      },
    };
  });
  assert.ok(pack.lexicon?.['sw']);
  const s = new DispatchSession(pack, { locale: 'sw' });
  s.start();
  s.answer('tuko Barabara ya Uhuru 42');
  s.answer('ana miezi 6');
  assert.equal(s.result().values['location'], 'Barabara ya Uhuru 42');
  assert.equal(s.result().numbers['age'], 0.5);
});

test('a lexicon for a locale the pack does not declare is rejected', () => {
  try {
    packWith((p) => {
      p['lexicon'] = { de: { streetTypes: ['strasse'] } };
    });
    assert.fail('expected PackValidationError');
  } catch (e) {
    assert.ok(e instanceof PackValidationError);
    assert.ok(e.problems.some((x) => x.includes('lexicon declares locale "de"')));
  }
});
