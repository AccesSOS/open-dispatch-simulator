import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DispatchSession,
  loadPack,
  PackValidationError,
  packGraph,
  runBatch,
  sweepInstructionScripts,
} from '../src/index.js';
import type { ProtocolPack } from '../src/index.js';

const yesNo = (extra: Record<string, string[]> = {}) => ({
  type: 'choice' as const,
  options: [
    { id: 'yes', keywords: { en: ['yes', ...(extra.yes ?? [])] } },
    { id: 'no', keywords: { en: ['no', ...(extra.no ?? [])] } },
  ],
});

/**
 * A v0.3 pack shaped like the real thing: one card that routes by age to an
 * age-appropriate instruction script, a script that asks and branches, a
 * cross-script hand-off, and dispatcher-only notes.
 */
function v03Pack(patch: (p: Record<string, unknown>) => void = () => {}): ProtocolPack {
  const pack: Record<string, unknown> = {
    schemaVersion: '0.3',
    id: 'test-v03',
    name: { en: 'Test v0.3' },
    jurisdiction: { country: 'US', emergencyNumber: '911' },
    provenance: { source: 'synthetic', license: 'CC0-1.0' },
    locales: ['en'],
    defaultLocale: 'en',
    caseEntry: [
      { id: 'q_loc', slot: 'location', stringId: 's_loc' },
      { id: 'q_age', slot: 'age', stringId: 's_age', extract: 'number' },
      { id: 'q_c', slot: 'complaint', stringId: 's_c', selectsProtocol: true },
    ],
    protocols: [
      {
        id: 'arrest',
        name: { en: 'Cardiac Arrest' },
        keywords: { en: ['not breathing'] },
        keyQuestions: [{ id: 'kq', slot: 'witnessed', stringId: 's_kq', expect: yesNo() }],
        determinants: [{ id: 'd_red', response: 'CODE_RED' }],
        postDispatch: ['pd_help'],
        postDispatchScripts: [
          { script: 'infant_cpr', when: [{ slot: 'age', lt: 1 }] },
          { script: 'adult_cpr' },
        ],
        dispatcherNotes: {
          prompts: ['note_prompt'],
          shortReport: ['note_report'],
        },
      },
    ],
    fallbackProtocol: 'arrest',
    scripts: [
      {
        id: 'adult_cpr',
        name: { en: 'Adult CPR' },
        source: 'I2: Adult CPR Instructions',
        steps: [
          {
            id: 'known',
            kind: 'ask',
            slot: 'knows_cpr',
            stringId: 'sc_known',
            expect: yesNo(),
            next: [{ whenOption: 'yes', goto: 'begin' }],
          },
          { id: 'listen', kind: 'say', stringId: 'sc_listen' },
          { id: 'position', kind: 'say', stringId: 'sc_position' },
          {
            id: 'aed_there',
            kind: 'ask',
            slot: 'aed_present',
            stringId: 'sc_aed_there',
            expect: yesNo(),
            next: [{ whenOption: 'yes', gotoScript: 'aed' }],
          },
          { id: 'push', kind: 'say', stringId: 'sc_push' },
          { id: 'begin', kind: 'stay', stringId: 'sc_stay' },
        ],
      },
      {
        id: 'infant_cpr',
        name: { en: 'Infant CPR' },
        steps: [
          { id: 'puffs', kind: 'say', stringId: 'sc_puffs' },
          { id: 'hold', kind: 'stay', stringId: 'sc_stay' },
        ],
      },
      {
        id: 'aed',
        name: { en: 'AED' },
        steps: [
          { id: 'power', kind: 'say', stringId: 'sc_power' },
          { id: 'follow', kind: 'stay', stringId: 'sc_follow' },
        ],
      },
    ],
    strings: {
      en: {
        greeting: '911.',
        closing: 'Help is on the way.',
        dispatch_confirm: 'Sending help now.',
        clarify: 'Sorry?',
        s_loc: 'What is the address?',
        s_age: 'How old is the person?',
        s_c: 'Tell me exactly what happened.',
        s_kq: 'Did anyone see it happen?',
        pd_help: 'Do not move the person.',
        sc_known: 'Does anyone there know how to do CPR?',
        sc_listen: "Listen carefully. I'll tell you what to do.",
        sc_position: 'Get the person flat on their back on the floor.',
        sc_aed_there: 'Is there a defibrillator nearby?',
        sc_push: 'Push hard and fast on the center of the chest.',
        sc_stay: "Keep going until help arrives. I'll stay on the line.",
        sc_puffs: 'Give two small puffs of air.',
        sc_power: 'Turn on the defibrillator.',
        sc_follow: 'Follow the voice prompts until help arrives.',
        note_prompt: 'Consider notifying the fire department.',
        note_report: 'Age, sex, location, chief complaint.',
      },
    },
  };
  patch(pack);
  return loadPack(pack) as ProtocolPack;
}

/** Drive a call to completion, answering by slot. */
function run(pack: ProtocolPack, slots: Record<string, string>) {
  const s = new DispatchSession(pack);
  s.start();
  let guard = 0;
  while (!s.isDone() && guard++ < 40) {
    const pending = s.pending();
    if (!pending) break;
    s.answer(slots[pending.slot] ?? 'unknown');
  }
  return s;
}

test('a v0.3 pack loads and keeps every v0.1/v0.2 guarantee', () => {
  const pack = v03Pack();
  assert.equal(pack.schemaVersion, '0.3');
  assert.equal(pack.scripts?.length, 3);
});

test('v0.3 features are refused in a pack that declares an older schema', () => {
  try {
    v03Pack((p) => {
      p['schemaVersion'] = '0.2';
    });
    assert.fail('expected PackValidationError');
  } catch (e) {
    assert.ok(e instanceof PackValidationError);
    assert.ok(e.problems.some((x) => x.includes('scripts require schemaVersion 0.3')));
    assert.ok(e.problems.some((x) => x.includes('postDispatchScripts requires schemaVersion 0.3')));
    assert.ok(e.problems.some((x) => x.includes('dispatcherNotes requires schemaVersion 0.3')));
  }
});

test('the call continues past dispatch into the instruction script', () => {
  const s = run(v03Pack(), {
    location: '12 Pine St',
    age: '58',
    complaint: 'he is not breathing',
    witnessed: 'yes',
    knows_cpr: 'no',
    aed_present: 'no',
  });
  const said = s.result().transcript.filter((t) => t.role === 'dispatcher').map((t) => t.text);
  assert.ok(said.includes('Sending help now.'), 'dispatch happened');
  assert.ok(said.includes("Listen carefully. I'll tell you what to do."), 'script ran after dispatch');
  assert.ok(said.includes('Push hard and fast on the center of the chest.'));
  assert.equal(said[said.length - 1], 'Help is on the way.', 'closing is still last');
  assert.deepEqual(s.result().scripts, ['adult_cpr']);
  assert.equal(s.result().response, 'CODE_RED', 'the response level is set before instructions');
});

test('an ask step branches: a caller who knows CPR skips the walk-through', () => {
  const s = run(v03Pack(), {
    location: '12 Pine St',
    age: '58',
    complaint: 'he is not breathing',
    knows_cpr: 'yes',
  });
  const said = s.result().transcript.filter((t) => t.role === 'dispatcher').map((t) => t.text);
  assert.ok(!said.includes("Listen carefully. I'll tell you what to do."));
  assert.ok(said.includes("Keep going until help arrives. I'll stay on the line."));
});

test('a card routes to the age-appropriate script, first match winning', () => {
  const infant = run(v03Pack(), {
    location: '12 Pine St',
    age: '0',
    complaint: 'the baby is not breathing',
  });
  assert.deepEqual(infant.result().scripts, ['infant_cpr']);
  const adult = run(v03Pack(), {
    location: '12 Pine St',
    age: '58',
    complaint: 'he is not breathing',
    knows_cpr: 'yes',
  });
  assert.deepEqual(adult.result().scripts, ['adult_cpr']);
});

test('a script hands off to another script and the caller keeps being led', () => {
  const s = run(v03Pack(), {
    location: '12 Pine St',
    age: '58',
    complaint: 'he is not breathing',
    knows_cpr: 'no',
    aed_present: 'yes',
  });
  assert.deepEqual(s.result().scripts, ['adult_cpr', 'aed']);
  const said = s.result().transcript.filter((t) => t.role === 'dispatcher').map((t) => t.text);
  assert.ok(said.includes('Turn on the defibrillator.'));
  assert.ok(!said.includes('Push hard and fast on the center of the chest.'), 'the jump was taken');
  assert.equal(said[said.length - 1], 'Help is on the way.');
});

test('dispatcher notes are never spoken, and may not double as a spoken string', () => {
  const pack = v03Pack();
  const notes = pack.protocols[0]!.dispatcherNotes!;
  const s = run(pack, {
    location: '12 Pine St',
    age: '58',
    complaint: 'he is not breathing',
    knows_cpr: 'no',
    aed_present: 'no',
  });
  const spoken = s.result().transcript.map((t) => t.text).join(' | ');
  for (const id of [...notes.prompts!, ...notes.shortReport!]) {
    const text = pack.strings['en']![id] as string;
    assert.ok(!spoken.includes(text), `note "${id}" leaked into the transcript`);
  }
  try {
    v03Pack((p) => {
      (p['protocols'] as { dispatcherNotes: { prompts: string[] } }[])[0]!.dispatcherNotes.prompts = [
        'pd_help',
      ];
    });
    assert.fail('expected PackValidationError');
  } catch (e) {
    assert.ok(e instanceof PackValidationError);
    assert.ok(e.problems.some((x) => x.includes('is also spoken to the caller')));
  }
});

test('scripts must be a DAG — a cycle is rejected at load, not at runtime', () => {
  try {
    v03Pack((p) => {
      const scripts = p['scripts'] as { id: string; steps: { id: string; next?: unknown[] }[] }[];
      // aed's terminal step points back at adult_cpr, closing the loop
      scripts[2]!.steps[1] = { id: 'follow', kind: 'say', stringId: 'sc_follow', next: [{ gotoScript: 'adult_cpr' }] } as never;
    });
    assert.fail('expected PackValidationError');
  } catch (e) {
    assert.ok(e instanceof PackValidationError);
    assert.ok(e.problems.some((x) => x.includes('cycle')), e instanceof PackValidationError ? e.problems.join('; ') : '');
  }
});

test('script references are checked at load', () => {
  const cases: [(p: Record<string, unknown>) => void, string][] = [
    [(p) => { (p['protocols'] as { postDispatchScripts: { script: string }[] }[])[0]!.postDispatchScripts[1]!.script = 'nope'; }, 'unknown script "nope"'],
    [(p) => { (p['scripts'] as { steps: { next?: { gotoScript?: string }[] }[] }[])[0]!.steps[3]!.next![0]!.gotoScript = 'nope'; }, 'jumps to unknown script "nope"'],
    [(p) => { (p['scripts'] as { steps: { next?: { goto?: string }[] }[] }[])[0]!.steps[0]!.next![0] = { whenOption: 'yes', goto: 'nowhere' }; }, 'targets unknown step "nowhere"'],
    [(p) => { (p['scripts'] as { steps: { next?: { whenOption?: string }[] }[] }[])[0]!.steps[0]!.next![0]!.whenOption = 'maybe'; }, 'unknown option "maybe"'],
  ];
  for (const [patch, expected] of cases) {
    try {
      v03Pack(patch);
      assert.fail(`expected PackValidationError for: ${expected}`);
    } catch (e) {
      assert.ok(e instanceof PackValidationError, `${expected}: wrong error`);
      assert.ok(e.problems.some((x) => x.includes(expected)), `${expected}: got ${e.problems.join('; ')}`);
    }
  }
});

test('a script step missing a string in a locale fails the grounding check', () => {
  try {
    v03Pack((p) => {
      delete (p['strings'] as Record<string, Record<string, string>>)['en']!['sc_push'];
    });
    assert.fail('expected PackValidationError');
  } catch (e) {
    assert.ok(e instanceof PackValidationError);
    assert.ok(e.problems.some((x) => x.includes('missing string "sc_push"')));
  }
});

test('the script sweep walks every step and every walk closes the call', () => {
  const pack = v03Pack();
  const sweep = sweepInstructionScripts(pack, 'en');
  assert.ok(sweep.scripts.length >= 4, `only ${sweep.scripts.length} walks`);
  assert.deepEqual(sweep.unreachable, [], 'every script step is reachable');
  assert.deepEqual(sweep.capped, []);
  const report = runBatch(pack, sweep.scripts);
  assert.deepEqual(report.incomplete, []);
  for (const call of report.calls) {
    assert.ok(call.result.response, `${call.scriptId} dispatched before instructions`);
  }
});

test('the sweep reports unreachable steps rather than assuming coverage', () => {
  // A step sitting after the script's terminal `stay` can never be read.
  const pack = v03Pack((p) => {
    const scripts = p['scripts'] as { id: string; steps: unknown[] }[];
    scripts[1]!.steps.push({ id: 'dead', kind: 'say', stringId: 'sc_puffs' });
  });
  const sweep = sweepInstructionScripts(pack, 'en');
  assert.deepEqual(sweep.unreachable, ['infant_cpr#dead']);
});

test('the graph exposes script steps so a visualizer can animate instructions', () => {
  const graph = packGraph(v03Pack());
  const stepNodes = graph.nodes.filter((n) => n.kind === 'script_step');
  assert.equal(stepNodes.length, 10);
  assert.ok(stepNodes.some((n) => n.id === 'adult_cpr#push' && n.scriptId === 'adult_cpr'));
  assert.ok(
    graph.edges.some((e) => e.from === 'arrest:$determine' && e.to === 'infant_cpr#puffs'),
    'the card is linked to the script it hands off to',
  );
  assert.ok(
    graph.edges.some((e) => e.from === 'adult_cpr#aed_there' && e.to === 'aed#power'),
    'cross-script jumps are edges too',
  );
});

test('personas change nothing about which script runs', () => {
  const pack = v03Pack();
  const slots = {
    location: '12 Pine St',
    age: '58',
    complaint: 'he is not breathing',
    knows_cpr: 'no',
    aed_present: 'yes',
  };
  const baseline = run(pack, slots).result();
  for (const seed of [2, 7, 2029]) {
    const s = new DispatchSession(pack, { persona: { seed, confirmRate: 1, clarifyAttempts: 2 } });
    s.start();
    let guard = 0;
    while (!s.isDone() && guard++ < 40) {
      const pending = s.pending();
      if (!pending) break;
      s.answer(slots[pending.slot as keyof typeof slots] ?? 'unknown');
    }
    assert.deepEqual(s.result().scripts, baseline.scripts, `seed ${seed} changed the script path`);
    assert.equal(s.result().response, baseline.response);
    assert.equal(s.result().determinantId, baseline.determinantId);
  }
});
