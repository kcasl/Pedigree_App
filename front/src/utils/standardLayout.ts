/**
 * SDD 참고 4세대 고정 슬롯 배치
 */

import type { ActiveView } from '../types/lineage';
import type { Person, PersonId } from '../types/pedigree';
import type { Edge, LayoutResult, PositionedNode } from './pedigreeLayout';
import {
  focalBloodId,
  SELF_SLOT_INDEX,
  slotIdsForView,
} from './standardTemplate';
import {
  defaultSiblingBloodOrder,
  orderSiblingCouplesAroundFocal,
  sortChildIdsForLayout,
} from './birthOrder';

export type StandardLayoutOptions = {
  view: ActiveView;
  cardWidth: number;
  cardHeight: number;
  spouseGap: number;
  coupleGap: number;
  rowGap: number;
  childGap: number;
  padding: number;
};

export const STANDARD_LAYOUT_DEFAULTS: StandardLayoutOptions = {
  view: 'self',
  cardWidth: 158,
  cardHeight: 128,
  spouseGap: 22,
  coupleGap: 56,
  rowGap: 256,
  childGap: 40,
  padding: 72,
};

function unitW(opts: StandardLayoutOptions): number {
  return opts.cardWidth * 2 + opts.spouseGap;
}

function coupleCenterX(
  rowStartX: number,
  coupleIndex: number,
  opts: StandardLayoutOptions,
): number {
  const uw = unitW(opts);
  return rowStartX + coupleIndex * (uw + opts.coupleGap) + uw / 2;
}

function computeEdges(people: Record<PersonId, Person>): Edge[] {
  const ids = new Set(Object.keys(people));
  const edges: Edge[] = [];
  for (const p of Object.values(people)) {
    if (p.fatherId && ids.has(p.fatherId)) edges.push({ parentId: p.fatherId, childId: p.id });
    if (p.motherId && ids.has(p.motherId)) edges.push({ parentId: p.motherId, childId: p.id });
  }
  return edges;
}

function collectSiblingCouples(
  people: Record<PersonId, Person>,
  parentFather: PersonId,
  parentMother: PersonId,
  slots: ReturnType<typeof slotIdsForView>,
): Array<{ blood: PersonId; spouse?: PersonId }> {
  const templatePairs = slots.siblings.map(s => ({
    blood: s.blood,
    spouse: people[s.blood]?.spouseId,
  }));

  const extra: Array<{ blood: PersonId; spouse?: PersonId }> = [];
  const templateBlood = new Set(slots.siblings.map(s => s.blood));

  const sideParents = sideBranchParentIds(people, slots);

  for (const p of Object.values(people)) {
    if (templateBlood.has(p.id)) continue;
    if (
      (p.fatherId && sideParents.has(p.fatherId)) ||
      (p.motherId && sideParents.has(p.motherId))
    ) {
      continue;
    }
    if (p.fatherId === parentFather && p.motherId === parentMother) {
      extra.push({ blood: p.id, spouse: p.spouseId });
    }
  }

  const merged: Array<{ blood: PersonId; spouse?: PersonId }> = [...templatePairs];
  for (const e of extra) {
    if (!merged.some(m => m.blood === e.blood)) merged.push(e);
  }
  return merged.filter(c => !!people[c.blood]);
}

function isSideBranchDescendant(
  person: Person,
  sideParents: Set<PersonId>,
): boolean {
  return (
    (!!person.fatherId && sideParents.has(person.fatherId)) ||
    (!!person.motherId && sideParents.has(person.motherId))
  );
}

/** 옆 가지(친할머니 형제 등) 자녀 — 직계 형제 줄에 넣지 않음 */
function sideBranchParentIds(
  people: Record<PersonId, Person>,
  slots: ReturnType<typeof slotIdsForView>,
): Set<PersonId> {
  const ids = new Set<PersonId>();
  const addCouple = (bloodId: PersonId, spouseId?: PersonId) => {
    ids.add(bloodId);
    if (spouseId && people[spouseId]) ids.add(spouseId);
  };
  if (people[slots.father]) {
    for (const c of collectBloodSiblingCouples(people, slots.father)) {
      addCouple(c.blood, c.spouse);
    }
  }
  if (people[slots.mother]) {
    for (const c of collectBloodSiblingCouples(people, slots.mother)) {
      addCouple(c.blood, c.spouse);
    }
  }
  for (const slotId of [slots.gf, slots.gm, slots.mgf, slots.mgm, slots.ggf, slots.ggm] as PersonId[]) {
    if (!people[slotId]) continue;
    for (const c of collectBloodSiblingCouples(people, slotId)) {
      addCouple(c.blood, c.spouse);
    }
  }
  return ids;
}

/** 선택 인물과 같은 부모를 둔 친형제(본인 제외) */
function collectBloodSiblingCouples(
  people: Record<PersonId, Person>,
  anchorId: PersonId,
): Array<{ blood: PersonId; spouse?: PersonId }> {
  const anchor = people[anchorId];
  if (!anchor?.fatherId || !anchor?.motherId) return [];
  return collectChildren(people, anchor.fatherId, anchor.motherId)
    .filter(id => id !== anchorId && people[id])
    .map(id => ({
      blood: id,
      spouse:
        people[id]?.spouseId && people[people[id].spouseId!] ? people[id].spouseId : undefined,
    }));
}

function collectChildren(
  people: Record<PersonId, Person>,
  bloodId: PersonId,
  spouseId?: PersonId,
): PersonId[] {
  const ids: PersonId[] = [];
  for (const p of Object.values(people)) {
    if (!p.fatherId && !p.motherId) continue;
    if (spouseId) {
      const ok =
        (p.fatherId === bloodId && p.motherId === spouseId) ||
        (p.fatherId === spouseId && p.motherId === bloodId);
      if (ok) ids.push(p.id);
    } else if (p.fatherId === bloodId || p.motherId === bloodId) {
      ids.push(p.id);
    }
  }
  return sortChildIdsForLayout(ids, people);
}

function personCenterInCouple(
  coupleLeftX: number,
  role: 'blood' | 'spouse',
  hasSpouse: boolean,
  opts: StandardLayoutOptions,
): number {
  if (!hasSpouse) return coupleLeftX + opts.cardWidth / 2;
  if (role === 'blood') return coupleLeftX + opts.cardWidth / 2;
  return coupleLeftX + opts.cardWidth + opts.spouseGap + opts.cardWidth / 2;
}

type PlacedCouple = {
  blood: PersonId;
  spouse?: PersonId;
  centerX: number;
  coupleLeftX: number;
};

type SideBranch = {
  side: 'left' | 'right';
  anchorCenterX: number;
  anchorY: number;
  bloodId: PersonId;
  spouseId?: PersonId;
  memberIds: PersonId[];
  descendantRowY: number;
  descendantGeneration: number;
};

function refreshSideBranchAnchor(
  branch: SideBranch,
  nodeById: Record<PersonId, PositionedNode>,
  opts: StandardLayoutOptions,
): void {
  const blood = nodeById[branch.bloodId];
  if (!blood) return;
  const spouse = branch.spouseId ? nodeById[branch.spouseId] : undefined;
  if (spouse) {
    branch.anchorCenterX =
      (blood.x + opts.cardWidth / 2 + spouse.x + opts.cardWidth / 2) / 2;
  } else {
    branch.anchorCenterX = blood.x + opts.cardWidth / 2;
  }
}

/** 조부모 친형제 — anchor 기준 한쪽(왼/오)으로만 배치 */
function placeCouplesOneSide(
  nodes: PositionedNode[],
  nodeById: Record<PersonId, PositionedNode>,
  couples: Array<{ blood: PersonId; spouse?: PersonId }>,
  anchorCenterX: number,
  direction: 'left' | 'right',
  y: number,
  gen: number,
  opts: StandardLayoutOptions,
  people: Record<PersonId, Person>,
): { minX: number; maxX: number; placed: PlacedCouple[] } {
  if (!couples.length) {
    return { minX: anchorCenterX, maxX: anchorCenterX, placed: [] };
  }
  const uw = unitW(opts);
  const step = uw + opts.coupleGap;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  const placed: PlacedCouple[] = [];
  couples.forEach((couple, i) => {
    const offset = (i + 1) * step;
    const centerX = direction === 'left' ? anchorCenterX - offset : anchorCenterX + offset;
    const x = centerX - uw / 2;
    const sp = couple.spouse && people[couple.spouse] ? couple.spouse : undefined;
    placeCoupleNode(nodes, nodeById, couple.blood, sp, x, y, gen, opts);
    const w = sp ? uw : opts.cardWidth;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + w);
    placed.push({ blood: couple.blood, spouse: sp, centerX, coupleLeftX: x });
  });
  return { minX, maxX, placed };
}

/** 조부모 부부 + 남쪽(혈족) 형제는 왼쪽, 여쪽(혈족) 형제는 오른쪽 */
function placeGrandCoupleCluster(
  nodes: PositionedNode[],
  nodeById: Record<PersonId, PositionedNode>,
  people: Record<PersonId, Person>,
  bloodId: PersonId,
  spouseId: PersonId | undefined,
  coupleLeftX: number,
  y: number,
  gen: number,
  opts: StandardLayoutOptions,
  descendantRowY: number,
  descendantGeneration: number,
): { minX: number; maxX: number; sideBranches: SideBranch[] } {
  const uw = unitW(opts);
  const hasSpouse = !!(spouseId && people[spouseId]);
  const coupleW = hasSpouse ? uw : opts.cardWidth;
  const bloodCenter = personCenterInCouple(coupleLeftX, 'blood', hasSpouse, opts);
  const spouseCenter = hasSpouse
    ? personCenterInCouple(coupleLeftX, 'spouse', hasSpouse, opts)
    : bloodCenter;

  const bloodSiblings = collectBloodSiblingCouples(people, bloodId);
  const spouseSiblings =
    spouseId && people[spouseId] ? collectBloodSiblingCouples(people, spouseId) : [];

  const sideBranches: SideBranch[] = [];
  const leftBounds = placeCouplesOneSide(
    nodes,
    nodeById,
    bloodSiblings,
    bloodCenter,
    'left',
    y,
    gen,
    opts,
    people,
  );
  leftBounds.placed.forEach(p => {
    sideBranches.push({
      side: 'left',
      anchorCenterX: p.centerX,
      anchorY: y,
      bloodId: p.blood,
      spouseId: p.spouse,
      memberIds: [p.blood, p.spouse].filter(Boolean) as PersonId[],
      descendantRowY,
      descendantGeneration,
    });
  });
  placeCoupleNode(
    nodes,
    nodeById,
    bloodId,
    hasSpouse ? spouseId : undefined,
    coupleLeftX,
    y,
    gen,
    opts,
  );
  const rightBounds = placeCouplesOneSide(
    nodes,
    nodeById,
    spouseSiblings,
    spouseCenter,
    'right',
    y,
    gen,
    opts,
    people,
  );
  rightBounds.placed.forEach(p => {
    sideBranches.push({
      side: 'right',
      anchorCenterX: p.centerX,
      anchorY: y,
      bloodId: p.blood,
      spouseId: p.spouse,
      memberIds: [p.blood, p.spouse].filter(Boolean) as PersonId[],
      descendantRowY,
      descendantGeneration,
    });
  });

  return {
    minX: Math.min(coupleLeftX, leftBounds.minX),
    maxX: Math.max(coupleLeftX + coupleW, rightBounds.maxX),
    sideBranches,
  };
}

function shiftNodesByIds(
  ids: PersonId[],
  deltaX: number,
  nodeById: Record<PersonId, PositionedNode>,
): void {
  if (Math.abs(deltaX) < 0.5) return;
  const seen = new Set<PersonId>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = nodeById[id];
    if (node) node.x += deltaX;
  }
}

function groupHorizontalBounds(placements: ChildPlacement[]): { left: number; right: number } {
  if (!placements.length) return { left: 0, right: 0 };
  const left = placements.reduce((acc, p) => Math.min(acc, p.targetX), Number.POSITIVE_INFINITY);
  const right = placements.reduce(
    (acc, p) => Math.max(acc, p.targetX + p.width),
    Number.NEGATIVE_INFINITY,
  );
  return { left, right };
}

function overlapsExistingRow(
  left: number,
  right: number,
  nodeById: Record<PersonId, PositionedNode>,
  y: number,
  excludeIds: Set<PersonId>,
  gap: number,
): number {
  let overlap = 0;
  for (const node of Object.values(nodeById)) {
    if (excludeIds.has(node.id)) continue;
    if (node.y !== y) continue;
    const nodeRight = node.x + node.width;
    const o = Math.min(right, nodeRight) - Math.max(left, node.x);
    if (o > 0) overlap = Math.max(overlap, o + gap);
  }
  return overlap;
}

/** 옆 가지 형제 + 자손 — 부모 아래 피라미드, 겹치면 가지 방향으로 통째로 이동 */
function layoutSideBranchDescendants(
  branch: SideBranch,
  people: Record<PersonId, Person>,
  nodes: PositionedNode[],
  nodeById: Record<PersonId, PositionedNode>,
  opts: StandardLayoutOptions,
  placedDescendantIds: Set<PersonId>,
  yGrandchildRow: number,
  clearanceYLevels: number[],
): void {
  const kids = collectChildren(people, branch.bloodId, branch.spouseId).filter(
    id => people[id] && !placedDescendantIds.has(id),
  );
  if (!kids.length) return;

  const uw = unitW(opts);
  const direction = branch.side;
  const anchorCoupleWidth =
    branch.spouseId && people[branch.spouseId] ? uw : opts.cardWidth;
  const entries: ChildEntry[] = kids.map(id => {
    const spouseId =
      people[id]?.spouseId && people[people[id].spouseId!] ? people[id].spouseId : undefined;
    return { id, spouseId, width: spouseId ? uw : opts.cardWidth };
  });

  const excludeIds = new Set<PersonId>(branch.memberIds);
  refreshSideBranchAnchor(branch, nodeById, opts);
  const unit: UnitCenter = {
    bloodId: branch.bloodId,
    spouseId: branch.spouseId,
    centerX: branch.anchorCenterX,
    coupleWidth: anchorCoupleWidth,
    branchIndex: -1,
  };
  let placements = rebuildGroupPlacements(unit, entries, opts);

  let shift = resolveMultiRowShift(
    placements,
    branch.anchorCenterX,
    anchorCoupleWidth,
    nodeById,
    clearanceYLevels,
    excludeIds,
    direction,
    opts,
  );
  if (Math.abs(shift) > 0.5) {
    shiftNodesByIds(branch.memberIds, shift, nodeById);
    branch.anchorCenterX += shift;
    unit.centerX = branch.anchorCenterX;
    placements = rebuildGroupPlacements(unit, entries, opts);
  }

  const branchDescendantIds: PersonId[] = [];
  placements.forEach(entry => {
    if (placedDescendantIds.has(entry.id)) return;
    placeCoupleNode(
      nodes,
      nodeById,
      entry.id,
      entry.spouseId,
      entry.targetX,
      branch.descendantRowY,
      branch.descendantGeneration,
      opts,
    );
    placedDescendantIds.add(entry.id);
    branchDescendantIds.push(entry.id);
    if (entry.spouseId) {
      placedDescendantIds.add(entry.spouseId);
      branchDescendantIds.push(entry.spouseId);
    }
  });

  placements.forEach(entry => {
    const cUnit: UnitCenter = {
      bloodId: entry.id,
      spouseId: entry.spouseId,
      centerX: entry.targetX + entry.width / 2,
      coupleWidth: entry.width,
      branchIndex: -1,
    };
    const grandKids = collectChildren(people, cUnit.bloodId, cUnit.spouseId).filter(
      id => people[id] && !placedDescendantIds.has(id),
    );
    if (!grandKids.length) return;

    const gEntries: ChildEntry[] = grandKids.map(id => {
      const spouseId =
        people[id]?.spouseId && people[people[id].spouseId!] ? people[id].spouseId : undefined;
      return { id, spouseId, width: spouseId ? uw : opts.cardWidth };
    });
    const gExclude = new Set<PersonId>([...excludeIds, ...branchDescendantIds]);
    let gPlacements = rebuildGroupPlacements(cUnit, gEntries, opts);
    const gShift = resolveMultiRowShift(
      gPlacements,
      cUnit.centerX,
      cUnit.coupleWidth,
      nodeById,
      [yGrandchildRow],
      gExclude,
      direction,
      opts,
    );
    if (Math.abs(gShift) > 0.5) {
      cUnit.centerX += gShift;
      shiftNodesByIds(
        [entry.id, entry.spouseId].filter(Boolean) as PersonId[],
        gShift,
        nodeById,
      );
      gPlacements = rebuildGroupPlacements(cUnit, gEntries, opts);
    }
    gPlacements.forEach(gEntry => {
      if (placedDescendantIds.has(gEntry.id)) return;
      placeCoupleNode(
        nodes,
        nodeById,
        gEntry.id,
        gEntry.spouseId,
        gEntry.targetX,
        yGrandchildRow,
        branch.descendantGeneration + 1,
        opts,
      );
      placedDescendantIds.add(gEntry.id);
      if (gEntry.spouseId) placedDescendantIds.add(gEntry.spouseId);
    });
  });
}

function resolveMultiRowShift(
  placements: ChildPlacement[],
  anchorCenterX: number,
  anchorCoupleWidth: number,
  nodeById: Record<PersonId, PositionedNode>,
  yLevels: number[],
  excludeIds: Set<PersonId>,
  direction: 'left' | 'right',
  opts: StandardLayoutOptions,
): number {
  let shift = 0;
  for (let iter = 0; iter < 32; iter += 1) {
    let maxOverlap = 0;
    const bounds = groupHorizontalBounds(placements);
    for (const y of yLevels) {
      maxOverlap = Math.max(
        maxOverlap,
        overlapsExistingRow(
          bounds.left + shift,
          bounds.right + shift,
          nodeById,
          y,
          excludeIds,
          opts.coupleGap,
        ),
      );
      const anchorLeft = anchorCenterX - anchorCoupleWidth / 2 + shift;
      const anchorRight = anchorCenterX + anchorCoupleWidth / 2 + shift;
      maxOverlap = Math.max(
        maxOverlap,
        overlapsExistingRow(anchorLeft, anchorRight, nodeById, y, excludeIds, opts.coupleGap),
      );
    }
    if (maxOverlap <= 0.5) break;
    shift += direction === 'right' ? maxOverlap : -maxOverlap;
  }
  return shift;
}

function placeCoupleNode(
  nodes: PositionedNode[],
  nodeById: Record<PersonId, PositionedNode>,
  bloodId: PersonId,
  spouseId: PersonId | undefined,
  x: number,
  y: number,
  gen: number,
  opts: StandardLayoutOptions,
  highlightBlood?: boolean,
): void {
  if (!bloodId) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  const push = (
    id: PersonId,
    nx: number,
    role: 'blood' | 'spouse' | 'single',
    partner?: PersonId,
  ) => {
    if (!id) return;
    if (nodeById[id]) {
      const existing = nodeById[id];
      existing.x = nx;
      existing.y = y;
      existing.generation = gen;
      return;
    }
    if (!Number.isFinite(nx) || !Number.isFinite(y)) return;
    const node: PositionedNode = {
      id,
      x: nx,
      y,
      width: opts.cardWidth,
      height: opts.cardHeight,
      generation: gen,
      side: 'center',
      slot: 0,
      layoutRole: role,
      partnerId: partner,
    };
    nodes.push(node);
    nodeById[id] = node;
    void highlightBlood;
  };

  push(bloodId, x, spouseId ? 'blood' : 'single', spouseId);
  if (spouseId) {
    push(spouseId, x + opts.cardWidth + opts.spouseGap, 'spouse', bloodId);
  }
}

type ChildEntry = {
  id: PersonId;
  spouseId?: PersonId;
  width: number;
};

type ChildPlacement = ChildEntry & { targetX: number };

type UnitCenter = {
  bloodId: PersonId;
  spouseId?: PersonId;
  centerX: number;
  coupleWidth: number;
  branchIndex: number;
};

type PyramidGroup = {
  unitIndex: number;
  entries: ChildEntry[];
  placements: ChildPlacement[];
};

function rebuildGroupPlacements(
  unit: UnitCenter,
  entries: ChildEntry[],
  opts: StandardLayoutOptions,
): ChildPlacement[] {
  if (!entries.length) return [];
  const coupleLeftX = unit.centerX - unit.coupleWidth / 2;
  const hasSpouse = !!unit.spouseId;
  return buildPyramidPlacements(entries, unit.centerX, coupleLeftX, hasSpouse, opts);
}

/** 손자 등 하위 줄 겹침 → 위 줄 부모(자식) centerX만 이동, 하위 노드는 부모 아래 피라미드 유지 */
function resolvePyramidRowOverlapByShiftingParents(
  groups: PyramidGroup[],
  units: UnitCenter[],
  opts: StandardLayoutOptions,
  gap: number,
  parentGap: number,
  isolateBranches: boolean,
): void {
  if (groups.length <= 1) return;

  const sorted = [...groups].sort(
    (a, b) =>
      (units[a.unitIndex]?.centerX ?? 0) - (units[b.unitIndex]?.centerX ?? 0),
  );

  for (let iter = 0; iter < sorted.length * 4; iter += 1) {
    let changed = false;
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const prevUnit = units[prev.unitIndex];
      const curUnit = units[cur.unitIndex];
      if (!prevUnit || !curUnit) continue;
      if (isolateBranches && prevUnit.branchIndex !== curUnit.branchIndex) continue;
      const prevBounds = groupBounds(prev.placements);
      const curBounds = groupBounds(cur.placements);
      const minParentCenter =
        prevUnit.centerX + prevUnit.coupleWidth / 2 + curUnit.coupleWidth / 2 + parentGap;
      let nextCenter = curUnit.centerX;

      const childOverlap = prevBounds.right + gap - curBounds.left;
      if (childOverlap > 0.5) {
        nextCenter = Math.max(nextCenter, curUnit.centerX + childOverlap);
        changed = true;
      }
      if (nextCenter < minParentCenter) {
        nextCenter = minParentCenter;
        changed = true;
      }

      if (Math.abs(nextCenter - curUnit.centerX) > 0.5) {
        curUnit.centerX = nextCenter;
        cur.placements = rebuildGroupPlacements(curUnit, cur.entries, opts);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/** 같은 줄 부모 카드끼리 겹치면 오른쪽으로만 밀기 */
function resolveUnitRowCoupleOverlap(
  units: UnitCenter[],
  gap: number,
  isolateBranches = false,
): boolean {
  if (isolateBranches) {
    const byBranch = new Map<number, UnitCenter[]>();
    for (const unit of units) {
      const list = byBranch.get(unit.branchIndex) ?? [];
      list.push(unit);
      byBranch.set(unit.branchIndex, list);
    }
    let changed = false;
    for (const branchUnits of byBranch.values()) {
      if (resolveUnitRowCoupleOverlap(branchUnits, gap, false)) changed = true;
    }
    return changed;
  }

  const sorted = [...units].sort((a, b) => a.centerX - b.centerX);
  let changed = false;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const minCenter = prev.centerX + prev.coupleWidth / 2 + cur.coupleWidth / 2 + gap;
    if (cur.centerX < minCenter - 0.5) {
      cur.centerX = minCenter;
      changed = true;
    }
  }
  return changed;
}

/** 배치 후 겹침이 있을 때만 부모 줄을 조정 (초기 간격은 좁게 유지) */
function stabilizePyramidRow(
  groups: PyramidGroup[],
  units: UnitCenter[],
  opts: StandardLayoutOptions,
  contentGap: number,
  coupleGap: number,
  isolateBranches: boolean,
): void {
  if (!groups.length) return;
  const snapshot = () => units.map(u => u.centerX.toFixed(1)).join('|');
  for (let iter = 0; iter < units.length * 4; iter += 1) {
    const before = snapshot();
    resolvePyramidRowOverlapByShiftingParents(
      groups,
      units,
      opts,
      contentGap,
      coupleGap,
      isolateBranches,
    );
    resolveUnitRowCoupleOverlap(units, coupleGap, isolateBranches);
    groups.forEach(group => {
      group.placements = rebuildGroupPlacements(units[group.unitIndex], group.entries, opts);
    });
    if (snapshot() === before) break;
  }
}

function applyUnitCenterToNodes(
  unit: UnitCenter,
  y: number,
  nodeById: Record<PersonId, PositionedNode>,
  opts: StandardLayoutOptions,
): void {
  const coupleLeftX = unit.centerX - unit.coupleWidth / 2;
  const bloodNode = nodeById[unit.bloodId];
  if (bloodNode) {
    bloodNode.x = coupleLeftX;
    bloodNode.y = y;
  }
  if (unit.spouseId) {
    const spouseNode = nodeById[unit.spouseId];
    if (spouseNode) {
      spouseNode.x = coupleLeftX + opts.cardWidth + opts.spouseGap;
      spouseNode.y = y;
    }
  }
}

/** 부모 부부 기준 피라미드 중심점 */
function pyramidCenters(
  count: number,
  coupleCenter: number,
  leftParentCenter: number,
  rightParentCenter: number | undefined,
  slotStep: number,
): number[] {
  if (count <= 0) return [];
  if (count === 1) return [coupleCenter];
  if (count === 2) {
    if (rightParentCenter != null && leftParentCenter !== rightParentCenter) {
      return [
        Math.min(leftParentCenter, rightParentCenter),
        Math.max(leftParentCenter, rightParentCenter),
      ];
    }
    return [coupleCenter - slotStep / 2, coupleCenter + slotStep / 2];
  }
  if (count === 3) {
    if (rightParentCenter != null && leftParentCenter !== rightParentCenter) {
      return [
        Math.min(leftParentCenter, rightParentCenter),
        coupleCenter,
        Math.max(leftParentCenter, rightParentCenter),
      ];
    }
    return [coupleCenter - slotStep, coupleCenter, coupleCenter + slotStep];
  }

  const centers: number[] = [coupleCenter];
  let step = 1;
  while (centers.length < count) {
    centers.push(coupleCenter - slotStep * step);
    if (centers.length < count) centers.push(coupleCenter + slotStep * step);
    step += 1;
  }
  return centers.sort((a, b) => a - b);
}

function buildPyramidPlacements(
  entries: ChildEntry[],
  coupleCenter: number,
  coupleLeftX: number,
  hasSpouse: boolean,
  opts: StandardLayoutOptions,
): ChildPlacement[] {
  if (!entries.length) return [];
  const leftParentCenter = coupleLeftX + opts.cardWidth / 2;
  const rightParentCenter = hasSpouse
    ? coupleLeftX + opts.cardWidth + opts.spouseGap + opts.cardWidth / 2
    : undefined;
  const slotStep = opts.cardWidth + opts.childGap;
  const centers = pyramidCenters(
    entries.length,
    coupleCenter,
    leftParentCenter,
    rightParentCenter,
    slotStep,
  );
  if (centers.length !== entries.length) {
    const fallbackStep = slotStep;
    const start = coupleCenter - ((entries.length - 1) * fallbackStep) / 2;
    for (let i = 0; i < entries.length; i += 1) {
      centers[i] = start + i * fallbackStep;
    }
    centers.length = entries.length;
  }
  const placements = entries
    .map((entry, idx) => ({
      ...entry,
      targetX: (centers[idx] ?? coupleCenter) - entry.width / 2,
    }))
    .filter(p => Number.isFinite(p.targetX))
    .sort((a, b) => a.targetX - b.targetX);

  for (let i = 1; i < placements.length; i += 1) {
    const prev = placements[i - 1];
    const cur = placements[i];
    const minX = prev.targetX + prev.width + opts.childGap;
    if (cur.targetX < minX) cur.targetX = minX;
  }

  if (placements.length > 0) {
    const left = placements[0].targetX;
    const right =
      placements[placements.length - 1].targetX + placements[placements.length - 1].width;
    const mid = (left + right) / 2;
    const shift = coupleCenter - mid;
    if (Number.isFinite(shift) && Math.abs(shift) > 0.1) {
      placements.forEach(p => {
        p.targetX += shift;
      });
    }
  }
  return placements;
}

function groupBounds(placements: ChildPlacement[]): { left: number; right: number; width: number } {
  if (!placements.length) return { left: 0, right: 0, width: 0 };
  const left = placements.reduce((acc, p) => Math.min(acc, p.targetX), Number.POSITIVE_INFINITY);
  const right = placements.reduce(
    (acc, p) => Math.max(acc, p.targetX + p.width),
    Number.NEGATIVE_INFINITY,
  );
  return { left, right, width: right - left };
}

function branchBounds(
  branchIndex: number,
  siblingUnits: UnitCenter[],
  nodeById: Record<PersonId, PositionedNode>,
  branchByPersonId: Map<PersonId, number>,
): { left: number; right: number } {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const node of Object.values(nodeById)) {
    if (branchByPersonId.get(node.id) !== branchIndex) continue;
    left = Math.min(left, node.x);
    right = Math.max(right, node.x + node.width);
  }
  if (!Number.isFinite(left)) {
    const unit = siblingUnits[branchIndex];
    if (!unit) return { left: 0, right: 0 };
    return {
      left: unit.centerX - unit.coupleWidth / 2,
      right: unit.centerX + unit.coupleWidth / 2,
    };
  }
  return { left, right };
}

/** 형제 가지(누나/나 등) 전체가 옆 가족과 겹치면 해당 가지 통째로 이동 */
function shiftBranch(
  branchIndex: number,
  deltaX: number,
  siblingUnits: UnitCenter[],
  siblingCenters: number[],
  branchByPersonId: Map<PersonId, number>,
  nodeById: Record<PersonId, PositionedNode>,
  trackedUnits: UnitCenter[][],
): void {
  if (Math.abs(deltaX) < 0.5) return;
  const unit = siblingUnits[branchIndex];
  if (!unit) return;
  unit.centerX += deltaX;
  siblingCenters[branchIndex] = unit.centerX;

  for (const node of Object.values(nodeById)) {
    if (branchByPersonId.get(node.id) === branchIndex) {
      node.x += deltaX;
    }
  }
  for (const units of trackedUnits) {
    for (const unit of units) {
      if (unit.branchIndex === branchIndex) unit.centerX += deltaX;
    }
  }
}

function resolveBranchOverlaps(
  coupleCount: number,
  siblingUnits: UnitCenter[],
  siblingCenters: number[],
  branchByPersonId: Map<PersonId, number>,
  nodeById: Record<PersonId, PositionedNode>,
  gap: number,
  trackedUnits: UnitCenter[][],
): void {
  for (let iter = 0; iter < coupleCount * 4; iter += 1) {
    let changed = false;
    for (let i = 1; i < coupleCount; i += 1) {
      const prevBounds = branchBounds(i - 1, siblingUnits, nodeById, branchByPersonId);
      const curBounds = branchBounds(i, siblingUnits, nodeById, branchByPersonId);
      const overlap = prevBounds.right + gap - curBounds.left;
      if (overlap > 0.5) {
        shiftBranch(
          i,
          overlap,
          siblingUnits,
          siblingCenters,
          branchByPersonId,
          nodeById,
          trackedUnits,
        );
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function tagBranchPerson(
  branchByPersonId: Map<PersonId, number>,
  id: PersonId | undefined,
  branchIndex: number,
): void {
  if (id) branchByPersonId.set(id, branchIndex);
}

export function buildStandardPedigreeLayout(
  people: Record<PersonId, Person>,
  options: Partial<StandardLayoutOptions> = {},
): LayoutResult & { selfId: PersonId; highlightIds: Set<PersonId> } {
  const opts = { ...STANDARD_LAYOUT_DEFAULTS, ...options };
  const slots = slotIdsForView(opts.view);
  const focalId = focalBloodId(opts.view, slots);
  const uw = unitW(opts);

  let siblingCouples = collectSiblingCouples(
    people,
    slots.father,
    slots.mother,
    slots,
  );
  const sideParentsForLayout = sideBranchParentIds(people, slots);
  siblingCouples = siblingCouples.filter(
    c => people[c.blood] && !isSideBranchDescendant(people[c.blood], sideParentsForLayout),
  );

  const defaultBloodOrder = defaultSiblingBloodOrder(opts.view, slots);
  const ordered = orderSiblingCouplesAroundFocal(
    siblingCouples,
    focalId,
    people,
    defaultBloodOrder,
  );
  siblingCouples = ordered.couples.filter(c => !!people[c.blood]);
  let focalIndex = siblingCouples.findIndex(c => c.blood === focalId);
  if (focalIndex < 0) {
    focalIndex = Math.min(SELF_SLOT_INDEX, Math.max(0, siblingCouples.length - 1));
  }

  const coupleCount = Math.max(1, siblingCouples.length);

  const rowW = coupleCount * uw + (coupleCount - 1) * opts.coupleGap;
  const canvasWidth = Math.max(1600, rowW + opts.padding * 2 + 240);
  const centerX = canvasWidth / 2;
  const siblingRowStartX = centerX - rowW / 2;
  const focalLayoutIndex = Math.max(0, Math.min(focalIndex, coupleCount - 1));

  // 형제 추가 시 옆 자식 줄과 겹치지 않도록 간격만 선계산
  const childEntriesByCouple: ChildEntry[][] = siblingCouples.map(couple => {
    const slotIndex = slots.siblings.findIndex(s => s.blood === couple.blood);
    const kids = collectChildren(people, couple.blood, couple.spouse);
    const orderedIds: PersonId[] = [];
    const seen = new Set<PersonId>();

    for (const kidId of kids) {
      if (people[kidId] && !seen.has(kidId)) {
        orderedIds.push(kidId);
        seen.add(kidId);
      }
    }
    if (slotIndex >= 0) {
      for (const cid of slots.children[slotIndex] ?? []) {
        if (people[cid] && !seen.has(cid)) {
          orderedIds.push(cid);
          seen.add(cid);
        }
      }
    }

    return orderedIds.map(id => {
      const spouseId =
        people[id]?.spouseId && people[people[id].spouseId!]
          ? people[id].spouseId
          : undefined;
      return {
        id,
        spouseId,
        width: spouseId ? uw : opts.cardWidth,
      };
    });
  });
  const siblingCenters = Array.from({ length: coupleCount }, (_, i) =>
    coupleCenterX(siblingRowStartX, i, opts),
  );

  const nodes: PositionedNode[] = [];
  const nodeById: Record<PersonId, PositionedNode> = {};
  const branchByPersonId = new Map<PersonId, number>();
  const highlightIds = new Set<PersonId>([focalId]);
  const ancestorSideBranches: SideBranch[] = [];
  const placedSideDescendantIds = new Set<PersonId>();

  const hasGreat = !!people[slots.ggf];
  const ancestorRows = hasGreat ? 3 : 2;
  const ySibling = opts.padding + opts.rowGap * ancestorRows;
  const yParent = ySibling - opts.rowGap;
  const yGrand = yParent - opts.rowGap;
  const yGreat = yGrand - opts.rowGap;
  const yChild = ySibling + opts.rowGap;

  const focalCenterX =
    siblingCenters[Math.max(0, Math.min(focalLayoutIndex, siblingCenters.length - 1))];
  const parentCoupleX = focalCenterX - uw / 2;
  const fatherCenterX = parentCoupleX + opts.cardWidth / 2;
  const motherCenterX = parentCoupleX + opts.cardWidth + opts.spouseGap + opts.cardWidth / 2;
  const hasPaternalGrand = !!people[slots.gf];
  const hasMaternalGrand = !!people[slots.mgf];
  const paternalGrandX =
    hasPaternalGrand && hasMaternalGrand
      ? focalCenterX - opts.coupleGap / 2 - uw
      : fatherCenterX - uw / 2;
  const maternalGrandX =
    hasPaternalGrand && hasMaternalGrand
      ? focalCenterX + opts.coupleGap / 2
      : motherCenterX - uw / 2;

  siblingCouples.forEach((couple, i) => {
    if (!people[couple.blood]) return;
    const x = siblingCenters[i] - uw / 2;
    placeCoupleNode(
      nodes,
      nodeById,
      couple.blood,
      couple.spouse && people[couple.spouse] ? couple.spouse : undefined,
      x,
      ySibling,
      0,
      opts,
      couple.blood === focalId,
    );
    tagBranchPerson(branchByPersonId, couple.blood, i);
    tagBranchPerson(branchByPersonId, couple.spouse, i);
  });

  if (people[slots.father]) {
    const hasMother = !!people[slots.mother];
    const fatherBloodSiblings = collectBloodSiblingCouples(people, slots.father);
    const motherBloodSiblings = hasMother
      ? collectBloodSiblingCouples(people, slots.mother)
      : [];
    const fatherCenter = personCenterInCouple(parentCoupleX, 'blood', hasMother, opts);
    const motherCenter = hasMother
      ? personCenterInCouple(parentCoupleX, 'spouse', true, opts)
      : fatherCenter;

    const leftPlaced = placeCouplesOneSide(
      nodes,
      nodeById,
      fatherBloodSiblings,
      fatherCenter,
      'left',
      yParent,
      -1,
      opts,
      people,
    );
    leftPlaced.placed.forEach(p => {
      ancestorSideBranches.push({
        side: 'left',
        anchorCenterX: p.centerX,
        anchorY: yParent,
        bloodId: p.blood,
        spouseId: p.spouse,
        memberIds: [p.blood, p.spouse].filter(Boolean) as PersonId[],
        descendantRowY: ySibling,
        descendantGeneration: 0,
      });
    });
    placeCoupleNode(
      nodes,
      nodeById,
      slots.father,
      hasMother ? slots.mother : undefined,
      parentCoupleX,
      yParent,
      -1,
      opts,
    );
    if (motherBloodSiblings.length) {
      const rightPlaced = placeCouplesOneSide(
        nodes,
        nodeById,
        motherBloodSiblings,
        motherCenter,
        'right',
        yParent,
        -1,
        opts,
        people,
      );
      rightPlaced.placed.forEach(p => {
        ancestorSideBranches.push({
          side: 'right',
          anchorCenterX: p.centerX,
          anchorY: yParent,
          bloodId: p.blood,
          spouseId: p.spouse,
          memberIds: [p.blood, p.spouse].filter(Boolean) as PersonId[],
          descendantRowY: ySibling,
          descendantGeneration: 0,
        });
      });
    }
  }
  if (people[slots.gf]) {
    const grandCluster = placeGrandCoupleCluster(
      nodes,
      nodeById,
      people,
      slots.gf,
      people[slots.gm] ? slots.gm : undefined,
      paternalGrandX,
      yGrand,
      -2,
      opts,
      yParent,
      -1,
    );
    ancestorSideBranches.push(...grandCluster.sideBranches);
  } else if (people[slots.gm]) {
    placeCoupleNode(
      nodes,
      nodeById,
      slots.gm,
      undefined,
      paternalGrandX,
      yGrand,
      -2,
      opts,
    );
  }
  if (people[slots.mgf]) {
    const grandCluster = placeGrandCoupleCluster(
      nodes,
      nodeById,
      people,
      slots.mgf,
      people[slots.mgm] ? slots.mgm : undefined,
      maternalGrandX,
      yGrand,
      -2,
      opts,
      yParent,
      -1,
    );
    ancestorSideBranches.push(...grandCluster.sideBranches);
  } else if (people[slots.mgm]) {
    placeCoupleNode(
      nodes,
      nodeById,
      slots.mgm,
      undefined,
      maternalGrandX,
      yGrand,
      -2,
      opts,
    );
  }
  if (people[slots.ggf]) {
    const greatCluster = placeGrandCoupleCluster(
      nodes,
      nodeById,
      people,
      slots.ggf,
      people[slots.ggm] ? slots.ggm : undefined,
      paternalGrandX,
      yGreat,
      -3,
      opts,
      yGrand,
      -2,
    );
    ancestorSideBranches.push(...greatCluster.sideBranches);
  }

  // 조부모·증조 형제의 자녀 → 부모/조부모 줄
  ancestorSideBranches
    .filter(b => b.descendantRowY < ySibling)
    .forEach(branch => {
      layoutSideBranchDescendants(
        branch,
        people,
        nodes,
        nodeById,
        opts,
        placedSideDescendantIds,
        branch.descendantRowY + opts.rowGap,
        [branch.descendantRowY, branch.descendantRowY + opts.rowGap],
      );
    });

  const childUnits: UnitCenter[] = [];
  const placedChildIds = new Set<PersonId>();

  const siblingUnits: UnitCenter[] = siblingCouples.map((couple, i) => ({
    bloodId: couple.blood,
    spouseId: couple.spouse && people[couple.spouse] ? couple.spouse : undefined,
    centerX: siblingCenters[i],
    coupleWidth: uw,
    branchIndex: i,
  }));

  const childPyramidGroups: PyramidGroup[] = [];
  siblingCouples.forEach((couple, i) => {
    const entries = childEntriesByCouple[i] ?? [];
    if (!entries.length) return;
    childPyramidGroups.push({
      unitIndex: i,
      entries,
      placements: rebuildGroupPlacements(siblingUnits[i], entries, opts),
    });
  });

  stabilizePyramidRow(childPyramidGroups, siblingUnits, opts, opts.childGap, opts.coupleGap, false);

  siblingUnits.forEach((unit, i) => {
    siblingCenters[i] = unit.centerX;
    applyUnitCenterToNodes(unit, ySibling, nodeById, opts);
  });

  const trackedUnits: UnitCenter[][] = [childUnits];

  let maxContentRight = siblingCenters.reduce((acc, c) => Math.max(acc, c + uw / 2), 0);
  childPyramidGroups.forEach(group => {
    group.placements.forEach(entry => {
      if (placedChildIds.has(entry.id) || placedSideDescendantIds.has(entry.id)) return;
      placeCoupleNode(nodes, nodeById, entry.id, entry.spouseId, entry.targetX, yChild, 1, opts);
      placedChildIds.add(entry.id);
      tagBranchPerson(branchByPersonId, entry.id, group.unitIndex);
      tagBranchPerson(branchByPersonId, entry.spouseId, group.unitIndex);
      childUnits.push({
        bloodId: entry.id,
        spouseId: entry.spouseId,
        centerX: entry.targetX + entry.width / 2,
        coupleWidth: entry.width,
        branchIndex: group.unitIndex,
      });
      maxContentRight = Math.max(maxContentRight, entry.targetX + entry.width);
    });
  });

  resolveBranchOverlaps(
    coupleCount,
    siblingUnits,
    siblingCenters,
    branchByPersonId,
    nodeById,
    opts.childGap,
    trackedUnits,
  );
  siblingUnits.forEach((unit, i) => {
    siblingCenters[i] = unit.centerX;
    applyUnitCenterToNodes(unit, ySibling, nodeById, opts);
  });

  ancestorSideBranches
    .filter(b => b.anchorY === yParent)
    .forEach(branch => {
      layoutSideBranchDescendants(
        branch,
        people,
        nodes,
        nodeById,
        opts,
        placedSideDescendantIds,
        yChild,
        [ySibling, yChild],
      );
    });

  let canvasBottomY = yChild;

  if (opts.view === 'self') {
    let parentUnits = childUnits;
    let parentRowY = yChild;
    let nextGeneration = 2;
    let rowY = yChild;
    const placedDescendantIds = new Set<PersonId>();

    for (let depth = 0; depth < 6; depth += 1) {
      rowY += opts.rowGap;
      const nextUnits: UnitCenter[] = [];
      const descPyramidGroups: PyramidGroup[] = [];
      trackedUnits.push(nextUnits);

      const orderedParentIndices = parentUnits
        .map((_, idx) => idx)
        .sort((a, b) => parentUnits[a].centerX - parentUnits[b].centerX);

      orderedParentIndices.forEach(parentIndex => {
        const unit = parentUnits[parentIndex];
        const descendants = collectChildren(people, unit.bloodId, unit.spouseId).filter(
          id => !placedDescendantIds.has(id) && !!people[id],
        );
        if (!descendants.length) return;

        const entries: ChildEntry[] = descendants.map(descId => {
          const descSpouseId =
            people[descId]?.spouseId && people[people[descId].spouseId!]
              ? people[descId].spouseId
              : undefined;
          return {
            id: descId,
            spouseId: descSpouseId,
            width: descSpouseId ? uw : opts.cardWidth,
          };
        });

        descPyramidGroups.push({
          unitIndex: parentIndex,
          entries,
          placements: rebuildGroupPlacements(unit, entries, opts),
        });
      });

      if (!descPyramidGroups.length) {
        trackedUnits.pop();
        break;
      }

      stabilizePyramidRow(
        descPyramidGroups,
        parentUnits,
        opts,
        opts.childGap,
        opts.childGap,
        true,
      );

      parentUnits.forEach(unit => {
        applyUnitCenterToNodes(unit, parentRowY, nodeById, opts);
      });

      descPyramidGroups.forEach(group => {
        const branchIndex = parentUnits[group.unitIndex].branchIndex;
        group.placements.forEach(entry => {
          placeCoupleNode(
            nodes,
            nodeById,
            entry.id,
            entry.spouseId,
            entry.targetX,
            rowY,
            nextGeneration,
            opts,
          );
          tagBranchPerson(branchByPersonId, entry.id, branchIndex);
          tagBranchPerson(branchByPersonId, entry.spouseId, branchIndex);
          nextUnits.push({
            bloodId: entry.id,
            spouseId: entry.spouseId,
            centerX: entry.targetX + entry.width / 2,
            coupleWidth: entry.width,
            branchIndex,
          });
          placedDescendantIds.add(entry.id);
          maxContentRight = Math.max(maxContentRight, entry.targetX + entry.width);
        });
      });

      resolveBranchOverlaps(
        coupleCount,
        siblingUnits,
        siblingCenters,
        branchByPersonId,
        nodeById,
        opts.childGap,
        trackedUnits,
      );
      siblingUnits.forEach((unit, i) => {
        siblingCenters[i] = unit.centerX;
        applyUnitCenterToNodes(unit, ySibling, nodeById, opts);
      });

      canvasBottomY = rowY;
      parentUnits = nextUnits;
      parentRowY = rowY;
      nextGeneration += 1;
      if (!parentUnits.length) break;
    }
  }

  const canvasHeight = canvasBottomY + opts.cardHeight + opts.padding + 100;
  const computedWidth = Math.max(
    canvasWidth,
    Number.isFinite(maxContentRight) ? maxContentRight + opts.padding * 2 : canvasWidth,
  );

  return {
    canvasWidth: Number.isFinite(computedWidth) ? computedWidth : 1600,
    canvasHeight: Number.isFinite(canvasHeight) ? canvasHeight : 1200,
    nodes,
    edges: computeEdges(people),
    nodeById,
    selfId: focalId,
    highlightIds,
  };
}
