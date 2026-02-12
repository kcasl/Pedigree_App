export type PersonId = string;

export type ParentType = 'father' | 'mother';

export interface Person {
  id: PersonId;
  name: string;
  phone?: string;
  birthDate?: string; // YYYY-MM-DD
  createdAt: string; // ISO string
  photoUri?: string;
  note?: string; // 비고(기타 정보), 100자 제한(UI에서 제어)

  fatherId?: PersonId;
  motherId?: PersonId;
  spouseId?: PersonId;
}

