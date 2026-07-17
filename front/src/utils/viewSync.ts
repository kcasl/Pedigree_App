/**
 * 뷰 간 동기화 — **나 시점(self)이 기준**.
 * self → 친가/외가/배우자 집안으로만 필드를 복사한다. self는 syncAllViews에서 절대 수정하지 않는다.
 */

import type { ActiveView, PedigreeStore } from '../types/lineage';
import type { Person, PersonId } from '../types/pedigree';
import { sortIdsByBirth, buildChildOrdinalLabels } from './birthOrder';
import { buildKinshipLabels } from './kinship';
import { buildSiblingKinshipLabels } from './siblingKinship';
import { SELF_SLOT_INDEX, slotIdsForView } from './standardTemplate';
import { nowIso } from './date';

type LineageFocalView = 'paternal' | 'maternal';

/** 친가/외가 본인(부·모) 부부 아래 자녀 슬롯 id — pat_c2_0, mat_c2_1 … */
function focalChildTargetId(view: LineageFocalView, index: number): PersonId {
  const prefix = view === 'paternal' ? 'pat' : 'mat';
  return `${prefix}_c${SELF_SLOT_INDEX}_${index}`;
}

/** 나 시점 — 부모 공통 자녀(형제 줄 + 같은 부모 링크 인물) */
function getSelfSiblingBloodIds(selfPeople: Record<PersonId, Person>): PersonId[] {
  const me = slotIdsForView('self');
  const father = selfPeople[me.father];
  const mother = selfPeople[me.mother];
  if (!father || !mother) return [];

  return sortIdsByBirth(
    collectCoupleChildren(selfPeople, father.id, mother.id),
    selfPeople,
  );
}

function focalCoupleParentIds(
  view: LineageFocalView,
  slots: ReturnType<typeof slotIdsForView>,
): { fatherId: PersonId; motherId: PersonId } {
  if (view === 'paternal') {
    return { fatherId: slots.selfId, motherId: slots.spouseId };
  }
  return { fatherId: slots.spouseId, motherId: slots.selfId };
}

/**
 * 나 시점 형제(나 포함) → 친가/외가 본인 부부의 자녀 줄.
 * 슬롯이 부족하면 pat_c2_2, pat_c2_3 … 노드를 생성한다.
 */
function syncFocalChildrenFromSelf(
  selfPeople: Record<PersonId, Person>,
  targetPeople: Record<PersonId, Person>,
  view: LineageFocalView,
): void {
  const slots = slotIdsForView(view);
  const { fatherId, motherId } = focalCoupleParentIds(view, slots);
  const siblingIds = getSelfSiblingBloodIds(selfPeople);
  if (!siblingIds.length) return;

  const syncedTargetIds = new Set<PersonId>();

  siblingIds.forEach((selfBloodId, index) => {
    const source = selfPeople[selfBloodId];
    if (!source) return;

    const targetId = focalChildTargetId(view, index);
    syncedTargetIds.add(targetId);

    const existing = targetPeople[targetId];
    const base: Person = existing ?? {
      id: targetId,
      name: source.name || '친족',
      createdAt: source.createdAt || nowIso(),
      gender: source.gender ?? 'unknown',
      fatherId,
      motherId,
    };

    targetPeople[targetId] = applyFieldsFromSource(source, {
      ...base,
      fatherId,
      motherId,
    });
  });

  // 이전에 만들어 둔 초과 자녀 슬롯 정리
  for (const id of Object.keys(targetPeople)) {
    if (!id.startsWith(`${view === 'paternal' ? 'pat' : 'mat'}_c${SELF_SLOT_INDEX}_`)) continue;
    const p = targetPeople[id];
    if (!p) continue;
    if (p.fatherId === fatherId && p.motherId === motherId && !syncedTargetIds.has(id)) {
      delete targetPeople[id];
    }
  }
}

/** 친가/외가 자녀 줄 편집 → 나 시점 형제 줄 */
function propagateFocalChildrenToSelfSiblings(
  selfPeople: Record<PersonId, Person>,
  editedPeople: Record<PersonId, Person>,
  view: LineageFocalView,
): void {
  const me = slotIdsForView('self');
  const slots = slotIdsForView(view);
  const { fatherId, motherId } = focalCoupleParentIds(view, slots);

  const lineageChildIds = sortIdsByBirth(
    collectCoupleChildren(editedPeople, fatherId, motherId),
    editedPeople,
  );
  const selfSiblingIds = getSelfSiblingBloodIds(selfPeople);
  const count = Math.min(lineageChildIds.length, selfSiblingIds.length);

  for (let i = 0; i < count; i += 1) {
    const lineageChild = editedPeople[lineageChildIds[i]];
    const selfId = selfSiblingIds[i];
    if (lineageChild && selfId && selfPeople[selfId]) {
      selfPeople[selfId] = applyFieldsFromSource(lineageChild, selfPeople[selfId]);
    }
  }
}

/** 사용자 입력 필드만 복사 — id·부모·배우자 관계는 대상 슬롯 유지 */
function applyFieldsFromSource(source: Person, target: Person): Person {
  return {
    ...target,
    name: source.name?.trim() ? source.name : target.name,
    phone: source.phone ?? target.phone,
    birthDate: source.birthDate ?? target.birthDate,
    gender: source.gender && source.gender !== 'unknown' ? source.gender : target.gender,
    photoUri: source.photoUri ?? target.photoUri,
    note: source.note ?? target.note,
  };
}

function copyMappedFields(
  selfPeople: Record<PersonId, Person>,
  targetPeople: Record<PersonId, Person>,
  pairs: Array<[PersonId, PersonId]>,
): void {
  for (const [selfId, targetId] of pairs) {
    const source = selfPeople[selfId];
    const target = targetPeople[targetId];
    if (!source || !target) continue;
    targetPeople[targetId] = applyFieldsFromSource(source, target);
  }
}

function collectCoupleChildren(
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
  return ids;
}

/** 친가보기 — 아버지가 "나" 자리. 나 시점 아버지·친가 쪽 조상 정보를 복사 */
function syncPaternalFromSelf(
  selfPeople: Record<PersonId, Person>,
  patPeople: Record<PersonId, Person>,
): void {
  const me = slotIdsForView('self');
  const pat = slotIdsForView('paternal');

  copyMappedFields(selfPeople, patPeople, [
    [me.father, pat.selfId],
    [me.mother, pat.spouseId],
    [me.gf, pat.father],
    [me.gm, pat.mother],
    [me.ggf, pat.gf],
    [me.ggm, pat.gm],
    [me.mgf, pat.mgf],
    [me.mgm, pat.mgm],
  ]);

  syncFocalChildrenFromSelf(selfPeople, patPeople, 'paternal');
}

/** 외가보기 — 어머니가 "나" 자리 */
function syncMaternalFromSelf(
  selfPeople: Record<PersonId, Person>,
  matPeople: Record<PersonId, Person>,
): void {
  const me = slotIdsForView('self');
  const mat = slotIdsForView('maternal');

  copyMappedFields(selfPeople, matPeople, [
    [me.mother, mat.selfId],
    [me.father, mat.spouseId],
    [me.mgf, mat.father],
    [me.mgm, mat.mother],
  ]);

  syncFocalChildrenFromSelf(selfPeople, matPeople, 'maternal');
}

/** 배우자 집안 — 배우자가 "나" 자리, 나는 배우자 옆 */
function syncSpouseFromSelf(
  selfPeople: Record<PersonId, Person>,
  spoPeople: Record<PersonId, Person>,
): void {
  const me = slotIdsForView('self');
  const spo = slotIdsForView('spouse');

  copyMappedFields(selfPeople, spoPeople, [
    [me.spouseId, spo.selfId],
    [me.selfId, spo.spouseId],
  ]);

  const focal = selfPeople[me.selfId];
  if (!focal) return;

  const spouseId = focal.spouseId && selfPeople[focal.spouseId] ? focal.spouseId : undefined;
  const selfChildIds = sortIdsByBirth(
    collectCoupleChildren(selfPeople, me.selfId, spouseId),
    selfPeople,
  );
  const spoChildSlots = spo.children[SELF_SLOT_INDEX] ?? [];
  for (let i = 0; i < selfChildIds.length; i += 1) {
    const source = selfPeople[selfChildIds[i]];
    const targetId = spoChildSlots[i];
    const target = targetId ? spoPeople[targetId] : undefined;
    if (source && target) spoPeople[targetId] = applyFieldsFromSource(source, target);
  }

  const meGc = selfPeople['me_gc2_0'];
  const spoGc = spoPeople['spo_gc2_0'];
  if (meGc && spoGc) spoPeople['spo_gc2_0'] = applyFieldsFromSource(meGc, spoGc);
}

/** self 기준 → 다른 뷰만 갱신. self는 변경하지 않음 */
export function syncAllViews(store: PedigreeStore): PedigreeStore {
  const selfPeople = { ...store.views.self };
  const paternal = { ...store.views.paternal };
  const maternal = { ...store.views.maternal };
  const spouse = { ...store.views.spouse };

  syncPaternalFromSelf(selfPeople, paternal);
  syncMaternalFromSelf(selfPeople, maternal);
  syncSpouseFromSelf(selfPeople, spouse);

  return {
    ...store,
    views: {
      self: selfPeople,
      paternal,
      maternal,
      spouse,
    },
  };
}

/** 친가/외가/배우자에서 편집 시 → 대응 self 슬롯에 반영 */
const LINEAGE_TO_SELF: Partial<Record<ActiveView, Array<[PersonId, PersonId]>>> = (() => {
  const me = slotIdsForView('self');
  const pat = slotIdsForView('paternal');
  const mat = slotIdsForView('maternal');
  const spo = slotIdsForView('spouse');

  return {
    paternal: [
      [pat.selfId, me.father],
      [pat.spouseId, me.mother],
      [pat.father, me.gf],
      [pat.mother, me.gm],
      [pat.gf, me.ggf],
      [pat.gm, me.ggm],
      [pat.mgf, me.mgf],
      [pat.mgm, me.mgm],
    ],
    maternal: [
      [mat.selfId, me.mother],
      [mat.spouseId, me.father],
      [mat.father, me.mgf],
      [mat.mother, me.mgm],
    ],
    spouse: [
      [spo.selfId, me.spouseId],
      [spo.spouseId, me.selfId],
    ],
  };
})();

function propagateLineageEditToSelf(
  views: Record<ActiveView, Record<PersonId, Person>>,
  editedView: ActiveView,
): void {
  const me = slotIdsForView('self');
  const selfPeople = views.self;
  const editedPeople = views[editedView];

  const staticPairs = LINEAGE_TO_SELF[editedView] ?? [];

  for (const [lineageId, selfId] of staticPairs) {
    const edited = editedPeople[lineageId];
    const selfTarget = selfPeople[selfId];
    if (edited && selfTarget) {
      selfPeople[selfId] = applyFieldsFromSource(edited, selfTarget);
    }
  }

  if (editedView === 'paternal') {
    propagateFocalChildrenToSelfSiblings(selfPeople, editedPeople, 'paternal');
  }
  if (editedView === 'maternal') {
    propagateFocalChildrenToSelfSiblings(selfPeople, editedPeople, 'maternal');
  }

  if (editedView === 'spouse') {
    const spo = slotIdsForView('spouse');
    const focal = selfPeople[me.selfId];
    if (!focal) return;
    const spouseId = focal.spouseId && selfPeople[focal.spouseId] ? focal.spouseId : undefined;
    const selfChildIds = sortIdsByBirth(
      collectCoupleChildren(selfPeople, me.selfId, spouseId),
      selfPeople,
    );
    const spoChildSlots = spo.children[SELF_SLOT_INDEX] ?? [];
    for (let i = 0; i < spoChildSlots.length; i += 1) {
      const spoChild = editedPeople[spoChildSlots[i]];
      const selfChildId = selfChildIds[i];
      if (spoChild && selfChildId && selfPeople[selfChildId]) {
        selfPeople[selfChildId] = applyFieldsFromSource(spoChild, selfPeople[selfChildId]);
      }
    }
  }
}

export function syncStoreAfterEdit(
  store: PedigreeStore,
  editedView: ActiveView,
  nextViewPeople: Record<PersonId, Person>,
): PedigreeStore {
  const views: Record<ActiveView, Record<PersonId, Person>> = {
    ...store.views,
    [editedView]: nextViewPeople,
  };

  if (editedView !== 'self') {
    propagateLineageEditToSelf(views, editedView);
  }

  return syncAllViews({ ...store, views });
}

/** 친가/외가·배우자 집안에서 실제 "나"(self 뷰 본인)에 해당하는 blood id */
export function resolveUserBloodIdInView(
  view: ActiveView,
  selfPeople: Record<PersonId, Person>,
  viewPeople: Record<PersonId, Person>,
): PersonId | null {
  const me = slotIdsForView('self');
  if (view === 'self') return me.selfId;

  if (view === 'spouse') {
    const spo = slotIdsForView('spouse');
    return viewPeople[spo.spouseId] ? spo.spouseId : null;
  }

  if (view === 'paternal' || view === 'maternal') {
    const siblingIds = getSelfSiblingBloodIds(selfPeople);
    const userIndex = siblingIds.indexOf(me.selfId);
    if (userIndex < 0) return null;
    const targetId = focalChildTargetId(view, userIndex);
    return viewPeople[targetId] ? targetId : null;
  }

  return null;
}

export type SiblingAddTarget = 'blood' | 'couple_child';

export type SiblingAddResolution = {
  fatherId?: PersonId;
  motherId?: PersonId;
  /** couple_child → 부모 부부의 자녀(형제 줄), blood → 선택 인물과 같은 부모 */
  target: SiblingAddTarget;
};

/** 친가/외가 — 형제 추가 허용 노드 (조부모·부모 줄만, 형제 줄은 제외) */
export function canAddSiblingFromNode(view: ActiveView, ofId: PersonId): boolean {
  if (view === 'self' || view === 'spouse') return true;
  if (view !== 'paternal' && view !== 'maternal') return true;
  const slots = slotIdsForView(view);
  const allowed = new Set<PersonId>([
    slots.father,
    slots.mother,
    slots.gf,
    slots.gm,
    slots.mgf,
    slots.mgm,
    slots.ggf,
    slots.ggm,
  ]);
  return allowed.has(ofId);
}

/**
 * 형제 추가 시 부모·대상 줄 결정.
 * - 부모 줄 칭할아버지·칭할머니: 각각 친형제 → 왼/오른쪽
 * - 조부모·외조부모: 각 카드의 친형제 → 해당 조부모 옆(좌/우)
 */
export function resolveSiblingAdd(
  view: ActiveView,
  people: Record<PersonId, Person>,
  ofId: PersonId,
): SiblingAddResolution | null {
  const slots = slotIdsForView(view);
  const person = people[ofId];
  if (!person) return null;

  if (view === 'paternal' || view === 'maternal') {
    if (ofId === slots.father || ofId === slots.mother) {
      if (!person.fatherId || !person.motherId) return null;
      return {
        fatherId: person.fatherId,
        motherId: person.motherId,
        target: 'blood',
      };
    }
    if (
      ofId === slots.gf ||
      ofId === slots.gm ||
      ofId === slots.mgf ||
      ofId === slots.mgm ||
      ofId === slots.ggf ||
      ofId === slots.ggm
    ) {
      if (!person.fatherId || !person.motherId) return null;
      return {
        fatherId: person.fatherId,
        motherId: person.motherId,
        target: 'blood',
      };
    }
    return null;
  }

  return {
    fatherId: person.fatherId,
    motherId: person.motherId,
    target: 'blood',
  };
}

/** @deprecated resolveSiblingAdd 사용 */
export function resolveSiblingParentIds(
  view: ActiveView,
  people: Record<PersonId, Person>,
  ofId: PersonId,
): { fatherId?: PersonId; motherId?: PersonId } {
  const resolved = resolveSiblingAdd(view, people, ofId);
  if (!resolved) return {};
  return { fatherId: resolved.fatherId, motherId: resolved.motherId };
}

/** 아버지·어머니(형제 줄) 자녀일 때만 템플릿 형제 슬롯 사용 */
export function nextEmptySiblingSlotId(
  view: ActiveView,
  people: Record<PersonId, Person>,
  resolution: SiblingAddResolution | { fatherId?: PersonId; motherId?: PersonId },
): PersonId | null {
  const slots = slotIdsForView(view);
  if ('target' in resolution && resolution.target !== 'couple_child') {
    return null;
  }
  const parents = resolution;
  if (parents.fatherId !== slots.father || parents.motherId !== slots.mother) {
    return null;
  }
  const focalSlot = SELF_SLOT_INDEX;
  const order =
    view === 'paternal' || view === 'maternal'
      ? [0, 1, 3, 4, focalSlot]
      : [0, 1, 2, 3, 4];

  for (const i of order) {
    const id = slots.siblings[i]?.blood;
    if (id && !people[id]) return id;
  }
  return null;
}

function getFocalChildBloodIds(
  view: LineageFocalView,
  peopleById: Record<PersonId, Person>,
): PersonId[] {
  const slots = slotIdsForView(view);
  const { fatherId, motherId } = focalCoupleParentIds(view, slots);
  return sortIdsByBirth(
    collectCoupleChildren(peopleById, fatherId, motherId),
    peopleById,
  );
}

export function buildViewKinshipLabels(
  view: ActiveView,
  peopleById: Record<PersonId, Person>,
  selfPeopleById?: Record<PersonId, Person>,
): Record<PersonId, string> {
  const slots = slotIdsForView(view);
  const focalId = slots.selfId;
  const selfRef = selfPeopleById ?? (view === 'self' ? peopleById : undefined);

  const labels = buildKinshipLabels(peopleById, focalId);
  const siblingBloodIds = slots.siblings.map(s => s.blood).filter(id => peopleById[id]);
  Object.assign(labels, buildSiblingKinshipLabels(peopleById, focalId, siblingBloodIds));

  if (selfRef) {
    const userBloodId = resolveUserBloodIdInView(view, selfRef, peopleById);

    if ((view === 'paternal' || view === 'maternal') && userBloodId && peopleById[userBloodId]) {
      const focalChildren = getFocalChildBloodIds(view, peopleById);
      Object.assign(
        labels,
        buildSiblingKinshipLabels(peopleById, userBloodId, focalChildren),
      );
      labels[userBloodId] = '본인';
    }
  }

  if (view === 'spouse') {
    const meId = slots.spouseId;
    if (meId && peopleById[meId]) labels[meId] = '본인';
    if (focalId && peopleById[focalId]) labels[focalId] = '배우자';
  }

  return labels;
}

export function buildViewOrdinalLabels(
  view: ActiveView,
  peopleById: Record<PersonId, Person>,
): Record<PersonId, string> {
  const slots = slotIdsForView(view);
  const parentPairs: Array<{ bloodId: PersonId; spouseId?: PersonId }> = [];
  for (const sib of slots.siblings) {
    const blood = peopleById[sib.blood];
    if (!blood) continue;
    parentPairs.push({
      bloodId: sib.blood,
      spouseId: blood.spouseId && peopleById[blood.spouseId] ? blood.spouseId : undefined,
    });
  }
  return buildChildOrdinalLabels(peopleById, parentPairs);
}
