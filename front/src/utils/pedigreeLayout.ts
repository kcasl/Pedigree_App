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

function buildBloodRelativeSet(
  people: Record<PersonId, Person>,
  selfId: PersonId,
): Set<PersonId> {
  const blood = new Set<PersonId>();
  const queue: PersonId[] = [selfId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (blood.has(id)) continue;
    const me = people[id];
    if (!me) continue;
    blood.add(id);
    if (me.fatherId && people[me.fatherId] && !blood.has(me.fatherId)) queue.push(me.fatherId);
    if (me.motherId && people[me.motherId] && !blood.has(me.motherId)) queue.push(me.motherId);
    for (const p of Object.values(people)) {
      if (p.fatherId === id || p.motherId === id) {
        if (!blood.has(p.id)) queue.push(p.id);
      }
    }
  }
  return blood;
}

function inferSpouseSide(baseSide: Side): Side {
  if (baseSide === 'center') return 'center';
  return baseSide;
}

function inferCenterPersonAncestorSide(person?: Person): Side {
  if (!person) return 'left';
  if (person.gender === 'male') return 'left';
  if (person.gender === 'female') return 'right';
  return 'left';
}

function pairOrderTs(p?: Person): number {
  const ts = p?.createdAt ? Date.parse(p.createdAt) : NaN;
  return Number.isFinite(ts) ? ts : 0;
}

function isLeftMemberInPair(
  id: PersonId,
  spouseId: PersonId,
  people: Record<PersonId, Person>,
): boolean {
  const a = people[id];
  const b = people[spouseId];

  // 1) 가장 강한 규칙: 남성-여성 쌍이면 남성을 좌측 멤버로 본다.
  if (a?.gender === 'male' && b?.gender === 'female') return true;
  if (a?.gender === 'female' && b?.gender === 'male') return false;

  // 2) lineage side hint가 있으면 그 값을 우선 반영한다.
  if (a?.lineageSideHint && b?.lineageSideHint && a.lineageSideHint !== b.lineageSideHint) {
    return a.lineageSideHint === 'left';
  }
  if (a?.lineageSideHint && !b?.lineageSideHint) {
    return a.lineageSideHint === 'left';
  }
  if (!a?.lineageSideHint && b?.lineageSideHint) {
    return b.lineageSideHint !== 'left';
  }

  // 3) 그 외에는 생성 순서 fallback
  const ta = pairOrderTs(a);
  const tb = pairOrderTs(b);
  if (ta !== tb) return ta < tb;
  return id < spouseId;
}

function inferLocalDirection(person?: Person): 'left' | 'right' {
  if (person?.gender === 'male') return 'left';
  if (person?.gender === 'female') return 'right';
  return 'left';
}

function parentLocalDir(
  relation: 'father' | 'mother',
  fallback: 'left' | 'right',
): 'left' | 'right' {
  // 부모 쌍의 상대 위치는 항상 부(좌) / 모(우)로 고정
  if (relation === 'father') return 'left';
  if (relation === 'mother') return 'right';
  return fallback;
}

function reorderRowBySpouseAdjacency(
  ids: PersonId[],
  people: Record<PersonId, Person>,
  side: Side,
): PersonId[] {
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
    // 부부는 화면상 남성-좌 / 여성-우(또는 leftMember-우측/좌측 규칙)를 유지한다.
    // left row는 i가 커질수록 더 왼쪽으로 가므로 순서를 반대로 넣어야 시각적 좌우가 맞다.
    const isLeftFirst = isLeftMemberInPair(id, spouseId, people);
    if (out[out.length - 1] === id) {
      out.pop();
    }
    const leftMember = isLeftFirst ? id : spouseId;
    const rightMember = isLeftFirst ? spouseId : id;
    const first = side === 'left' ? rightMember : leftMember;
    const second = side === 'left' ? leftMember : rightMember;
    used.add(first);
    used.add(second);
    out.push(first);
    out.push(second);
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
  const bloodSet = buildBloodRelativeSet(people, self.id);

  // Ancestors up to N (and their siblings + cousin generation)
  const queue: Array<{ id: PersonId; gen: number; side: Side }> = [
    { id: self.id, gen: 0, side: 'center' },
  ];

  const generationById = new Map<PersonId, number>();
  const sideById = new Map<PersonId, Side>();
  const localDirById = new Map<PersonId, 'left' | 'right'>();
  generationById.set(self.id, 0);
  sideById.set(self.id, 'center');
  localDirById.set(self.id, 'left');

  const push = (
    id: PersonId | undefined,
    gen: number,
    side: Side,
    localDir?: 'left' | 'right',
  ) => {
    if (!id) return;
    if (!people[id]) return;
    const hinted = people[id].lineageSideHint;
    const effectiveSide: Side = hinted ?? side;
    if (!generationById.has(id)) {
      generationById.set(id, gen);
      sideById.set(id, effectiveSide);
      queue.push({ id, gen, side: effectiveSide });
    } else if ((hinted === 'left' || hinted === 'right') && sideById.get(id) !== hinted) {
      // hint가 생긴 경우에는 분기(side)를 즉시 교정해서 부모 라인이 꼬이지 않게 한다.
      sideById.set(id, hinted);
      queue.push({ id, gen: generationById.get(id) ?? gen, side: hinted });
    }
    if (localDir && !localDirById.has(id)) {
      localDirById.set(id, localDir);
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
      const spouseId = person.spouseId;
      let preferredParentSide: Side | null = null;
      let preferredLocalDir: 'left' | 'right' = localDirById.get(person.id) ?? inferLocalDirection(person);
      if (side === 'left' || side === 'right') {
        // 친가/외가 가지에 들어온 조상은 해당 가지(side)를 유지한다.
        preferredParentSide = side;
        // 같은 가지 내부에서만 좌/우 멤버(조부계/조모계) 분리를 위해 local dir 갱신.
        if (spouseId && people[spouseId]) {
          const isLeftMember = isLeftMemberInPair(person.id, spouseId, people);
          preferredLocalDir = isLeftMember ? 'left' : 'right';
        }
      } else if (spouseId && people[spouseId]) {
        // center 라인에서만 부부 내 좌/우로 가지를 새로 분기한다.
        const isLeftMember = isLeftMemberInPair(person.id, spouseId, people);
        preferredLocalDir = isLeftMember ? 'left' : 'right';
        preferredParentSide = preferredLocalDir === 'left' ? 'left' : 'right';
      } else if (person.lineageSideHint) {
        preferredParentSide = person.lineageSideHint;
      }
      if (cur.id === self.id) {
        push(person.fatherId, gen - 1, 'left', 'left');
        push(person.motherId, gen - 1, 'right', 'right');
      } else if (preferredParentSide) {
        // 부부 쌍인 경우 각자의 부모는 자기 노드 방향으로만 확장한다.
        push(
          person.fatherId,
          gen - 1,
          preferredParentSide,
          parentLocalDir('father', preferredLocalDir),
        );
        push(
          person.motherId,
          gen - 1,
          preferredParentSide,
          parentLocalDir('mother', preferredLocalDir),
        );
      } else if (side === 'left') {
        push(person.fatherId, gen - 1, 'left', parentLocalDir('father', preferredLocalDir));
        push(person.motherId, gen - 1, 'left', parentLocalDir('mother', preferredLocalDir));
      } else if (side === 'right') {
        push(person.fatherId, gen - 1, 'right', parentLocalDir('father', preferredLocalDir));
        push(person.motherId, gen - 1, 'right', parentLocalDir('mother', preferredLocalDir));
      } else {
        // center(배우자/자녀 라인) 인물은 자기 쪽 방향을 고정해서
        // 부모 추가 시 좌우가 섞이지 않도록 유지한다.
        const inherited = inferCenterPersonAncestorSide(person);
        const inheritedLocal: 'left' | 'right' = inherited === 'left' ? 'left' : 'right';
        push(
          person.fatherId,
          gen - 1,
          inherited,
          parentLocalDir('father', inheritedLocal),
        );
        push(
          person.motherId,
          gen - 1,
          inherited,
          parentLocalDir('mother', inheritedLocal),
        );
      }
    }

    // Children (descendants)
    if (gen < opts.maxDescendantDepth) {
      for (const child of getChildren(people, person.id)) {
        const childSide =
          cur.id === self.id ? 'center' : side; // descendants inherit side (except self -> center)
        push(child.id, gen + 1, childSide, localDirById.get(person.id));
      }
    }

    // Spouse: same generation / same side row
    if (person.spouseId) {
      const spouseLocal: 'left' | 'right' = localDirById.get(person.id) === 'left' ? 'right' : 'left';
      push(person.spouseId, gen, inferSpouseSide(side), spouseLocal);
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
          push(other.id, gen, side, localDirById.get(person.id));
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
    const [, side] = key.split(':') as [string, Side];
    let ordered = reorderRowBySpouseAdjacency(ids, people, side);
    if (side === 'left' || side === 'right') {
      // 단순 확정 규칙:
      // - side row에서 index 0이 항상 "안쪽(중앙 가까움)"
      // - 혈연(직계/방계)은 안쪽, 인척은 바깥쪽
      // - 부부 unit은 인접 유지, unit 내부는 혈연 먼저/인척 나중
      const inRow = new Set(ids);
      const used = new Set<PersonId>();
      const units: Array<{ ids: PersonId[]; rank: number }> = [];

      for (const id of ordered) {
        if (used.has(id)) continue;
        const spouseId = people[id]?.spouseId;
        if (spouseId && inRow.has(spouseId) && !used.has(spouseId)) {
          const aBlood = bloodSet.has(id);
          const bBlood = bloodSet.has(spouseId);
          const pair: PersonId[] =
            aBlood === bBlood ? [id, spouseId] : aBlood ? [id, spouseId] : [spouseId, id];
          used.add(pair[0]);
          used.add(pair[1]);
          const rank = aBlood || bBlood ? (aBlood && bBlood ? 0 : 1) : 2;
          units.push({ ids: pair, rank });
          continue;
        }

        used.add(id);
        units.push({ ids: [id], rank: bloodSet.has(id) ? 0 : 2 });
      }

      units.sort((u1, u2) => u1.rank - u2.rank);
      ordered = units.flatMap(u => u.ids);
    }
    rows.set(key, ordered);
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

    if (side === 'center') {
      // generation 0 외의 center row(자녀/손자 등)도 반드시 배치한다.
      const totalWidth = ids.length * cardWidth + Math.max(0, ids.length - 1) * colGap;
      const startX = centerX - totalWidth / 2;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const x = startX + i * (cardWidth + colGap);
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
      continue;
    }

    if (side === 'left') {
      // left row:
      // - localDir=right(안쪽)은 center 인접 슬롯부터 채움
      // - localDir=left(바깥)은 한 칸 바깥 슬롯부터 채워
      //   단일 노드(예: 조부 기준 증조부만 있는 경우)도 더 왼쪽으로 치우치게 함
      let inwardSlot = 0;
      let outwardSlot = 1;
      for (const id of ids) {
        const localDir = localDirById.get(id) ?? 'right';
        const slot = localDir === 'left' ? outwardSlot++ : inwardSlot++;
        const x = centerX - colGap - cardWidth - slot * (cardWidth + colGap);
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
      // right row:
      // - localDir=left(안쪽)은 center 인접 슬롯부터
      // - localDir=right(바깥)은 한 칸 바깥 슬롯부터
      let inwardSlot = 0;
      let outwardSlot = 1;
      for (const id of ids) {
        const localDir = localDirById.get(id) ?? 'left';
        const slot = localDir === 'right' ? outwardSlot++ : inwardSlot++;
        const x = centerX + colGap + slot * (cardWidth + colGap);
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

