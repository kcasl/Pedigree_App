/**
 * SDD 참고 4세대 고정 슬롯 배치
 */

import type { ActiveView } from '../types/lineage';
import type { Person, PersonId } from '../types/pedigree';
import type { Edge, LayoutResult, PositionedNode } from './pedigreeLayout';
import {
  DEFAULT_SIBLING_SLOTS,
  focalBloodId,
  SELF_SLOT_INDEX,
  slotIdsForView,
} from './standardTemplate';

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

  for (const p of Object.values(people)) {
    if (templateBlood.has(p.id)) continue;
    if (p.fatherId === parentFather && p.motherId === parentMother) {
      extra.push({ blood: p.id, spouse: p.spouseId });
    }
  }

  const merged: Array<{ blood: PersonId; spouse?: PersonId }> = [...templatePairs];
  for (const e of extra) {
    if (!merged.some(m => m.blood === e.blood)) merged.push(e);
  }
  return merged;
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
  return ids.sort();
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
    if (!id || nodeById[id]) return;
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

type ChildGroupResolved = {
  parentCenterX: number;
  placements: ChildPlacement[];
};

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

/** 부모 아래 피라미드 유지. 옆 그룹과 겹치면 그룹 통째로만 밀어냄. */
function resolveGroupCollisions(
  groups: ChildGroupResolved[],
  gap: number,
): ChildGroupResolved[] {
  const planned = [...groups]
    .filter(g => g.placements.length > 0)
    .sort((a, b) => a.parentCenterX - b.parentCenterX);

  for (let i = 1; i < planned.length; i += 1) {
    const prev = planned[i - 1];
    const cur = planned[i];
    if (!prev.placements.length || !cur.placements.length) continue;
    const prevRight = prev.placements.reduce(
      (acc, p) => Math.max(acc, p.targetX + p.width),
      Number.NEGATIVE_INFINITY,
    );
    const curLeft = cur.placements.reduce(
      (acc, p) => Math.min(acc, p.targetX),
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(prevRight) || !Number.isFinite(curLeft)) continue;
    const overlap = prevRight + gap - curLeft;
    if (overlap > 0) {
      cur.placements.forEach(p => {
        p.targetX += overlap;
      });
    }
  }
  return planned;
}

export function buildStandardPedigreeLayout(
  people: Record<PersonId, Person>,
  options: Partial<StandardLayoutOptions> = {},
): LayoutResult & { selfId: PersonId; highlightIds: Set<PersonId> } {
  const opts = { ...STANDARD_LAYOUT_DEFAULTS, ...options };
  const slots = slotIdsForView(opts.view);
  const focalId = focalBloodId(opts.view, slots);
  const uw = unitW(opts);

  const siblingCouples = collectSiblingCouples(
    people,
    slots.father,
    slots.mother,
    slots,
  );

  const coupleCount = Math.max(DEFAULT_SIBLING_SLOTS, siblingCouples.length);
  let focalIndex = siblingCouples.findIndex(c => c.blood === focalId);
  if (focalIndex < 0) focalIndex = SELF_SLOT_INDEX;

  const rowW = coupleCount * uw + (coupleCount - 1) * opts.coupleGap;
  const canvasWidth = Math.max(1600, rowW + opts.padding * 2 + 240);
  const centerX = canvasWidth / 2;
  const siblingRowStartX = centerX - rowW / 2;

  const nodes: PositionedNode[] = [];
  const nodeById: Record<PersonId, PositionedNode> = {};
  const highlightIds = new Set<PersonId>([focalId]);

  const hasGreat = !!people[slots.ggf];
  const ancestorRows = hasGreat ? 3 : 2;
  const ySibling = opts.padding + opts.rowGap * ancestorRows;
  const yParent = ySibling - opts.rowGap;
  const yGrand = yParent - opts.rowGap;
  const yGreat = yGrand - opts.rowGap;

  const focalCenterX = coupleCenterX(siblingRowStartX, focalIndex, opts);
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
    const x = siblingRowStartX + i * (uw + opts.coupleGap);
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
  });

  if (people[slots.father]) {
    placeCoupleNode(
      nodes,
      nodeById,
      slots.father,
      people[slots.mother] ? slots.mother : undefined,
      parentCoupleX,
      yParent,
      -1,
      opts,
    );
  }
  if (people[slots.gf]) {
    placeCoupleNode(
      nodes,
      nodeById,
      slots.gf,
      people[slots.gm] ? slots.gm : undefined,
      paternalGrandX,
      yGrand,
      -2,
      opts,
    );
  }
  if (people[slots.mgf]) {
    placeCoupleNode(
      nodes,
      nodeById,
      slots.mgf,
      people[slots.mgm] ? slots.mgm : undefined,
      maternalGrandX,
      yGrand,
      -2,
      opts,
    );
  }
  if (people[slots.ggf]) {
    placeCoupleNode(
      nodes,
      nodeById,
      slots.ggf,
      people[slots.ggm] ? slots.ggm : undefined,
      paternalGrandX,
      yGreat,
      -3,
      opts,
    );
  }

  const yChild = ySibling + opts.rowGap;
  const childUnits: Array<{ bloodId: PersonId; spouseId?: PersonId; centerX: number }> = [];
  const placedChildIds = new Set<PersonId>();

  const childGroupDrafts: ChildGroupResolved[] = [];
  siblingCouples.forEach((couple, i) => {
    const kids = collectChildren(people, couple.blood, couple.spouse);
    const orderedIds: PersonId[] = [];
    for (const kidId of kids) {
      if (people[kidId] && !placedChildIds.has(kidId)) {
        orderedIds.push(kidId);
        placedChildIds.add(kidId);
      }
    }
    for (const cid of slots.children[i] ?? []) {
      if (people[cid] && !placedChildIds.has(cid)) {
        orderedIds.push(cid);
        placedChildIds.add(cid);
      }
    }
    if (!orderedIds.length) return;

    const entries: ChildEntry[] = orderedIds.map(id => {
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
    const coupleCenter = coupleCenterX(siblingRowStartX, i, opts);
    const coupleLeftX = coupleCenter - uw / 2;
    const hasSpouse = !!(couple.spouse && people[couple.spouse]);
    childGroupDrafts.push({
      parentCenterX: coupleCenter,
      placements: buildPyramidPlacements(entries, coupleCenter, coupleLeftX, hasSpouse, opts),
    });
  });

  const childGroups = resolveGroupCollisions(childGroupDrafts, opts.childGap);
  let maxContentRight = siblingRowStartX + rowW;
  childGroups.forEach(group => {
    group.placements.forEach(entry => {
      placeCoupleNode(nodes, nodeById, entry.id, entry.spouseId, entry.targetX, yChild, 1, opts);
      childUnits.push({
        bloodId: entry.id,
        spouseId: entry.spouseId,
        centerX: entry.targetX + entry.width / 2,
      });
      maxContentRight = Math.max(maxContentRight, entry.targetX + entry.width);
    });
  });

  let canvasBottomY = yChild;

  if (opts.view === 'self') {
    let currentUnits = childUnits;
    let nextGeneration = 2;
    let rowY = yChild;
    const placedDescendantIds = new Set<PersonId>();

    for (let depth = 0; depth < 6; depth++) {
      rowY += opts.rowGap;
      const nextUnits: Array<{ bloodId: PersonId; spouseId?: PersonId; centerX: number }> = [];
      const descDrafts: ChildGroupResolved[] = [];

      const orderedParents = [...currentUnits].sort((a, b) => a.centerX - b.centerX);
      orderedParents.forEach(unit => {
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
        const coupleLeftX = unit.centerX - (unit.spouseId ? uw : opts.cardWidth) / 2;
        descDrafts.push({
          parentCenterX: unit.centerX,
          placements: buildPyramidPlacements(
            entries,
            unit.centerX,
            coupleLeftX,
            !!unit.spouseId,
            opts,
          ),
        });
      });

      if (!descDrafts.length) break;

      const descGroups = resolveGroupCollisions(descDrafts, opts.childGap);
      descGroups.forEach(group => {
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
          nextUnits.push({
            bloodId: entry.id,
            spouseId: entry.spouseId,
            centerX: entry.targetX + entry.width / 2,
          });
          placedDescendantIds.add(entry.id);
          maxContentRight = Math.max(maxContentRight, entry.targetX + entry.width);
        });
      });

      canvasBottomY = rowY;
      currentUnits = nextUnits;
      nextGeneration += 1;
      if (!currentUnits.length) break;
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
