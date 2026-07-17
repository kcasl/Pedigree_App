import type { ActiveView } from '../types/lineage';
import type { Person, PersonId } from '../types/pedigree';
import { slotIdsForView } from './standardTemplate';

export type AgeRelation = 'older' | 'younger' | 'same' | 'unknown';

export function birthTimestamp(person?: Person): number | null {
  if (!person) return null;
  if (person.birthDate) {
    const t = Date.parse(person.birthDate);
    if (Number.isFinite(t)) return t;
  }
  if (person.createdAt) {
    const t = Date.parse(person.createdAt);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

export function birthDateTimestamp(person?: Person): number | null {
  if (!person?.birthDate) return null;
  const t = Date.parse(person.birthDate);
  return Number.isFinite(t) ? t : null;
}

export function compareByBirthDateOnly(a: Person, b: Person): number {
  const ta = birthDateTimestamp(a);
  const tb = birthDateTimestamp(b);
  if (ta != null && tb != null) {
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  }
  if (ta != null) return -1;
  if (tb != null) return 1;
  return 0;
}

export function compareAgeByBirthDate(self: Person, other: Person): AgeRelation {
  const ts = birthDateTimestamp(self);
  const to = birthDateTimestamp(other);
  if (ts == null || to == null) return 'unknown';
  if (to < ts) return 'older';
  if (to > ts) return 'younger';
  return 'same';
}

export function compareByBirthAsc(a: Person, b: Person): number {
  const ta = birthTimestamp(a);
  const tb = birthTimestamp(b);
  if (ta != null && tb != null) {
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  }
  if (ta != null) return -1;
  if (tb != null) return 1;
  return a.id.localeCompare(b.id);
}

export function compareAgeToSelf(self: Person, other: Person): AgeRelation {
  const ts = birthTimestamp(self);
  const to = birthTimestamp(other);
  if (ts == null || to == null) return 'unknown';
  if (to < ts) return 'older';
  if (to > ts) return 'younger';
  return 'same';
}

export type SiblingCouple = { blood: PersonId; spouse?: PersonId };

/** 생년월일이 입력된 경우에만 형제·자녀 배치 순서를 바꾼다. */
export function shouldReorderByBirthDate(
  focal: Person,
  others: Person[],
): boolean {
  if (!birthDateTimestamp(focal)) return false;
  return others.some(p => birthDateTimestamp(p) != null);
}

/** 기본 템플릿: 왼쪽 큰형·형·누나, 가운데 나, 오른쪽 남동생 */
export function defaultSelfSiblingCoupleOrder(
  couples: SiblingCouple[],
  focalId: PersonId,
  templateBloodOrder: PersonId[],
): { couples: SiblingCouple[]; focalIndex: number } {
  const byBlood = new Map(couples.map(c => [c.blood, c]));
  const ordered: SiblingCouple[] = [];
  const seen = new Set<PersonId>();

  for (const bloodId of templateBloodOrder) {
    const couple = byBlood.get(bloodId);
    if (couple && !seen.has(bloodId)) {
      ordered.push(couple);
      seen.add(bloodId);
    }
  }
  for (const couple of couples) {
    if (!seen.has(couple.blood)) {
      ordered.push(couple);
      seen.add(couple.blood);
    }
  }

  const focalIndex = ordered.findIndex(c => c.blood === focalId);
  return { couples: ordered, focalIndex: focalIndex >= 0 ? focalIndex : 0 };
}

/** 뷰별 형제 줄 기본 순서 (생년월일 없을 때) */
export function defaultSiblingBloodOrder(
  view: ActiveView,
  slots: ReturnType<typeof slotIdsForView>,
): PersonId[] {
  if (view === 'self' || view === 'spouse') {
    return [
      slots.siblings[1].blood,
      slots.siblings[0].blood,
      slots.siblings[3].blood,
      slots.selfId,
      slots.siblings[4].blood,
    ];
  }
  return [slots.siblings[1].blood, slots.selfId, slots.siblings[3].blood];
}

/** 나를 중앙에 두고, 생년월일 기준 연장자는 왼쪽·후배는 오른쪽. */
export function orderSiblingCouplesAroundFocal(
  couples: SiblingCouple[],
  focalId: PersonId,
  people: Record<PersonId, Person>,
  templateBloodOrder?: PersonId[],
): { couples: SiblingCouple[]; focalIndex: number } {
  const present = couples.filter(c => people[c.blood]);
  const selfPerson = people[focalId];
  const others = present.filter(c => c.blood !== focalId).map(c => people[c.blood]!);

  if (!selfPerson || !shouldReorderByBirthDate(selfPerson, others)) {
    if (templateBloodOrder?.length) {
      return defaultSelfSiblingCoupleOrder(present, focalId, templateBloodOrder);
    }
    const focal = present.find(c => c.blood === focalId);
    const focalIndex = present.findIndex(c => c.blood === focalId);
    return { couples: present, focalIndex: focalIndex >= 0 ? focalIndex : 0 };
  }

  const focal = present.find(c => c.blood === focalId);
  const rest = present.filter(c => c.blood !== focalId);

  const older: SiblingCouple[] = [];
  const younger: SiblingCouple[] = [];
  const unknown: SiblingCouple[] = [];

  for (const couple of rest) {
    const blood = people[couple.blood];
    if (!blood) continue;
    const rel = compareAgeByBirthDate(selfPerson, blood);
    if (rel === 'older') older.push(couple);
    else if (rel === 'younger') younger.push(couple);
    else unknown.push(couple);
  }

  older.sort((a, b) => compareByBirthDateOnly(people[a.blood]!, people[b.blood]!));
  younger.sort((a, b) => compareByBirthDateOnly(people[a.blood]!, people[b.blood]!));
  unknown.sort((a, b) => a.blood.localeCompare(b.blood));

  const ordered = [...older, ...(focal ? [focal] : []), ...younger, ...unknown];
  const focalIndex = focal ? older.length : 0;
  return { couples: ordered, focalIndex };
}

const ORDINAL_LABELS = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째'];

export function ordinalLabel(index: number): string {
  return ORDINAL_LABELS[index] ?? `${index + 1}째`;
}

export function sortIdsByBirth(ids: PersonId[], people: Record<PersonId, Person>): PersonId[] {
  return [...ids]
    .filter(id => people[id])
    .sort((a, b) => compareByBirthAsc(people[a]!, people[b]!));
}

/** 자녀 배치: 생년월일 입력 시에만 나이순, 없으면 템플릿 순서 유지 */
export function sortChildIdsForLayout(
  ids: PersonId[],
  people: Record<PersonId, Person>,
): PersonId[] {
  const withBirth = ids.filter(id => birthDateTimestamp(people[id]));
  if (!withBirth.length) return ids;

  return [...ids].sort((a, b) => {
    const ta = birthDateTimestamp(people[a]);
    const tb = birthDateTimestamp(people[b]);
    if (ta != null && tb != null) {
      if (ta !== tb) return ta - tb;
      return a.localeCompare(b);
    }
    if (ta != null) return -1;
    if (tb != null) return 1;
    return ids.indexOf(a) - ids.indexOf(b);
  });
}

function collectChildIds(
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

export function buildChildOrdinalLabels(
  people: Record<PersonId, Person>,
  parentPairs: Array<{ bloodId: PersonId; spouseId?: PersonId }>,
): Record<PersonId, string> {
  const out: Record<PersonId, string> = {};
  for (const pair of parentPairs) {
    const kids = sortIdsByBirth(collectChildIds(people, pair.bloodId, pair.spouseId), people);
    kids.forEach((id, index) => {
      out[id] = ordinalLabel(index);
    });
  }
  return out;
}
