import type { Person, PersonId } from '../types/pedigree';

export type Side = 'left' | 'right' | 'center';

export type PositionedNode = {
  id: PersonId;
  x: number; // left
  y: number; // top
  width: number;
  height: number;
  generation: number; // self=0, parents=-1, grandparents=-2, children=+1 ...
  side: Side;
};

export type Edge = {
  parentId: PersonId;
  childId: PersonId;
};

export type LayoutResult = {
  canvasWidth: number;
  canvasHeight: number;
  nodes: PositionedNode[];
  edges: Edge[];
  nodeById: Record<PersonId, PositionedNode>;
};

type RowKey = `${number}:${Side}`;

function rowKey(gen: number, side: Side): RowKey {
  return `${gen}:${side}`;
}

function getChildren(people: Record<PersonId, Person>, parentId: PersonId): Person[] {
  const out: Person[] = [];
  for (const p of Object.values(people)) {
    if (p.fatherId === parentId || p.motherId === parentId) out.push(p);
  }
  return out;
}

function inferSpouseSide(baseSide: Side): Side {
  if (baseSide === 'center') return 'center';
  return baseSide;
}

function reorderRowBySpouseAdjacency(ids: PersonId[], people: Record<PersonId, Person>): PersonId[] {
  const baseSorted = [...ids];
  const used = new Set<PersonId>();
  const out: PersonId[] = [];

  for (const id of baseSorted) {
    if (used.has(id)) continue;
    used.add(id);
    out.push(id);

    const spouseId = people[id]?.spouseId;
    if (!spouseId) continue;
    if (used.has(spouseId)) continue;
    if (!baseSorted.includes(spouseId)) continue;
    used.add(spouseId);
    out.push(spouseId);
  }

  return out;
}

function computeEdges(people: Record<PersonId, Person>, included: Set<PersonId>): Edge[] {
  const edges: Edge[] = [];
  for (const p of Object.values(people)) {
    if (!included.has(p.id)) continue;
    if (p.fatherId && included.has(p.fatherId)) {
      edges.push({ parentId: p.fatherId, childId: p.id });
    }
    if (p.motherId && included.has(p.motherId)) {
      edges.push({ parentId: p.motherId, childId: p.id });
    }
  }
  return edges;
}

export type BuildLayoutOptions = {
  selfId: PersonId;
  maxAncestorDepth: number; // 0..N (parents=1, grandparents=2)
  maxDescendantDepth: number; // 0..N
  cardWidth: number;
  cardHeight: number;
  colGap: number;
  rowGap: number;
  padding: number;
  autoTune?: boolean;
  minCardWidth?: number;
  minColGap?: number;
};

/**
 * 규칙(요구사항 반영):
 * - "나" 기준 세대(y)는 고정 간격으로 정렬(부모 형제는 같은 줄, 사촌은 나와 같은 줄 등)
 * - 친가(left) / 외가(right)는 중앙을 기준으로 대칭 배치
 * - 같은 줄(row)에서는 createdAt 순으로 정렬 → 최신 추가가 옆(맨 끝)에 배치됨
 */
export function buildPedigreeLayout(
  people: Record<PersonId, Person>,
  opts: BuildLayoutOptions,
): LayoutResult {
  const self = people[opts.selfId];
  if (!self) {
    return {
      canvasWidth: 0,
      canvasHeight: 0,
      nodes: [],
      edges: [],
      nodeById: {},
    };
  }

  const included = new Set<PersonId>();
  included.add(self.id);

  // Ancestors up to N (and their siblings + cousin generation)
  const queue: Array<{ id: PersonId; gen: number; side: Side }> = [
    { id: self.id, gen: 0, side: 'center' },
  ];

  const generationById = new Map<PersonId, number>();
  const sideById = new Map<PersonId, Side>();
  generationById.set(self.id, 0);
  sideById.set(self.id, 'center');

  const push = (id: PersonId | undefined, gen: number, side: Side) => {
    if (!id) return;
    if (!people[id]) return;
    if (!generationById.has(id)) {
      generationById.set(id, gen);
      sideById.set(id, side);
      queue.push({ id, gen, side });
    }
    included.add(id);
  };

  // Expand: parents, grandparents, siblings/cousins by parent links, and descendants up to N.
  while (queue.length) {
    const cur = queue.shift()!;
    const person = people[cur.id];
    if (!person) continue;

    const gen = generationById.get(cur.id) ?? 0;
    const side = sideById.get(cur.id) ?? 'center';

    // Parents (ancestors)
    if (gen > -opts.maxAncestorDepth) {
      if (cur.id === self.id) {
        push(person.fatherId, gen - 1, 'left');
        push(person.motherId, gen - 1, 'right');
      } else if (side === 'left') {
        push(person.fatherId, gen - 1, 'left');
        push(person.motherId, gen - 1, 'left');
      } else if (side === 'right') {
        push(person.fatherId, gen - 1, 'right');
        push(person.motherId, gen - 1, 'right');
      }
    }

    // Children (descendants)
    if (gen < opts.maxDescendantDepth) {
      for (const child of getChildren(people, person.id)) {
        const childSide =
          cur.id === self.id ? 'center' : side; // descendants inherit side (except self -> center)
        push(child.id, gen + 1, childSide);
      }
    }

    // Spouse: same generation / same side row
    if (person.spouseId) {
      push(person.spouseId, gen, inferSpouseSide(side));
    }

    // Siblings: people with same parents -> same generation row
    const fatherId = person.fatherId;
    const motherId = person.motherId;
    if (fatherId || motherId) {
      for (const other of Object.values(people)) {
        if (other.id === person.id) continue;
        const sameFather = fatherId && other.fatherId === fatherId;
        const sameMother = motherId && other.motherId === motherId;
        if (sameFather || sameMother) {
          push(other.id, gen, side);
        }
      }
    }
  }

  // Build rows
  const rows = new Map<RowKey, PersonId[]>();
  const addToRow = (id: PersonId) => {
    const gen = generationById.get(id) ?? 0;
    const side = sideById.get(id) ?? 'center';
    const key = rowKey(gen, side);
    const arr = rows.get(key) ?? [];
    arr.push(id);
    rows.set(key, arr);
  };
  for (const id of included) addToRow(id);

  // sort within row by createdAt (older first; newest last)
  for (const [key, ids] of rows.entries()) {
    ids.sort((a, b) => {
      const pa = people[a];
      const pb = people[b];
      const ta = pa?.createdAt ? Date.parse(pa.createdAt) : 0;
      const tb = pb?.createdAt ? Date.parse(pb.createdAt) : 0;
      return ta - tb;
    });
    rows.set(key, reorderRowBySpouseAdjacency(ids, people));
  }

  // ---- 자동 튜닝(한 줄에 노드가 많아질수록 카드/간격을 살짝 줄여 한 화면에 더 잘 들어오게) ----
  const maxRowLen = Math.max(1, ...Array.from(rows.values()).map(v => v.length));
  const shrink = Math.max(0, maxRowLen - 4);

  const minCardWidth = opts.minCardWidth ?? 140;
  const minColGap = opts.minColGap ?? 18;

  const cardWidth = opts.autoTune
    ? Math.max(minCardWidth, Math.round(opts.cardWidth - shrink * 10))
    : opts.cardWidth;
  const colGap = opts.autoTune
    ? Math.max(minColGap, Math.round(opts.colGap - shrink * 4))
    : opts.colGap;

  const cardHeight = opts.cardHeight;
  const rowGap = opts.rowGap;
  const padding = opts.padding;

  // 중심선은 0으로 두고, 마지막에 캔버스를 "나" 기준으로 좌우 대칭(centered) 오프셋 적용
  const centerX = 0;
  const baseTop = padding;
  const baseGen0Y = baseTop + rowGap * opts.maxAncestorDepth;

  const nodeById: Record<PersonId, PositionedNode> = {};
  const nodes: PositionedNode[] = [];

  const getRowY = (gen: number) => baseGen0Y + gen * rowGap;

  // Place center row: ensure self at center, siblings around.
  const centerKey = rowKey(0, 'center');
  const centerIds = rows.get(centerKey) ?? [];
  const selfIndex = centerIds.indexOf(self.id);
  if (selfIndex >= 0) centerIds.splice(selfIndex, 1);
  // Place siblings alternating left/right around self, in createdAt order.
  const centerPositions: Array<{ id: PersonId; x: number }> = [];
  centerPositions.push({ id: self.id, x: centerX - cardWidth / 2 });
  let step = 1;
  for (let i = 0; i < centerIds.length; i++) {
    const id = centerIds[i];
    const dir = i % 2 === 0 ? -1 : 1;
    const x =
      centerX -
      cardWidth / 2 +
      dir * step * (cardWidth + colGap);
    if (dir === 1) step++;
    centerPositions.push({ id, x });
  }
  const y0 = getRowY(0);
  for (const p of centerPositions) {
    const node: PositionedNode = {
      id: p.id,
      x: p.x,
      y: y0,
      width: cardWidth,
      height: cardHeight,
      generation: 0,
      side: 'center',
    };
    nodeById[p.id] = node;
    nodes.push(node);
  }

  // Place side rows (left/right) and other generations.
  const allKeys = Array.from(rows.keys()).filter(k => k !== centerKey);
  for (const key of allKeys) {
    const [genStr, side] = key.split(':') as [string, Side];
    const gen = Number(genStr);
    const ids = rows.get(key) ?? [];
    const y = getRowY(gen);

    if (side === 'left') {
      // Align closest to center first, then extend left.
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const x =
          centerX -
          colGap -
          cardWidth -
          i * (cardWidth + colGap);
        const node: PositionedNode = {
          id,
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          generation: gen,
          side,
        };
        nodeById[id] = node;
        nodes.push(node);
      }
    } else if (side === 'right') {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const x =
          centerX +
          colGap +
          i * (cardWidth + colGap);
        const node: PositionedNode = {
          id,
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          generation: gen,
          side,
        };
        nodeById[id] = node;
        nodes.push(node);
      }
    }
  }

  // Canvas bounds
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + n.width);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + n.height);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 0;
    minY = 0;
    maxY = 0;
  }

  // X: "나"(centerX=0)를 기준으로 좌우 대칭으로 보이도록 캔버스 가운데에 위치시키기
  const spanLeft = 0 - minX;
  const spanRight = maxX - 0;
  const maxSpanX = Math.max(spanLeft, spanRight);
  const canvasWidth = Math.max(1200, padding * 2 + maxSpanX * 2);
  const offsetX = padding + maxSpanX - 0;

  // Y: 위쪽(조상)으로 확장 여지를 주기 위해 minY만 padding으로 맞춤(세대 줄 정렬 유지)
  const offsetY = padding - minY;
  for (const n of nodes) {
    n.x += offsetX;
    n.y += offsetY;
    nodeById[n.id] = n;
  }

  const canvasHeight = Math.max(800, maxY - minY + padding * 2);

  const edges = computeEdges(people, included);

  return {
    canvasWidth,
    canvasHeight,
    nodes,
    edges,
    nodeById,
  };
}

