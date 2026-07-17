import { buildSiblingKinshipLabels, siblingBloodLabel, siblingSpouseLabel } from './siblingKinship';
import type { Person } from '../types/pedigree';

function person(
  id: string,
  gender: Person['gender'],
  birthDate: string,
  spouseId?: string,
): Person {
  return {
    id,
    name: id,
    gender,
    birthDate,
    createdAt: '2020-01-01T00:00:00.000Z',
    spouseId,
  };
}

describe('siblingKinship female self', () => {
  const self = person('me', 'female', '1995-06-01');
  const olderBrother = person('ob', 'male', '1990-01-01', 'ob_sp');
  const olderSister = person('os', 'female', '1992-03-01', 'os_sp');
  const youngerBrother = person('yb', 'male', '1998-08-01', 'yb_sp');
  const youngerSister = person('ys', 'female', '2000-12-01', 'ys_sp');

  it('uses 오빠/언니/남동생/여동생 when self is female', () => {
    expect(siblingBloodLabel(self, olderBrother)).toBe('오빠');
    expect(siblingBloodLabel(self, olderSister)).toBe('언니');
    expect(siblingBloodLabel(self, youngerBrother)).toBe('남동생');
    expect(siblingBloodLabel(self, youngerSister)).toBe('여동생');
  });

  it('uses female-specific in-law labels', () => {
    expect(siblingSpouseLabel(self, olderBrother)).toBe('형수');
    expect(siblingSpouseLabel(self, olderSister)).toBe('형부');
    expect(siblingSpouseLabel(self, youngerBrother)).toBe('제수');
    expect(siblingSpouseLabel(self, youngerSister)).toBe('매제');
  });
});

describe('siblingKinship male self', () => {
  const self = person('me', 'male', '1995-06-01');
  const olderBrother = person('ob', 'male', '1990-01-01');
  const olderSister = person('os', 'female', '1992-03-01');

  it('uses 형/누나 when self is male', () => {
    expect(siblingBloodLabel(self, olderBrother)).toBe('형');
    expect(siblingBloodLabel(self, olderSister)).toBe('누나');
  });

  it('uses 매형 for older sister spouse when self is male', () => {
    expect(siblingSpouseLabel(self, olderSister)).toBe('매형');
  });

  it('uses 매제 for younger sister spouse when self is male', () => {
    const youngerSister = person('ys', 'female', '2000-12-01');
    expect(siblingSpouseLabel(self, youngerSister)).toBe('매제');
  });
});

describe('buildSiblingKinshipLabels', () => {
  it('overrides graph labels for sibling row with female self labels', () => {
    const selfId = 'me_sib2';
    const people = {
      [selfId]: person(selfId, 'female', '1995-06-01'),
      me_sib0: person('me_sib0', 'male', '1990-01-01', 'me_sib0_sp'),
      me_sib0_sp: person('me_sib0_sp', 'female', '1991-01-01', 'me_sib0'),
      me_sib1: person('me_sib1', 'female', '1992-03-01', 'me_sib1_sp'),
      me_sib1_sp: person('me_sib1_sp', 'male', '1993-03-01', 'me_sib1'),
    };
    const labels = buildSiblingKinshipLabels(people, selfId, ['me_sib0', 'me_sib1', selfId]);
    expect(labels.me_sib0).toBe('오빠');
    expect(labels.me_sib0_sp).toBe('형수');
    expect(labels.me_sib1).toBe('언니');
    expect(labels.me_sib1_sp).toBe('형부');
  });
});
