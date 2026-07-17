import type { Person, PersonId } from '../types/pedigree';
import { compareAgeToSelf, type AgeRelation } from './birthOrder';

export function siblingBloodLabel(self: Person, sibling: Person): string {
  const rel = compareAgeToSelf(self, sibling);
  if (rel === 'same' || rel === 'unknown') return '형제';

  if (self.gender === 'female') {
    if (rel === 'older') {
      if (sibling.gender === 'male') return '오빠';
      if (sibling.gender === 'female') return '언니';
      return '형제';
    }
    if (sibling.gender === 'male') return '남동생';
    if (sibling.gender === 'female') return '여동생';
    return '형제';
  }

  if (self.gender === 'male') {
    if (rel === 'older') {
      if (sibling.gender === 'male') return '형';
      if (sibling.gender === 'female') return '누나';
      return '형제';
    }
    if (sibling.gender === 'male') return '남동생';
    if (sibling.gender === 'female') return '여동생';
    return '형제';
  }

  if (rel === 'older') {
    if (sibling.gender === 'male') return '형';
    if (sibling.gender === 'female') return '누나';
    return '형제';
  }
  if (sibling.gender === 'male') return '남동생';
  if (sibling.gender === 'female') return '여동생';
  return '형제';
}

function spouseLabelBySiblingRelation(
  rel: AgeRelation,
  siblingGender: Person['gender'] | undefined,
  selfGender: Person['gender'] | undefined,
): string {
  if (rel === 'older') {
    if (siblingGender === 'male') return '형수';
    if (siblingGender === 'female') {
      return selfGender === 'female' ? '형부' : '매형';
    }
  }
  if (rel === 'younger') {
    if (siblingGender === 'male') return '제수';
    if (siblingGender === 'female') return '매제';
  }
  return '인척';
}

export function siblingSpouseLabel(self: Person, siblingBlood: Person): string {
  const rel = compareAgeToSelf(self, siblingBlood);
  if (rel === 'same' || rel === 'unknown') return '인척';
  return spouseLabelBySiblingRelation(rel, siblingBlood.gender, self.gender);
}

export function buildSiblingKinshipLabels(
  peopleById: Record<PersonId, Person>,
  selfId: PersonId,
  siblingBloodIds: PersonId[],
): Record<PersonId, string> {
  const out: Record<PersonId, string> = {};
  const self = peopleById[selfId];
  if (!self) return out;

  for (const bloodId of siblingBloodIds) {
    const blood = peopleById[bloodId];
    if (!blood) continue;
    if (bloodId === selfId) {
      out[bloodId] = '본인';
      continue;
    }
    out[bloodId] = siblingBloodLabel(self, blood);
    if (blood.spouseId && peopleById[blood.spouseId]) {
      out[blood.spouseId] = siblingSpouseLabel(self, blood);
    }
  }
  return out;
}
