import type { Person, PersonId } from './pedigree';

/** 나 시점 + 친가 · 외가 · 배우자 집안 */
export type LineageView = 'paternal' | 'maternal' | 'spouse';
export type ActiveView = 'self' | LineageView;

export type PedigreeStore = {
  version: 2;
  activeView: ActiveView;
  views: Record<ActiveView, Record<PersonId, Person>>;
};

export const ACTIVE_VIEW_LABEL: Record<ActiveView, string> = {
  self: '나',
  paternal: '친가',
  maternal: '외가',
  spouse: '배우자 집안',
};

export const ACTIVE_VIEW_BG: Record<ActiveView, string> = {
  self: '#f5f0e6',
  paternal: '#c8e3fc',
  maternal: '#f8c4d8',
  spouse: '#c8e6c0',
};

/** @deprecated */
export const LINEAGE_VIEW_LABEL = ACTIVE_VIEW_LABEL;
/** @deprecated */
export const LINEAGE_VIEW_BG = ACTIVE_VIEW_BG;
