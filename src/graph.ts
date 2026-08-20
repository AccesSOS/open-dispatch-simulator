import type { GraphEdge, GraphNode, PackGraph, ProtocolPack, Question } from './types.js';

/** Graph node id for a case-entry question. */
export const caseEntryNodeId = (q: Question): string => q.id;
/** Graph node id for a protocol key question. */
export const keyQuestionNodeId = (protocolId: string, q: Question): string =>
  `${protocolId}:${q.id}`;
/** Graph node id for a protocol's determinant step. */
export const determineNodeId = (protocolId: string): string => `${protocolId}:$determine`;
/** Terminal node shared by every path: responders dispatched. */
export const DISPATCH_NODE_ID = '$dispatch';

/**
 * Render a pack's decision structure as nodes and edges for visualization.
 * DispatchSession events carry matching nodeIds, so a UI can animate the
 * live call over this graph.
 */
export function packGraph(pack: ProtocolPack): PackGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const questionEdges = (
    q: Question,
    selfId: string,
    seqTargetId: string | null,
    resolveGoto: (goto: string) => string,
  ) => {
    const conditional = q.next ?? [];
    for (const e of conditional) {
      edges.push({ from: selfId, to: resolveGoto(e.goto), ...(e.whenOption !== undefined && { label: e.whenOption }) });
    }
    const hasDefault = conditional.some((e) => e.whenOption === undefined);
    if (!hasDefault && seqTargetId) edges.push({ from: selfId, to: seqTargetId });
  };

  // Case entry chain. Its '$determine' edges resolve to the shared dispatch
  // node: which protocol determines is only known at runtime.
  pack.caseEntry.forEach((q, i) => {
    nodes.push({
      id: caseEntryNodeId(q),
      kind: 'case_entry',
      questionId: q.id,
      slot: q.slot,
      stringId: q.stringId,
    });
    const nextQ = pack.caseEntry[i + 1];
    questionEdges(q, caseEntryNodeId(q), nextQ ? caseEntryNodeId(nextQ) : null, (goto) =>
      goto === '$determine' ? DISPATCH_NODE_ID : goto,
    );
  });

  const selector = pack.caseEntry.find((q) => q.selectsProtocol);
  const lastCaseEntry = pack.caseEntry[pack.caseEntry.length - 1];

  for (const p of pack.protocols) {
    const detId = determineNodeId(p.id);
    const rootId = p.keyQuestions[0] ? keyQuestionNodeId(p.id, p.keyQuestions[0]) : detId;

    // Selection edge: the chief-complaint answer routes into this protocol
    // (flow enters after case entry completes).
    if (selector && lastCaseEntry) {
      edges.push({
        from: caseEntryNodeId(lastCaseEntry),
        to: rootId,
        label: p.name[pack.defaultLocale] ?? p.id,
      });
    }

    p.keyQuestions.forEach((q, i) => {
      nodes.push({
        id: keyQuestionNodeId(p.id, q),
        kind: 'key_question',
        protocolId: p.id,
        questionId: q.id,
        slot: q.slot,
        stringId: q.stringId,
      });
      const nextQ = p.keyQuestions[i + 1];
      questionEdges(
        q,
        keyQuestionNodeId(p.id, q),
        nextQ ? keyQuestionNodeId(p.id, nextQ) : detId,
        (goto) => (goto === '$determine' ? detId : keyQuestionNodeId(p.id, { id: goto } as Question)),
      );
    });

    nodes.push({ id: detId, kind: 'determine', protocolId: p.id });
    edges.push({ from: detId, to: DISPATCH_NODE_ID });
  }

  nodes.push({ id: DISPATCH_NODE_ID, kind: 'dispatch' });
  return { nodes, edges };
}
