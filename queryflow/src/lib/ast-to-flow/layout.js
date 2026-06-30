// Diagram layout — positions flow blocks/nodes for SVG rendering (DESIGN §4.5).
// Main block is a vertical top-down column; CTE/subquery blocks are placed in
// columns to the right, linked to their parent node. Supports collapse via `collapsed` set.

const NODE_W = 210;
const NODE_H = 46;
const NODE_H_SUB = 58; // node with subtitle
const V_GAP = 24;
const COL_GAP = 70;
const PAD = 28;

export function layoutFlow(flow, collapsed = new Set()) {
  const positions = {}; // nodeId -> {x,y,w,h}
  const blockBoxes = {}; // blockId -> {x,y,w,h}
  const edges = []; // sequential + block-link connectors
  const columns = []; // track max bottom per column index

  // index child blocks by parent node (subqueries/derived/union) and by parent block (CTEs)
  const childrenOf = {};
  const feedersOf = {};
  for (const b of flow.blocks) {
    if (b.parentNodeId) (childrenOf[b.parentNodeId] ||= []).push(b);
    else if (b.parentBlockId) (feedersOf[b.parentBlockId] ||= []).push(b);
  }
  const mainBlocks = flow.blocks.filter((b) => !b.parentNodeId && !b.parentBlockId);

  function nodeHeight(n) {
    return n.subtitle ? NODE_H_SUB : NODE_H;
  }

  // place a block's nodes vertically starting at (x, yStart); returns bottom y
  function placeBlock(block, colIndex, yStart) {
    const x = PAD + colIndex * (NODE_W + COL_GAP);
    let y = yStart;
    let prevId = null;
    const isCollapsed = collapsed.has(block.id);
    const visibleNodes = block.nodes;

    // CTE feeders execute first → stack them above this block in the same column.
    const feeders = feedersOf[block.id] || [];
    const feederLastNodes = [];
    if (feeders.length && !isCollapsed) {
      for (const fb of feeders) {
        const fbBottom = placeBlock(fb, colIndex, y);
        const last = fb.nodes[fb.nodes.length - 1];
        if (last) feederLastNodes.push(last.id);
        y = fbBottom + V_GAP * 1.5;
      }
    }
    let top = y;

    for (const n of visibleNodes) {
      const h = nodeHeight(n);
      positions[n.id] = { x, y, w: NODE_W, h, blockId: block.id };
      // link each CTE feeder's last node into this block's first node
      if (!prevId && feederLastNodes.length) {
        for (const flid of feederLastNodes) {
          const fp = positions[flid];
          if (fp) edges.push({ kind: 'feeder', x1: fp.x + NODE_W / 2, y1: fp.y + fp.h, x2: x + NODE_W / 2, y2: y, label: 'feeds' });
        }
      }
      if (prevId) {
        const p = positions[prevId];
        edges.push({
          kind: 'seq',
          x1: p.x + NODE_W / 2, y1: p.y + p.h,
          x2: x + NODE_W / 2, y2: y
        });
      }
      prevId = n.id;
      let childBottom = y + h;

      // place child blocks (subqueries/CTEs) of this node in next column, unless collapsed
      const kids = childrenOf[n.id] || [];
      if (kids.length && !isCollapsed) {
        let childY = y;
        for (const kb of kids) {
          const cb = placeBlock(kb, colIndex + 1, childY);
          // connector from this node to child block's first node
          const first = kb.nodes[0];
          if (first && positions[first.id]) {
            const fp = positions[first.id];
            edges.push({
              kind: kb.correlated ? 'correlated' : 'subflow',
              x1: x + NODE_W, y1: y + h / 2,
              x2: fp.x, y2: fp.y + fp.h / 2,
              label: kb.correlated ? 'correlated' : ''
            });
          }
          childY = cb + V_GAP;
          childBottom = Math.max(childBottom, cb);
        }
      }
      y = Math.max(y + h + V_GAP, childBottom + V_GAP);
    }

    blockBoxes[block.id] = { x: x - 8, y: top - 8, w: NODE_W + 16, h: y - top - V_GAP + 16, kind: block.kind, label: block.label, correlated: block.correlated };
    return y - V_GAP;
  }

  let cursorY = PAD;
  for (const mb of mainBlocks) {
    const bottom = placeBlock(mb, 0, cursorY);
    cursorY = bottom + V_GAP * 2;
  }

  // overall canvas size
  let maxX = 0, maxY = 0;
  for (const id in positions) {
    maxX = Math.max(maxX, positions[id].x + positions[id].w);
    maxY = Math.max(maxY, positions[id].y + positions[id].h);
  }
  return {
    positions,
    blockBoxes,
    edges,
    width: maxX + PAD,
    height: maxY + PAD
  };
}

export const LAYOUT_CONST = { NODE_W, NODE_H, NODE_H_SUB };
