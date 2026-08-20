import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DispatchSession, loadPack, loadPackFromFile, PackValidationError } from '../src/index.js';
import type { ProtocolPack, Utterance } from '../src/index.js';

const packPath = fileURLToPath(new URL('../packs/us-nhtsa-emd/pack.json', import.meta.url));
const freshPack = (): ProtocolPack => loadPackFromFile(packPath);

/** Recompute an utterance's text straight from the pack catalog; proves the
 * engine can only speak catalog strings (the grounding property). */
function expectGrounded(pack: ProtocolPack, locale: string, u: Utterance, answers: Record<string, string>) {
  const template = pack.strings[locale]![u.stringId];
  assert.ok(template !== undefined, `stringId ${u.stringId} not in ${locale} catalog`);
  const expected = template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, s: string) => answers[s]!);
  assert.equal(u.text, expected);
}

test('reference pack loads and validates', () => {
  const pack = freshPack();
  assert.equal(pack.id, 'us-nhtsa-emd');
  assert.deepEqual(pack.locales, ['en', 'es']);
});

test('loader rejects a pack with a missing localized string', () => {
  const broken = freshPack();
  delete broken.strings['es']!['pd_callback_worse'];
  assert.throws(
    () => loadPack(broken, 'tampered'),
    (e: unknown) =>
      e instanceof PackValidationError && e.problems.some((p) => p.includes('pd_callback_worse')),
  );
});

test('loader rejects a template interpolating an unknown slot', () => {
  const broken = freshPack();
  broken.strings['en']!['dispatch_confirm'] = 'Help is on the way to {gps_position}.';
  assert.throws(
    () => loadPack(broken, 'tampered'),
    (e: unknown) => e instanceof PackValidationError && e.problems.some((p) => p.includes('gps_position')),
  );
});

test('english chest-pain call runs case entry, branches, and dispatches', () => {
  const pack = freshPack();
  const s = new DispatchSession(pack);
  const answers: Record<string, string> = {};
  const all: Utterance[] = [];
  const feed = (reply?: string) => {
    const out = reply === undefined ? s.start() : s.answer(reply);
    all.push(...out);
    return out;
  };

  let out = feed();
  assert.deepEqual(out.map((u) => u.stringId), ['greeting', 'q_address']);

  answers['address'] = '123 Main Street, Springfield';
  out = feed(answers['address']);
  assert.equal(out[0]!.stringId, 'q_callback');
  feed('555-0100');
  out = s.answer('my dad is having chest pain');
  assert.equal(out[0]!.stringId, 'q_age');
  feed('67');
  out = s.answer('yes he is awake');
  assert.equal(out[0]!.stringId, 'q_breathing');
  out = s.answer('yes, breathing');
  assert.equal(out[0]!.stringId, 'kq_cp_alert', 'protocol key questions follow case entry');
  out = s.answer('yes, alert');
  assert.equal(out[0]!.stringId, 'kq_cp_clammy');
  out = s.answer('yes, very sweaty');
  all.push(...out);

  assert.ok(s.isDone());
  assert.deepEqual(
    out.map((u) => u.stringId),
    ['dispatch_confirm', 'pd_rest', 'pd_nothing_by_mouth', 'pd_callback_worse', 'closing'],
  );
  const r = s.result();
  assert.equal(r.protocolId, 'chest_pain');
  assert.equal(r.determinantId, 'cp_clammy');
  assert.equal(r.response, 'ALS_HOT');

  for (const u of all) expectGrounded(pack, 'en', u, { address: answers['address']! });
});

test('not-alert branch short-circuits to determinant cp_not_alert', () => {
  const s = new DispatchSession(freshPack());
  s.start();
  s.answer('9 Elm Ave');
  s.answer('555-0111');
  s.answer('chest pressure');
  s.answer('50');
  s.answer('yes');
  s.answer('yes');
  const out = s.answer('no, he seems confused'); // kq_cp_alert -> no
  assert.equal(out[0]!.stringId, 'dispatch_confirm', 'skips kq_cp_clammy');
  const r = s.result();
  assert.equal(r.determinantId, 'cp_not_alert');
  assert.equal(r.response, 'ALS_HOT');
});

test('case-entry "not breathing" short-circuits straight to dispatch', () => {
  const s = new DispatchSession(freshPack());
  s.start();
  s.answer('42 Oak Lane');
  s.answer('555-0122');
  s.answer('she passed out'); // selects unconscious_fainting
  s.answer('30');
  s.answer('no, unconscious');
  const out = s.answer('no'); // q_breathing -> no => $determine
  assert.equal(out[0]!.stringId, 'dispatch_confirm');
  const r = s.result();
  assert.equal(r.protocolId, 'unconscious_fainting');
  assert.equal(r.response, 'ALS_HOT');
});

test('unmatched complaint falls back to the fallback protocol', () => {
  const s = new DispatchSession(freshPack());
  s.start();
  s.answer('7 Pine Ct');
  s.answer('555-0133');
  s.answer('my toe hurts');
  s.answer('25');
  s.answer('yes');
  const out = s.answer('yes');
  assert.equal(out[0]!.stringId, 'dispatch_confirm', 'fallback protocol has no key questions');
  const r = s.result();
  assert.equal(r.protocolId, 'general_medical');
  assert.equal(r.response, 'BLS_COLD');
});

test('spanish call speaks only from the es catalog', () => {
  const pack = freshPack();
  const s = new DispatchSession(pack, { locale: 'es' });
  const all: Utterance[] = [];
  all.push(...s.start());
  const address = 'Calle Reforma 10, Colonia Centro';
  all.push(...s.answer(address));
  all.push(...s.answer('555-0144'));
  all.push(...s.answer('mi papá tiene dolor de pecho'));
  all.push(...s.answer('70'));
  all.push(...s.answer('sí'));
  all.push(...s.answer('sí, respira'));
  all.push(...s.answer('sí, alerta'));
  all.push(...s.answer('no, la piel está seca'));

  assert.ok(s.isDone());
  const r = s.result();
  assert.equal(r.protocolId, 'chest_pain');
  assert.equal(r.determinantId, 'cp_default');
  assert.equal(r.response, 'ALS_COLD');
  for (const u of all) expectGrounded(pack, 'es', u, { address });
  assert.ok(all.some((u) => u.text.includes('La ayuda va en camino a Calle Reforma 10')));
});

test('unsupported locale is rejected up front', () => {
  assert.throws(() => new DispatchSession(freshPack(), { locale: 'fr' }), /does not support locale/);
});
