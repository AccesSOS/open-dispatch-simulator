import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DispatchSession, loadPackFromFile } from '../src/index.js';

const packPath = fileURLToPath(new URL('../packs/mx-cnie-911/pack.json', import.meta.url));
const pack = loadPackFromFile(packPath);

function run(caseAnswers: string[], bySlot: Record<string, string>) {
  const s = new DispatchSession(pack);
  s.start();
  for (const a of caseAnswers) {
    if (s.isDone()) break;
    s.answer(a);
  }
  let guard = 0;
  while (!s.isDone() && guard++ < 50) {
    s.answer(bySlot[s.pending()!.slot] ?? 'nada más que yo sepa');
  }
  return s.result();
}

// Case entry: ubicación, teléfono, qué sucede, nombre, edad, consciente, respira
test('cnie pack loads: es-only, CNIE priority taxonomy, open-use license', () => {
  assert.deepEqual(pack.locales, ['es']);
  assert.equal(pack.provenance.license, 'Libre-Uso-MX');
  const responses = new Set(pack.protocols.flatMap((p) => p.determinants.map((d) => d.response)));
  assert.deepEqual([...responses].sort(), ['ALTA', 'MEDIA']);
});

test('10314: chest-pain complaint routes to Infarto with the catalog symptom probes, ALTA', () => {
  const r = run(
    ['Av. Reforma 10, CDMX', '55-5555-0100', 'mi esposo tiene un dolor de pecho muy fuerte', 'Ana', '58', 'sí', 'sí, respira'],
    { inf_dolor: 'sí, una opresión fuerte', inf_brazo: 'sí, el brazo', inf_sudor: 'sí, sudando', inf_nausea: 'no' },
  );
  assert.equal(r.protocolId, 'inc10314_infarto');
  assert.equal(r.determinantId, 'inc10314_alta');
  assert.equal(r.response, 'ALTA');
  assert.equal(r.numbers['edad'], 58);
});

test('CNIE reclassification: inconsciente + no respira jumps to 10313 Paro', () => {
  const r = run(
    ['Calle Juárez 5', '55-5555-0111', 'dolor de pecho', 'Luis', '70', 'no, está inconsciente', 'no'],
    { paro_responde: 'no', paro_desde: 'como dos minutos' },
  );
  assert.equal(r.protocolId, 'inc10313_paro_cardiorrespiratorio', 'complaint said chest pain; state says paro');
  assert.equal(r.response, 'ALTA');
});

test('CNIE reclassification: inconsciente pero respira jumps to 10308; agonal breathing re-jumps to 10313', () => {
  const r = run(
    ['Calle Juárez 5', '55-5555-0122', 'se desmayó mi mamá', 'Rosa', '80', 'no', 'sí, respira'],
    { inc_respira_normal: 'no, jadea apenas' },
  );
  // 10308 asked "¿respira normalmente?" — agonal answer re-jumps to 10313 per the CNIE definitions
  assert.equal(r.protocolId, 'inc10313_paro_cardiorrespiratorio');
  assert.equal(r.response, 'ALTA');

  const r2 = run(
    ['Calle Juárez 5', '55-5555-0122', 'se desmayó mi mamá', 'Rosa', '80', 'no', 'sí, respira'],
    { inc_respira_normal: 'sí, normalmente', inc_primera_vez: 'sí, primera vez' },
  );
  assert.equal(r2.protocolId, 'inc10308_persona_inconsciente');
  assert.equal(r2.determinantId, 'inc10308_alta');
});

test('10224 Deshidratación carries the catalog MEDIA priority', () => {
  const r = run(
    ['Calle Hidalgo 22', '55-5555-0133', 'creo que está deshidratado', 'Mario', '85', 'sí', 'sí'],
    {},
  );
  assert.equal(r.protocolId, 'inc10224_deshidratacion');
  assert.equal(r.response, 'MEDIA');
});

test('unmatched complaint falls back to 10310 Urgencia por enfermedad general', () => {
  const r = run(
    ['Calle Hidalgo 22', '55-5555-0144', 'mi vecino se siente muy raro', 'Mario', '40', 'sí', 'sí'],
    {},
  );
  assert.equal(r.protocolId, 'inc10310_urgencia_general');
  assert.equal(r.response, 'ALTA');
});
