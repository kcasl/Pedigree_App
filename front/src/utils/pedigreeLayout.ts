import type { Person, PersonId } from '../types/pedigree';

export type Side = 'left' | 'right' | 'center';

export type PositionedNode = {
  id: PersonId;
  x: number;
  y: number;
  width: number;
  height: number;
  generation: number;
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

export type BuildLayoutOptions = {
  selfId: PersonId;
  maxAncestorDepth: number;
  maxDescendantDepth: number;
  cardWidth: number;
  cardHeight: number;
  colGap: number;
  rowGap: number;
  padding: number;
  autoTune?: boolean;
  minCardWidth?: number;
  minColGap?: number;
};

function rowKey(gen: number, side: Side): RowKey {
  return `${gen}:${side}`;
}

function getChildren(people: Record<PersonId, Person>, parentId: PersonId): Person[] {
  return Object.values(people).filter(p => p.fatherId === parentId || p.motherId === parentId);
}

function sortByCreatedAt(ids: PersonId[], people: Record<PersonId, Person>): PersonId[] {
  return [...ids].sort((a, b) => {
    const ta = Date.parse(people[a]?.createdAt ?? '') || 0;
    const tb = Date.parse(people[b]?.createdAt ?? '') || 0;
    return ta - tb;
  });
}

function nextParentOrder(
  childOrder: number,
  childSide: Side,
  relation: 'father' | 'mother',
): number {
  // 부모 추가 고정 규칙:
  // left 가지(친가): 어머니는 자식 바로 위(childOrder), 아버지는 그 왼쪽(childOrder-1)
  // right 가지(외가): 아버지는 자식 바로 위(childOrder), 어머니는 그 오른쪽(childOrder+1)
  if (childSide === 'left') {
    if (relation === 'mother') return Math.min(-1, childOrder);
    return childOrder - 1;
  }
  if (childSide === 'right') {
    if (relation === 'father') return Math.max(1, childOrder);
    return childOrder + 1;
  }
  return relation === 'father' ? -1 : 1;
}

function reorderSpouseAdjacent(ids: PersonId[], people: Record<PersonId, Person>, side: Side): PersonId[] {
  const used = new Set<PersonId>();
  const out: PersonId[] = [];
  const ordered = sortByCreatedAt(ids, people);
  for (const id of ordered) {
    if (used.has(id)) continue;
    const spouseId = people[id]?.spouseId;
    if (!spouseId || !ordered.includes(spouseId) || used.has(spouseId)) {
      used.add(id);
      out.push(id);
      continue;
    }

    const me = people[id];
    const spouse = people[spouseId];
    const leftMember = me?.gender === 'male' ? id : spouse?.gender === 'male' ? spouseId : id;
    const rightMember = leftMember === id ? spouseId : id;

    used.add(id);
    used.add(spouseId);
    if (side === 'left') {
      out.push(rightMember, leftMember);
    } else {
      out.push(leftMember, rightMember);
    }
  }
  return out;
}

function computeEdges(people: Record<PersonId, Person>, included: Set<PersonId>): Edge[] {
  const edges: Edge[] = [];
  for (const p of Object.values(people)) {
    if (!included.has(p.id)) continue;
    if (p.fatherId && included.has(p.fatherId)) edges.push({ parentId: p.fatherId, childId: p.id });
    if (p.motherId && included.has(p.motherId)) edges.push({ parentId: p.motherId, childId: p.id });
  }
  return edges;
}

export function buildPedigreeLayout(
  people: Record<PersonId, Person>,
  opts: BuildLayoutOptions,
): LayoutResult {
  const self = people[opts.selfId];
  if (!self) return { canvasWidth: 0, canvasHeight: 0, nodes: [], edges: [], nodeById: {} };

  const generationById = new Map<PersonId, number>();
  const sideById = new Map<PersonId, Side>();
  const branchOrderById = new Map<PersonId, number>();
  const included = new Set<PersonId>();
  const queue: Array<{ id: PersonId; gen: number; side: Side }> = [{ id: self.id, gen: 0, side: 'center' }];

  generationById.set(self.id, 0);
  sideById.set(self.id, 'center');
  branchOrderById.set(self.id, 0);
  included.add(self.id);

  const push = (id: PersonId | undefined, gen: number, side: Side) => {
    if (!id || !people[id]) return;
    if (!generationById.has(id)) {
      generationById.set(id, gen);
      sideById.set(id, people[id].lineageSideHint ?? side);
      queue.push({ id, gen, side: sideById.get(id)! });
    }
    included.add(id);
  };

  while (queue.length) {
    const cur = queue.shift()!;
    const person = people[cur.id];
    if (!person) continue;
    const gen = generationById.get(cur.id) ?? 0;
    const side = sideById.get(cur.id) ?? 'center';

    if (gen > -opts.maxAncestorDepth) {
      if (cur.id === self.id) {
        push(person.fatherId, gen - 1, 'left');
        push(person.motherId, gen - 1, 'right');
        if (person.fatherId) branchOrderById.set(person.fatherId, -1);
        if (person.motherId) branchOrderById.set(person.motherId, 1);
      } else if (side === 'left' || side === 'right') {
        push(person.fatherId, gen - 1, side);
        push(person.motherId, gen - 1, side);
        const childOrder = branchOrderById.get(cur.id) ?? (side === 'left' ? -1 : 1);
        if (person.fatherId) {
          const cand = nextParentOrder(childOrder, side, 'father');
          const prev = branchOrderById.get(person.fatherId);
          if (prev == null || Math.abs(cand) < Math.abs(prev)) branchOrderById.set(person.fatherId, cand);
        }
        if (person.motherId) {
          const cand = nextParentOrder(childOrder, side, 'mother');
          const prev = branchOrderById.get(person.motherId);
          if (prev == null || Math.abs(cand) < Math.abs(prev)) branchOrderById.set(person.motherId, cand);
        }
      } else {
        const inherit: Side = person.gender === 'female' ? 'right' : 'left';
        push(person.fatherId, gen - 1, inherit);
        push(person.motherId, gen - 1, inherit);
        const childOrder = branchOrderById.get(cur.id) ?? 0;
        if (person.fatherId) branchOrderById.set(person.fatherId, nextParentOrder(childOrder, inherit, 'father'));
        if (person.motherId) branchOrderById.set(person.motherId, nextParentOrder(childOrder, inherit, 'mother'));
      }
    }

    if (gen < opts.maxDescendantDepth) {
      for (const c of getChildren(people, person.id)) {
        push(c.id, gen + 1, cur.id === self.id ? 'center' : side);
        if (!branchOrderById.has(c.id)) {
          const cand = branchOrderById.get(cur.id) ?? 0;
          branchOrderById.set(c.id, side === 'left' ? Math.min(-1, cand) : side === 'right' ? Math.max(1, cand) : 0);
        }
      }
    }

    if (person.spouseId) push(person.spouseId, gen, side);
    if (person.spouseId && !branchOrderById.has(person.spouseId)) {
      const meOrder = branchOrderById.get(cur.id) ?? 0;
      if (side === 'left') branchOrderById.set(person.spouseId, Math.min(-1, meOrder + 1));
      else if (side === 'right') branchOrderById.set(person.spouseId, Math.max(1, meOrder - 1));
      else branchOrderById.set(person.spouseId, meOrder === 0 ? 1 : meOrder > 0 ? meOrder - 1 : meOrder + 1);
    }

    const fatherId = person.fatherId;
    const motherId = person.motherId;
    if (fatherId || motherId) {
      for (const other of Object.values(people)) {
        if (other.id === person.id) continue;
        const sameFather = fatherId && other.fatherId === fatherId;
        const sameMother = motherId && other.motherId === motherId;
        if (sameFather || sameMother) push(other.id, gen, side);
      }
    }
  }

  const rows = new Map<RowKey, PersonId[]>();
  for (const id of included) {
    const key = rowKey(generationById.get(id) ?? 0, sideById.get(id) ?? 'center');
    const arr = rows.get(key) ?? [];
    arr.push(id);
    rows.set(key, arr);
  }

  for (const [key, ids] of rows.entries()) {
    const [, side] = key.split(':') as [string, Side];
    if (side === 'center') {
      rows.set(key, sortByCreatedAt(ids, people));
      continue;
    }
    const spouseOrdered = reorderSpouseAdjacent(ids, people, side);
    const ordered = [...spouseOrdered].sort((a, b) => {
      const oa = branchOrderById.get(a) ?? (side === 'left' ? -999 : 999);
      const ob = branchOrderById.get(b) ?? (side === 'left' ? -999 : 999);
      if (side === 'left') {
        if (oa !== ob) return ob - oa; // -1(안쪽) -> -2(바깥)
      } else {
        if (oa !== ob) return oa - ob; // 1(안쪽) -> 2(바깥)
      }
      const ta = Date.parse(people[a]?.createdAt ?? '') || 0;
      const tb = Date.parse(people[b]?.createdAt ?? '') || 0;
      return ta - tb;
    });
    rows.set(key, ordered);
  }

  const maxRowLen = Math.max(1, ...Array.from(rows.values()).map(r => r.length));
  const shrink = Math.max(0, maxRowLen - 4);
  const minCardWidth = opts.minCardWidth ?? 140;
  const minColGap = opts.minColGap ?? 18;
  const cardWidth = opts.autoTune ? Math.max(minCardWidth, Math.round(opts.cardWidth - shrink * 10)) : opts.cardWidth;
  const colGap = opts.autoTune ? Math.max(minColGap, Math.round(opts.colGap - shrink * 4)) : opts.colGap;
  const cardHeight = opts.cardHeight;
  const rowGap = opts.rowGap;
  const padding = opts.padding;

  const centerX = 0;
  const baseGen0Y = padding + rowGap * opts.maxAncestorDepth;
  const getY = (gen: number) => baseGen0Y + gen * rowGap;

  const nodeById: Record<PersonId, PositionedNode> = {};
  const nodes: PositionedNode[] = [];

  // center generation 0
  const gen0center = rows.get(rowKey(0, 'center')) ?? [];
  const others = gen0center.filter(id => id !== self.id);
  const centerPlaced: Array<{ id: PersonId; x: number }> = [{ id: self.id, x: centerX - cardWidth / 2 }];
  let step = 1;
  for (let i = 0; i < others.length; i++) {
    const dir = i % 2 === 0 ? -1 : 1;
    centerPlaced.push({ id: others[i], x: centerX - cardWidth / 2 + dir * step * (cardWidth + colGap) });
    if (dir === 1) step++;
  }
  for (const p of centerPlaced) {
    const n: PositionedNode = { id: p.id, x: p.x, y: getY(0), width: cardWidth, height: cardHeight, generation: 0, side: 'center' };
    nodeById[n.id] = n;
    nodes.push(n);
  }

  // other rows
  for (const [key, ids] of rows.entries()) {
    if (key === rowKey(0, 'center')) continue;
    const [genStr, side] = key.split(':') as [string, Side];
    const gen = Number(genStr);
    const y = getY(gen);
    if (side === 'center') {
      const total = ids.length * cardWidth + Math.max(0, ids.length - 1) * colGap;
      const start = centerX - total / 2;
      for (let i = 0; i < ids.length; i++) {
        const n: PositionedNode = { id: ids[i], x: start + i * (cardWidth + colGap), y, width: cardWidth, height: cardHeight, generation: gen, side };
        nodeById[n.id] = n;
        nodes.push(n);
      }
    } else if (side === 'left' || side === 'right') {
      // index 기반이 아니라 branchOrder(-n..+n) 슬롯 기반으로 배치해
      // "부모를 바로 위/바깥쪽" 규칙을 실제 X 좌표에 반영한다.
      const stepX = cardWidth + colGap;
      const usedSlots = new Set<number>();
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        let slot = Math.trunc(branchOrderById.get(id) ?? (side === 'left' ? -1 : 1));
        if (side === 'left' && slot > -1) slot = -1;
        if (side === 'right' && slot < 1) slot = 1;
        while (usedSlots.has(slot)) {
          slot += side === 'left' ? -1 : 1;
        }
        usedSlots.add(slot);
        const n: PositionedNode = {
          id,
          x: centerX + slot * stepX - cardWidth / 2,
          y,
          width: cardWidth,
          height: cardHeight,
          generation: gen,
          side,
        };
        nodeById[n.id] = n;
        nodes.push(n);
      }
    }
  }

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

  const spanLeft = 0 - minX;
  const spanRight = maxX - 0;
  const maxSpan = Math.max(spanLeft, spanRight);
  const canvasWidth = Math.max(1200, padding * 2 + maxSpan * 2);
  const offsetX = padding + maxSpan;
  const offsetY = padding - minY;

  for (const n of nodes) {
    n.x += offsetX;
    n.y += offsetY;
    nodeById[n.id] = n;
  }

  const canvasHeight = Math.max(800, maxY - minY + padding * 2);
  const edges = computeEdges(people, included);
  return { canvasWidth, canvasHeight, nodes, edges, nodeById };
}

