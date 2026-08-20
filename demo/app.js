// Live decision-tree demo: runs a DispatchSession in the browser and animates
// its walk over the packGraph. Simulation only — see the banner.
import { DispatchSession } from '../dist/engine.js';
import { packGraph, DISPATCH_NODE_ID } from '../dist/graph.js';

const RESPONSE_LABELS = {
  ALS_HOT: '🚑 Advanced Life Support — lights & siren',
  ALS_COLD: '🚑 Advanced Life Support — routine response',
  BLS_COLD: '🚑 Basic Life Support — routine response',
};

const SLOT_LABELS = {
  address: 'Location', callback: 'Callback number', complaint: 'Chief complaint',
  age: 'Patient age', conscious: 'Consciousness', breathing: 'Breathing',
  cp_alert: 'Alertness', cp_clammy: 'Skin signs', unc_breathing: 'Breathing now',
};

const pack = await (await fetch('../packs/us-nhtsa-emd/pack.json')).json();
const graph = packGraph(pack);

// --- layout: case entry in column 0, one column per protocol, dispatch last ---
const NODE_W = 170, NODE_H = 42, COL_W = 230, ROW_H = 66, PAD = 20;
const pos = new Map();
const caseEntry = graph.nodes.filter((n) => n.kind === 'case_entry');
caseEntry.forEach((n, i) => pos.set(n.id, { x: PAD, y: PAD + i * ROW_H }));
pack.protocols.forEach((p, col) => {
  const nodes = graph.nodes.filter((n) => n.protocolId === p.id);
  nodes.forEach((n, i) => pos.set(n.id, { x: PAD + (col + 1) * COL_W, y: PAD + i * ROW_H }));
});
const maxY = Math.max(...[...pos.values()].map((v) => v.y));
pos.set(DISPATCH_NODE_ID, { x: PAD + (pack.protocols.length + 1) * COL_W, y: maxY / 2 });

function nodeLabel(n) {
  if (n.kind === 'dispatch') return ['Dispatch', 'responders sent'];
  if (n.kind === 'determine') return ['Determine response', n.protocolId];
  return [SLOT_LABELS[n.slot] ?? n.slot, n.protocolId ?? 'case entry'];
}

// --- render SVG ---
const svgNS = 'http://www.w3.org/2000/svg';
const width = PAD * 2 + (pack.protocols.length + 2) * COL_W;
const height = maxY + NODE_H + PAD * 2;
const svg = document.createElementNS(svgNS, 'svg');
svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
svg.setAttribute('width', width);
document.getElementById('tree').append(svg);

const edgeEls = new Map();
for (const e of graph.edges) {
  const a = pos.get(e.from), b = pos.get(e.to);
  if (!a || !b) continue;
  const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
  const path = document.createElementNS(svgNS, 'path');
  const sameCol = Math.abs(a.x - b.x) < 1;
  path.setAttribute('d', sameCol
    ? `M ${a.x + NODE_W / 2} ${a.y + NODE_H} C ${a.x + NODE_W / 2} ${a.y + NODE_H + 18}, ${b.x + NODE_W / 2} ${b.y - 18}, ${b.x + NODE_W / 2} ${b.y}`
    : `M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`);
  path.setAttribute('class', 'edge');
  svg.append(path);
  edgeEls.set(`${e.from}→${e.to}`, path);
  if (e.label) {
    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('class', 'edge-label');
    t.setAttribute('x', sameCol ? a.x + NODE_W / 2 + 6 : (x1 + x2) / 2);
    t.setAttribute('y', sameCol ? (a.y + NODE_H + b.y) / 2 + 3 : (y1 + y2) / 2 - 4);
    t.textContent = e.label;
    svg.append(t);
  }
}

const nodeEls = new Map();
for (const n of graph.nodes) {
  const p = pos.get(n.id);
  const g = document.createElementNS(svgNS, 'g');
  g.setAttribute('class', 'node');
  g.setAttribute('transform', `translate(${p.x}, ${p.y})`);
  const rect = document.createElementNS(svgNS, 'rect');
  rect.setAttribute('width', NODE_W); rect.setAttribute('height', NODE_H); rect.setAttribute('rx', 8);
  const [main, sub] = nodeLabel(n);
  const t1 = document.createElementNS(svgNS, 'text');
  t1.setAttribute('x', 10); t1.setAttribute('y', 18); t1.textContent = main;
  const t2 = document.createElementNS(svgNS, 'text');
  t2.setAttribute('x', 10); t2.setAttribute('y', 32); t2.setAttribute('class', 'sub'); t2.textContent = sub;
  g.append(rect, t1, t2);
  svg.append(g);
  nodeEls.set(n.id, g);
}

// --- session wiring ---
const transcriptEl = document.getElementById('transcript');
const form = document.getElementById('form');
const input = document.getElementById('input');
const miles = {
  phase: document.querySelector('#m-phase span'),
  assess: document.querySelector('#m-assess span'),
  protocol: document.querySelector('#m-protocol span'),
  dispatch: document.querySelector('#m-dispatch span'),
};
let session = null;

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  transcriptEl.append(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function setActive(nodeId) {
  for (const el of nodeEls.values()) el.classList.remove('active');
  const el = nodeEls.get(nodeId);
  if (el) { el.classList.add('active', 'visited'); el.classList.remove('dim'); }
}

function dimOtherProtocols(protocolId) {
  for (const n of graph.nodes) {
    if (n.protocolId && n.protocolId !== protocolId) nodeEls.get(n.id)?.classList.add('dim');
  }
}

function markEdge(from, to) {
  edgeEls.get(`${from}→${to}`)?.classList.add('taken');
}

let lastNodeId = null;
function onEvent(e) {
  switch (e.type) {
    case 'phase':
      miles.phase.textContent = { case_entry: 'Case entry', key_questions: 'Key questions', done: 'Call complete' }[e.phase] ?? e.phase;
      document.getElementById('m-phase').classList.add('active');
      break;
    case 'ask':
      if (lastNodeId) markEdge(lastNodeId, e.nodeId);
      setActive(e.nodeId);
      lastNodeId = e.nodeId;
      miles.assess.textContent = SLOT_LABELS[e.slot] ?? e.slot;
      document.getElementById('m-assess').classList.add('active');
      break;
    case 'protocol_selected': {
      const p = pack.protocols.find((x) => x.id === e.protocolId);
      miles.protocol.textContent = `${p?.name[pack.defaultLocale] ?? e.protocolId}${e.via === 'fallback' ? ' (fallback)' : ''}`;
      document.getElementById('m-protocol').classList.add('hit');
      dimOtherProtocols(e.protocolId);
      break;
    }
    case 'edge':
      markEdge(e.from, e.to);
      break;
    case 'determinant':
      markEdge(lastNodeId, e.nodeId);
      setActive(e.nodeId);
      markEdge(e.nodeId, DISPATCH_NODE_ID);
      lastNodeId = e.nodeId;
      miles.dispatch.textContent = RESPONSE_LABELS[e.response] ?? e.response;
      document.getElementById('m-dispatch').classList.add('hit');
      miles.assess.textContent = '—';
      setTimeout(() => setActive(DISPATCH_NODE_ID), 400);
      break;
  }
}

function restart() {
  transcriptEl.replaceChildren();
  for (const el of nodeEls.values()) el.classList.remove('active', 'visited', 'dim');
  for (const el of edgeEls.values()) el.classList.remove('taken');
  for (const [key, el] of Object.entries(miles)) { el.textContent = '—'; }
  document.querySelectorAll('.mile').forEach((m) => m.classList.remove('hit', 'active'));
  lastNodeId = null;
  const locale = document.getElementById('locale').value;
  session = new DispatchSession(pack, { locale, onEvent });
  for (const u of session.start()) addMsg('dispatcher', u.text);
  input.focus();
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const text = input.value.trim();
  if (!text || !session || session.isDone()) return;
  input.value = '';
  addMsg('caller', text);
  for (const u of session.answer(text)) addMsg('dispatcher', u.text);
});
document.getElementById('restart').addEventListener('click', restart);
document.getElementById('locale').addEventListener('change', restart);
restart();
