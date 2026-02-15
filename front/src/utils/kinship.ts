import type { Person, PersonId } from '../types/pedigree';

type Gender = Person['gender'];
type Token = 'F' | 'M' | 'S' | 'D' | 'C' | 'H' | 'W' | 'P';
type Neighbor = { to: PersonId; token: Token };

function childToken(gender?: Gender): Token {
  if (gender === 'male') return 'S';
  if (gender === 'female') return 'D';
  return 'C';
}

function spouseToken(gender?: Gender): Token {
  if (gender === 'male') return 'H';
  if (gender === 'female') return 'W';
  return 'P';
}

function addEdge(adj: Record<PersonId, Neighbor[]>, from: PersonId, to: PersonId, token: Token) {
  const list = adj[from] ?? [];
  if (!list.some(v => v.to === to && v.token === token)) {
    list.push({ to, token });
    adj[from] = list;
  }
}

function buildAdjacency(people: Record<PersonId, Person>): Record<PersonId, Neighbor[]> {
  const adj: Record<PersonId, Neighbor[]> = {};
  for (const p of Object.values(people)) {
    if (p.fatherId && people[p.fatherId]) {
      addEdge(adj, p.id, p.fatherId, 'F');
      addEdge(adj, p.fatherId, p.id, childToken(p.gender));
    }
    if (p.motherId && people[p.motherId]) {
      addEdge(adj, p.id, p.motherId, 'M');
      addEdge(adj, p.motherId, p.id, childToken(p.gender));
    }
    if (p.spouseId && people[p.spouseId]) {
      addEdge(adj, p.id, p.spouseId, spouseToken(people[p.spouseId].gender));
      addEdge(adj, p.spouseId, p.id, spouseToken(p.gender));
    }
  }
  return adj;
}

function shortestCodes(
  adj: Record<PersonId, Neighbor[]>,
  start: PersonId,
  target: PersonId,
  maxDepth = 8,
): string[] {
  if (start === target) return [''];
  const queue: Array<{ id: PersonId; code: string }> = [{ id: start, code: '' }];
  const seen = new Map<PersonId, number>([[start, 0]]);
  const found: string[] = [];
  let minDepth: number | null = null;

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const depth = cur.code.length;
    if (minDepth != null && depth > minDepth) continue;
    if (depth > maxDepth) continue;
    for (const n of adj[cur.id] ?? []) {
      const nextCode = `${cur.code}${n.token}`;
      const nextDepth = nextCode.length;
      if (n.to === target) {
        minDepth = minDepth == null ? nextDepth : Math.min(minDepth, nextDepth);
        found.push(nextCode);
        continue;
      }
      const prev = seen.get(n.to);
      if (prev != null && prev < nextDepth) continue;
      seen.set(n.to, nextDepth);
      queue.push({ id: n.to, code: nextCode });
    }
  }

  if (found.length === 0) return [];
  const shortest = Math.min(...found.map(c => c.length));
  return found.filter(c => c.length === shortest);
}

function timestampOf(p?: Person): number | undefined {
  if (!p) return undefined;
  const birth = p.birthDate ? Date.parse(p.birthDate) : NaN;
  if (Number.isFinite(birth)) return birth;
  const created = p.createdAt ? Date.parse(p.createdAt) : NaN;
  return Number.isFinite(created) ? created : undefined;
}

function isOlderThan(a?: Person, b?: Person): boolean | undefined {
  const ta = timestampOf(a);
  const tb = timestampOf(b);
  if (ta == null || tb == null) return undefined;
  return ta < tb;
}

function siblingLabel(self: Person, target: Person): string {
  void self;
  void target;
  return '형제';
}

function labelFromCode(code: string, self: Person, target: Person): string {
  if (code === '') return '나';
  if (/^[HWP]$/.test(code)) return '배우자';

  if (code === 'F') return '부';
  if (code === 'M') return '모';
  if (/^F[HWP]$/.test(code)) return '모';
  if (/^M[HWP]$/.test(code)) return '부';
  if (code === 'FF') return '조부';
  if (code === 'FM') return '조모';
  if (code === 'MF') return '외조부';
  if (code === 'MM') return '외조모';
  if (/^FF[HWP]$/.test(code)) return '조모';
  if (/^FM[HWP]$/.test(code)) return '조부';
  if (/^MF[HWP]$/.test(code)) return '외조모';
  if (/^MM[HWP]$/.test(code)) return '외조부';
  if (/^(FF|FM|MF|MM)(F|M)$/.test(code)) {
    return target.gender === 'female' ? '증조모' : '증조부';
  }

  if (/^[SDC]$/.test(code)) return '자녀';
  if (/^[SDC]{2}$/.test(code)) return target.gender === 'female' ? '손녀' : '손자';
  if (/^[SDC]{3}$/.test(code)) return '증손';

  if (/^(F|M)[SDC]$/.test(code)) return siblingLabel(self, target);
  if (/^(F|M)[SDC][HWP]$/.test(code)) {
    if (target.gender === 'male') return '매형/형부';
    if (target.gender === 'female') return '올케/제수';
    return '형제자매 배우자';
  }
  if (/^(F|M)[SDC][SDC]$/.test(code)) return '조카';

  if (/^F(F|M)[SDC]$/.test(code)) {
    if (target.gender === 'female') return '고모';
    return '백부/숙부';
  }
  if (/^M(F|M)[SDC]$/.test(code)) {
    if (target.gender === 'female') return '이모';
    return '외삼촌';
  }
  if (/^F(F|M)[SDC][HWP]$/.test(code)) {
    if (target.gender === 'male') return '고모부';
    if (target.gender === 'female') return '숙모';
    return '고모부/숙모';
  }
  if (/^M(F|M)[SDC][HWP]$/.test(code)) {
    if (target.gender === 'male') return '이모부';
    if (target.gender === 'female') return '외숙모';
    return '이모부/외숙모';
  }
  if (/^[FM]{2}[SDC]{2}$/.test(code)) return '사촌';
  if (/^[FM]{2}[SDC]{3}$/.test(code)) return '사촌의 자녀';

  if (/^[HWP][FM]$/.test(code)) {
    if (self.gender === 'male') return target.gender === 'female' ? '장모' : '장인';
    if (self.gender === 'female') return target.gender === 'female' ? '시모' : '시부';
    return '배우자 부모';
  }
  if (/^[HWP][FM][SDC]$/.test(code)) {
    if (self.gender === 'male') return target.gender === 'female' ? '처제/처형' : '처남';
    if (self.gender === 'female') return target.gender === 'female' ? '시누이' : '시동생';
    return '배우자 형제자매';
  }
  if (/^[HWP][FM][SDC][HWP]$/.test(code)) return '동서';
  if (/^[HWP][FM][SDC]{2}$/.test(code)) return '배우자 조카';

  if (/^[SDC][HWP]$/.test(code)) return target.gender === 'female' ? '며느리' : '사위';
  if (/^[SDC][HWP][FM]$/.test(code)) return '사돈';
  if (/^[SDC][HWP][FM][FM]$/.test(code)) return '사돈의 부모';

  if (/^[FM]{2}[SDC]{2}[HWP]$/.test(code)) return '사촌 배우자';
  if (/[HWP]/.test(code)) return '인척';

  const bloodDepth = code.replace(/[HWP]/g, '').length;
  if (bloodDepth >= 2) return `${bloodDepth}촌 친척`;
  return '친족';
}

const PRIORITY: Record<string, number> = {
  나: 100,
  부: 95,
  모: 95,
  배우자: 94,
  조부: 93,
  조모: 93,
  외조부: 92,
  외조모: 92,
  증조부: 91,
  증조모: 91,
  백부: 90,
  숙부: 90,
  고모: 90,
  외삼촌: 90,
  이모: 90,
  장인: 89,
  장모: 89,
  시부: 89,
  시모: 89,
  처남: 88,
  처제: 88,
  시누이: 88,
  시동생: 88,
  형: 87,
  오빠: 87,
  누나: 87,
  언니: 87,
  남동생: 86,
  여동생: 86,
  조카: 85,
  사촌: 84,
  자녀: 83,
  손자: 82,
  손녀: 82,
  며느리: 81,
  사위: 81,
  사돈: 80,
  동서: 79,
  인척: 10,
  친족: 1,
};

function bestLabel(codes: string[], self: Person, target: Person): string {
  if (codes.length === 0) return '친족';
  let selected = '친족';
  let score = PRIORITY[selected] ?? 0;
  for (const code of codes) {
    const label = labelFromCode(code, self, target);
    const nextScore = PRIORITY[label] ?? 0;
    if (nextScore > score) {
      selected = label;
      score = nextScore;
    }
  }
  return selected;
}

export function buildKinshipLabels(
  peopleById: Record<PersonId, Person>,
  selfId: PersonId,
): Record<PersonId, string> {
  const out: Record<PersonId, string> = {};
  const self = peopleById[selfId];
  if (!self) return out;
  const adj = buildAdjacency(peopleById);
  for (const id of Object.keys(peopleById)) {
    const target = peopleById[id];
    const codes = shortestCodes(adj, selfId, id);
    out[id] = bestLabel(codes, self, target);
  }
  return out;
}
