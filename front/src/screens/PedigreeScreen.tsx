import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AddPersonModal } from '../components/AddPersonModal';
import { PersonDetailModal } from '../components/PersonDetailModal';
import { EdgeLines } from '../components/EdgeLines';
import { PersonNodeCard } from '../components/PersonNodeCard';
import type { ParentType, Person, PersonId } from '../types/pedigree';
import { API_BASE_URL } from '../config/api';
import { nowIso } from '../utils/date';
import { buildKinshipLabels } from '../utils/kinship';
import { buildPedigreeLayout } from '../utils/pedigreeLayout';
import pako from 'pako';
import { Buffer } from 'buffer';

type PendingAdd =
  | { kind: 'parent'; childId: PersonId; parentType: ParentType }
  | { kind: 'sibling'; ofId: PersonId }
  | { kind: 'child'; parentId: PersonId }
  | { kind: 'spouse'; ofId: PersonId }
  | { kind: 'paternalPlus' }
  | { kind: 'maternalPlus' };

type AuthSession = {
  googleSub: string;
  accessToken?: string;
  email?: string;
  name?: string;
};

type Props = {
  auth?: AuthSession;
  onRequestLogout?: () => void | Promise<void>;
  onRequestSwitchAccount?: () => void | Promise<void>;
  onRequestLinkGoogle?: () => void | Promise<void>;
};

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
type PendingPatchPayload = {
  compressed: true;
  payload_b64: string;
};

function createSelfPerson(): Person {
  return {
    id: 'self',
    name: '나',
    createdAt: nowIso(),
  };
}

function createInitialPeople(): Record<PersonId, Person> {
  // 앱 최초 실행 기본 템플릿: 나 + 부모 + 자녀 1명
  const createdAt = nowIso();
  const fatherId: PersonId = 'father';
  const motherId: PersonId = 'mother';
  const childId: PersonId = 'child1';

  const self: Person = {
    ...createSelfPerson(),
    createdAt,
    gender: 'unknown',
    fatherId,
    motherId,
  };

  const father: Person = {
    id: fatherId,
    name: '아버지',
    createdAt,
    gender: 'male',
  };
  const mother: Person = {
    id: motherId,
    name: '어머니',
    createdAt,
    gender: 'female',
  };
  const child: Person = {
    id: childId,
    name: '자녀',
    createdAt,
    gender: 'unknown',
    fatherId: self.id,
  };

  return {
    [self.id]: self,
    [father.id]: father,
    [mother.id]: mother,
    [child.id]: child,
  };
}

function createSelfOnlyPeople(): Record<PersonId, Person> {
  const self = createSelfPerson();
  return { [self.id]: self };
}

function parseStoredPeople(raw: string | null): Record<PersonId, Person> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const out: Record<PersonId, Person> = {};
    for (const [id, person] of Object.entries(parsed as Record<string, Person>)) {
      if (!person || typeof person !== 'object') continue;
      if (!person.id || !person.name || !person.createdAt) continue;
      out[id] = person;
    }
    return out.self ? out : null;
  } catch {
    return null;
  }
}

function inferParentRole(
  next: Record<PersonId, Person>,
  parentId: PersonId,
  spouseId?: PersonId,
): ParentType {
  const parent = next[parentId];
  if (parent?.gender === 'male') return 'father';
  if (parent?.gender === 'female') return 'mother';
  const spouse = spouseId ? next[spouseId] : undefined;
  if (spouse?.gender === 'male') return 'mother';
  if (spouse?.gender === 'female') return 'father';

  const hasFatherLink = Object.values(next).some(p => p.fatherId === parentId);
  if (hasFatherLink) return 'father';
  const hasMotherLink = Object.values(next).some(p => p.motherId === parentId);
  if (hasMotherLink) return 'mother';

  return 'father';
}

export function PedigreeScreen({
  auth,
  onRequestLogout,
  onRequestSwitchAccount,
  onRequestLinkGoogle,
}: Props) {
  const [peopleById, setPeopleById] = useState<Record<PersonId, Person>>(createInitialPeople);
  const [isHydrated, setIsHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const remoteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedPeopleRef = useRef<Record<PersonId, Person>>({});
  const deletedIdsRef = useRef<Set<PersonId>>(new Set());
  const queueRef = useRef<PendingPatchPayload[]>([]);
  const isFlushingRef = useRef(false);
  const localStorageKey = useMemo(
    () => (auth?.googleSub ? `pedigree.people.${auth.googleSub}.v1` : 'pedigree.people.guest.v1'),
    [auth?.googleSub],
  );
  const queueStorageKey = useMemo(
    () => (auth?.googleSub ? `pedigree.queue.${auth.googleSub}.v1` : 'pedigree.queue.guest.v1'),
    [auth?.googleSub],
  );

  const self = peopleById.self;

  const [selectedId, setSelectedId] = useState<PersonId>('self');
  const selected = peopleById[selectedId];

  const [actionVisible, setActionVisible] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  const [editingId, setEditingId] = useState<PersonId | null>(null);
  const [detailId, setDetailId] = useState<PersonId | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);

  const selectedDetail = detailId ? peopleById[detailId] : undefined;

  const persistQueue = async () => {
    try {
      await AsyncStorage.setItem(queueStorageKey, JSON.stringify(queueRef.current));
    } catch {
      // 큐 저장 실패는 치명적이지 않으므로 무시
    }
  };

  const flushQueue = async () => {
    if (!auth?.googleSub || !auth.accessToken) return;
    if (isFlushingRef.current) return;
    if (queueRef.current.length === 0) {
      setSyncStatus('synced');
      return;
    }

    isFlushingRef.current = true;
    setSyncStatus('syncing');
    try {
      while (queueRef.current.length > 0) {
        const head = queueRef.current[0];
        const res = await fetch(`${API_BASE_URL}/v1/pedigree/${encodeURIComponent(auth.googleSub)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.accessToken}`,
          },
          body: JSON.stringify(head),
        });
        if (!res.ok) {
          setSyncStatus(res.status >= 500 ? 'offline' : 'error');
          break;
        }
        queueRef.current.shift();
        await persistQueue();
      }
      if (queueRef.current.length === 0) {
        setSyncStatus('synced');
      }
    } catch {
      setSyncStatus('offline');
    } finally {
      isFlushingRef.current = false;
    }
  };

  useEffect(() => {
    let mounted = true;
    const hydrate = async () => {
      let localPeople: Record<PersonId, Person> | null = null;
      try {
        const raw = await AsyncStorage.getItem(localStorageKey);
        localPeople = parseStoredPeople(raw);
        if (mounted && localPeople) {
          setPeopleById(localPeople);
          lastSyncedPeopleRef.current = localPeople;
        }

        const queueRaw = await AsyncStorage.getItem(queueStorageKey);
        if (queueRaw) {
          const parsedQueue = JSON.parse(queueRaw) as PendingPatchPayload[];
          if (Array.isArray(parsedQueue)) {
            queueRef.current = parsedQueue.filter(
              item => item?.compressed === true && typeof item.payload_b64 === 'string',
            );
          }
        } else {
          queueRef.current = [];
        }
      } catch {
        // 로컬 저장소 접근 실패 시 기본 템플릿으로 계속 진행
      }

      if (auth?.googleSub && auth.accessToken) {
        try {
          setSyncStatus('syncing');
          const res = await fetch(`${API_BASE_URL}/v1/pedigree/${encodeURIComponent(auth.googleSub)}`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${auth.accessToken}`,
            },
          });
          if (res.ok) {
            const data = (await res.json()) as { people_by_id?: Record<PersonId, Person> };
            const remotePeopleRaw = data.people_by_id ?? {};
            const remotePeople = parseStoredPeople(JSON.stringify(remotePeopleRaw));
            if (mounted && remotePeople) {
              setPeopleById(remotePeople);
              lastSyncedPeopleRef.current = remotePeople;
            } else if (mounted && !localPeople) {
              const initial = createInitialPeople();
              setPeopleById(initial);
              lastSyncedPeopleRef.current = initial;
            }
            if (mounted) setSyncStatus('synced');
          } else if (mounted) {
            setSyncStatus('error');
          }
        } catch {
          // 서버 조회 실패 시 로컬/기본 템플릿 사용
          if (mounted) setSyncStatus('offline');
        }
      }
      if (mounted) setIsHydrated(true);
    };
    hydrate();
    return () => {
      mounted = false;
    };
  }, [auth?.accessToken, auth?.googleSub, localStorageKey, queueStorageKey]);

  useEffect(() => {
    if (!isHydrated) return;
    AsyncStorage.setItem(localStorageKey, JSON.stringify(peopleById)).catch(() => {
      // 저장 실패는 UX를 막지 않고 무시
    });
  }, [isHydrated, localStorageKey, peopleById]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!auth?.googleSub || !auth.accessToken) return;

    if (remoteSaveTimer.current) {
      clearTimeout(remoteSaveTimer.current);
    }
    remoteSaveTimer.current = setTimeout(() => {
      setSyncStatus('syncing');
      const lastSynced = lastSyncedPeopleRef.current;
      const upserts: Record<PersonId, Person> = {};
      const deletes = Array.from(deletedIdsRef.current);

      for (const [id, person] of Object.entries(peopleById)) {
        const prev = lastSynced[id];
        if (!prev || JSON.stringify(prev) !== JSON.stringify(person)) {
          upserts[id] = person;
        }
      }

      for (const prevId of Object.keys(lastSynced)) {
        if (!peopleById[prevId] && !deletes.includes(prevId)) {
          deletes.push(prevId);
        }
      }

      if (Object.keys(upserts).length === 0 && deletes.length === 0) {
        setSyncStatus('synced');
        return;
      }

      const gz = pako.gzip(JSON.stringify({ upserts, deletes }));
      const payloadB64 = Buffer.from(gz).toString('base64');
      const nextPatch: PendingPatchPayload = {
        compressed: true,
        payload_b64: payloadB64,
      };

      queueRef.current.push(nextPatch);
      // 큐에 담은 시점을 기준으로 다음 diff를 계산하도록 기준점 갱신
      lastSyncedPeopleRef.current = peopleById;
      deletedIdsRef.current.clear();
      persistQueue().finally(() => {
        flushQueue();
      });
    }, 900);

    return () => {
      if (remoteSaveTimer.current) clearTimeout(remoteSaveTimer.current);
    };
  }, [auth?.accessToken, auth?.googleSub, isHydrated, peopleById]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!auth?.googleSub || !auth.accessToken) return;
    if (queueRef.current.length === 0) return;
    flushQueue();
  }, [auth?.accessToken, auth?.googleSub, isHydrated]);

  const deletePerson = (id: PersonId) => {
    if (id === 'self') return;
    setPeopleById(prev => {
      if (!prev[id]) return prev;
      const next: Record<PersonId, Person> = { ...prev };
      delete next[id];
      deletedIdsRef.current.add(id);
      // detach links from remaining people
      for (const p of Object.values(next)) {
        if (p.fatherId === id) p.fatherId = undefined;
        if (p.motherId === id) p.motherId = undefined;
        if (p.spouseId === id) p.spouseId = undefined;
      }
      return { ...next };
    });
  };

  const layout = useMemo(() => {
    return buildPedigreeLayout(peopleById, {
      selfId: 'self',
      // 위쪽(조상)으로 계속 추가해도 충분히 배치되도록 여유를 크게 잡음
      maxAncestorDepth: 6,
      maxDescendantDepth: 8,
      // 한 줄에 노드가 늘어나면 자동으로 카드/간격을 살짝 줄이는 튜닝 활성화
      autoTune: true,
      cardWidth: 176,
      cardHeight: 138,
      colGap: 44,
      rowGap: 230,
      padding: 40,
    });
  }, [peopleById]);

  const spousePairs = useMemo(() => {
    const pairs: Array<{ aId: PersonId; bId: PersonId }> = [];
    const seen = new Set<string>();
    for (const p of Object.values(peopleById)) {
      if (!p.spouseId) continue;
      const a = p.id < p.spouseId ? p.id : p.spouseId;
      const b = p.id < p.spouseId ? p.spouseId : p.id;
      const key = `${a}__${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ aId: a, bId: b });
    }
    return pairs;
  }, [peopleById]);

  const kinshipLabelById = useMemo(() => buildKinshipLabels(peopleById, 'self'), [peopleById]);

  const MIN_SCALE = 0.25;
  const MAX_SCALE = 2.8;
  const clampScaleOnJs = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

  const scale = useSharedValue(0.9);
  const savedScale = useSharedValue(0.9);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      savedScale.value = scale.value;
    })
    .onUpdate(e => {
      // worklet(UI thread)에서는 JS 함수 호출을 피하고 직접 계산한다.
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .minDistance(4)
    .averageTouches(true)
    .onBegin(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    })
    .onUpdate(e => {
      translateX.value = savedX.value + e.translationX;
      translateY.value = savedY.value + e.translationY;
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  const canvasStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const zoomBy = (factor: number) => {
    scale.value = withTiming(clampScaleOnJs(scale.value * factor), {
      duration: 140,
    });
  };

  const openActionsFor = (id: PersonId) => {
    setSelectedId(id);
    setActionVisible(true);
  };

  const openPaternalPlus = () => {
    // 친가측: 아버지의 형제 추가(=아버지의 sibling)
    if (!self.fatherId) {
      Alert.alert('먼저 아버지를 등록하세요', '친가 확장은 아버지(친가 기준)부터 필요합니다.');
      setSelectedId('self');
      setActionVisible(true);
      return;
    }
    setPendingAdd({ kind: 'paternalPlus' });
  };

  const openMaternalPlus = () => {
    // 외가측: 어머니의 형제 추가(=어머니의 sibling)
    if (!self.motherId) {
      Alert.alert('먼저 어머니를 등록하세요', '외가 확장은 어머니(외가 기준)부터 필요합니다.');
      setSelectedId('self');
      setActionVisible(true);
      return;
    }
    setPendingAdd({ kind: 'maternalPlus' });
  };

  const addTitle = useMemo(() => {
    if (!pendingAdd) return '인물 등록';
    switch (pendingAdd.kind) {
      case 'parent':
        return pendingAdd.parentType === 'father' ? '부 등록(아버지)' : '모 등록(어머니)';
      case 'sibling':
        return '형제/자매 추가';
      case 'child':
        return '자녀 추가';
      case 'spouse':
        return '배우자 추가';
      case 'paternalPlus':
        return '친가 인물 추가(아버지 형제)';
      case 'maternalPlus':
        return '외가 인물 추가(어머니 형제)';
      default:
        return '인물 등록';
    }
  }, [pendingAdd]);

  const onSubmitNewPerson = (person: Person) => {
    const action = pendingAdd;
    if (!action) return;
    setPeopleById(prev => {
      const next: Record<PersonId, Person> = {
        ...prev,
        [person.id]: person,
      };

      if (action.kind === 'parent') {
        const child = next[action.childId];
        if (child) {
          const normalizedParent: Person = {
            ...next[person.id],
            gender:
              next[person.id].gender && next[person.id].gender !== 'unknown'
                ? next[person.id].gender
                : action.parentType === 'father'
                  ? 'male'
                  : 'female',
          };
          next[person.id] = normalizedParent;
          const otherParentId =
            action.parentType === 'father' ? child.motherId : child.fatherId;
          next[action.childId] = {
            ...child,
            ...(action.parentType === 'father'
              ? { fatherId: person.id }
              : { motherId: person.id }),
          };
          if (otherParentId && next[otherParentId]) {
            next[person.id] = { ...next[person.id], spouseId: otherParentId };
            next[otherParentId] = { ...next[otherParentId], spouseId: person.id };
          }
        }
      } else if (action.kind === 'sibling') {
        const base = next[action.ofId];
        if (base?.fatherId || base?.motherId) {
          next[person.id] = {
            ...next[person.id],
            fatherId: base.fatherId,
            motherId: base.motherId,
          };
        } else {
          Alert.alert('형제 추가 불가', '부모 정보가 있어야 형제를 추가할 수 있어요.');
        }
      } else if (action.kind === 'child') {
        const parent = next[action.parentId];
        if (parent) {
          const spouseId = parent.spouseId;
          const inferredRole = inferParentRole(next, action.parentId, spouseId);
          next[person.id] = {
            ...next[person.id],
            ...(inferredRole === 'father'
              ? { fatherId: action.parentId }
              : { motherId: action.parentId }),
            ...(spouseId
              ? inferredRole === 'father'
                ? { motherId: spouseId }
                : { fatherId: spouseId }
              : {}),
          };
        }
      } else if (action.kind === 'spouse') {
        const base = next[action.ofId];
        if (base) {
          next[action.ofId] = { ...base, spouseId: person.id };
          next[person.id] = { ...next[person.id], spouseId: action.ofId };
        }
      } else if (action.kind === 'paternalPlus' && self.fatherId) {
        const base = next[self.fatherId];
        if (base?.fatherId || base?.motherId) {
          next[person.id] = {
            ...next[person.id],
            fatherId: base.fatherId,
            motherId: base.motherId,
          };
        }
      } else if (action.kind === 'maternalPlus' && self.motherId) {
        const base = next[self.motherId];
        if (base?.fatherId || base?.motherId) {
          next[person.id] = {
            ...next[person.id],
            fatherId: base.fatherId,
            motherId: base.motherId,
          };
        }
      }

      return next;
    });

    setPendingAdd(null);
  };

  const onSubmitEditPerson = (person: Person) => {
    setPeopleById(prev => {
      const existing = prev[person.id];
      if (!existing) return prev;
      return {
        ...prev,
        [person.id]: {
          ...existing,
          // id/createdAt은 유지하고 나머지 필드만 갱신
          name: person.name,
          gender: person.gender,
          phone: person.phone,
          birthDate: person.birthDate,
          photoUri: person.photoUri,
          note: person.note,
        },
      };
    });
    setEditingId(null);
  };

  const resetPedigree = async () => {
    Alert.alert('족보 초기화', '현재 계정의 족보를 초기화할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '초기화',
        style: 'destructive',
        onPress: async () => {
          // 초기화 시 "나"는 남기고 모든 연결/인물을 제거한다.
          const initial = createSelfOnlyPeople();
          setPeopleById(initial);
          setSelectedId('self');
          lastSyncedPeopleRef.current = initial;
          deletedIdsRef.current.clear();
          queueRef.current = [];
          setSyncStatus('idle');
          await AsyncStorage.removeItem(localStorageKey);
          await AsyncStorage.removeItem(queueStorageKey);

          if (auth?.googleSub && auth.accessToken) {
            try {
              await fetch(`${API_BASE_URL}/v1/pedigree/${encodeURIComponent(auth.googleSub)}`, {
                method: 'DELETE',
                headers: {
                  Authorization: `Bearer ${auth.accessToken}`,
                },
              });
            } catch {
              // 오프라인이면 로컬 초기화 후 다음 동기화 때 서버 반영
            }
          }
        },
      },
    ]);
  };

  const askSwitchAccount = async () => {
    if (!onRequestSwitchAccount) return;
    setSettingsVisible(false);
    try {
      await onRequestSwitchAccount();
    } catch {
      Alert.alert('계정 변경 실패', '계정 변경 중 오류가 발생했습니다.');
    }
  };

  const askLogout = async () => {
    if (!onRequestLogout) return;
    setSettingsVisible(false);
    try {
      await onRequestLogout();
    } catch {
      Alert.alert('로그아웃 실패', '로그아웃 중 오류가 발생했습니다.');
    }
  };

  const askLinkGoogle = async () => {
    if (!onRequestLinkGoogle) return;
    setSettingsVisible(false);
    try {
      await onRequestLinkGoogle();
    } catch {
      Alert.alert('연동 실패', '구글 계정 연동 중 오류가 발생했습니다.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={styles.headerTitle}>족보</Text>
          <Pressable style={styles.settingsBtn} onPress={() => setSettingsVisible(true)}>
            <Text style={styles.settingsBtnText}>설정</Text>
          </Pressable>
        </View>
        <Text style={styles.headerSub}>나(중앙) 기준 · 친가(왼쪽) / 외가(오른쪽) 대칭 정렬</Text>
        {auth?.googleSub ? (
          <Text style={styles.syncText}>
            {syncStatus === 'syncing'
              ? '동기화 중...'
              : syncStatus === 'synced'
                ? '서버 동기화 완료'
                : syncStatus === 'offline'
                  ? '오프라인 모드 (로컬 저장 중)'
                  : syncStatus === 'error'
                    ? '동기화 오류 (재시도 예정)'
                    : '동기화 대기'}
          </Text>
        ) : null}
      </View>

      <View style={styles.stage}>
        <GestureDetector gesture={composed}>
          <Animated.View
            style={[
              {
                width: layout.canvasWidth,
                height: layout.canvasHeight,
                backgroundColor: '#ffffff',
              },
              canvasStyle,
            ]}
          >
            {/* 연결선 */}
            <EdgeLines edges={layout.edges} nodeById={layout.nodeById} spousePairs={spousePairs} />

            {/* 노드 */}
            {layout.nodes.map(n => {
              const p = peopleById[n.id];
              if (!p) return null;
              return (
                <View key={n.id} style={[styles.node, { left: n.x, top: n.y }]}>
                  <PersonNodeCard
                    label={kinshipLabelById[p.id] ?? '친족'}
                    person={p}
                    onPress={() => openActionsFor(n.id)}
                    style={{ width: n.width, maxWidth: n.width, minWidth: n.width }}
                  />
                </View>
              );
            })}
          </Animated.View>
        </GestureDetector>

        {/* 캔버스와 별개로 고정된 + 버튼(헤더 아래에 항상 보이게) */}
        <Pressable style={styles.sidePlusLeft} onPress={openPaternalPlus}>
          <Text style={styles.sidePlusText}>+</Text>
        </Pressable>
        <Text style={styles.sidePlusHintLeft}>친가 인물 추가</Text>
        <Pressable style={styles.sidePlusRight} onPress={openMaternalPlus}>
          <Text style={styles.sidePlusText}>+</Text>
        </Pressable>
        <Text style={styles.sidePlusHintRight}>외가 인물 추가</Text>
      </View>

      {/* 줌 컨트롤 */}
      <View style={styles.zoomBox}>
        <Pressable style={styles.zoomBtn} onPress={() => zoomBy(1.2)}>
          <Text style={styles.zoomText}>+</Text>
        </Pressable>
        <Pressable style={styles.zoomBtn} onPress={() => zoomBy(1 / 1.2)}>
          <Text style={styles.zoomText}>-</Text>
        </Pressable>
      </View>

      {/* 액션 시트(추가/삭제) */}
      <Modal
        transparent
        visible={actionVisible}
        animationType="fade"
        onRequestClose={() => setActionVisible(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>
              {selected?.name ?? '인물'} · 작업
            </Text>

            <Pressable
              style={styles.sheetItem}
              onPress={() => {
                setActionVisible(false);
                setEditingId(selectedId);
              }}
            >
              <Text style={styles.sheetItemText}>정보/사진 수정</Text>
            </Pressable>

            <Pressable
              style={styles.sheetItem}
              onPress={() => {
                setActionVisible(false);
                setDetailId(selectedId);
              }}
            >
              <Text style={styles.sheetItemText}>정보 보기</Text>
            </Pressable>

            <Pressable
              style={styles.sheetItem}
              onPress={() => {
                setActionVisible(false);
                setPendingAdd({ kind: 'parent', childId: selectedId, parentType: 'father' });
              }}
            >
              <Text style={styles.sheetItemText}>부(아버지) 추가</Text>
            </Pressable>
            <Pressable
              style={styles.sheetItem}
              onPress={() => {
                setActionVisible(false);
                setPendingAdd({ kind: 'parent', childId: selectedId, parentType: 'mother' });
              }}
            >
              <Text style={styles.sheetItemText}>모(어머니) 추가</Text>
            </Pressable>

            <Pressable
              style={styles.sheetItem}
              onPress={() => {
                setActionVisible(false);
                setPendingAdd({ kind: 'sibling', ofId: selectedId });
              }}
            >
              <Text style={styles.sheetItemText}>형제/자매 추가(같은 줄)</Text>
            </Pressable>

            <Pressable
              style={styles.sheetItem}
              onPress={() => {
                if (selected?.spouseId) {
                  setActionVisible(false);
                  Alert.alert('이미 배우자가 있어요', '현재 인물에는 이미 배우자가 연결되어 있습니다.');
                  return;
                }
                setActionVisible(false);
                setPendingAdd({ kind: 'spouse', ofId: selectedId });
              }}
            >
              <Text style={styles.sheetItemText}>배우자 추가</Text>
            </Pressable>

            <Text style={styles.sheetHint}>배우자가 있으면 자동으로 부모 2명 연결</Text>
            <Pressable
              style={styles.sheetItem}
              onPress={() => {
                setActionVisible(false);
                setPendingAdd({ kind: 'child', parentId: selectedId });
              }}
            >
              <Text style={styles.sheetItemText}>자녀 추가</Text>
            </Pressable>

            {selectedId !== 'self' ? (
              <Pressable
                style={[styles.sheetItem, styles.danger]}
                onPress={() => {
                  setActionVisible(false);
                  Alert.alert('삭제', '이 인물을 삭제할까요? (연결은 자동 해제됩니다)', [
                    { text: '취소', style: 'cancel' },
                    { text: '삭제', style: 'destructive', onPress: () => deletePerson(selectedId) },
                  ]);
                }}
              >
                <Text style={[styles.sheetItemText, styles.dangerText]}>삭제</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <AddPersonModal
        visible={!!pendingAdd}
        title={addTitle}
        auth={auth}
        onClose={() => setPendingAdd(null)}
        onSubmit={onSubmitNewPerson}
      />

      <AddPersonModal
        visible={editingId != null}
        title="정보 수정"
        initialPerson={editingId ? peopleById[editingId] : undefined}
        auth={auth}
        onClose={() => setEditingId(null)}
        onSubmit={onSubmitEditPerson}
      />

      <PersonDetailModal
        visible={detailId != null}
        person={selectedDetail}
        onClose={() => setDetailId(null)}
        onEdit={() => {
          if (!detailId) return;
          setDetailId(null);
          setEditingId(detailId);
        }}
        onDelete={
          detailId && detailId !== 'self'
            ? () => {
                const idToDelete = detailId;
                setDetailId(null);
                Alert.alert('삭제', '이 인물을 삭제할까요? (연결은 자동 해제됩니다)', [
                  { text: '취소', style: 'cancel' },
                  { text: '삭제', style: 'destructive', onPress: () => deletePerson(idToDelete) },
                ]);
              }
            : undefined
        }
      />

      <Modal
        transparent
        visible={settingsVisible}
        animationType="fade"
        onRequestClose={() => setSettingsVisible(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setSettingsVisible(false)}>
          <Pressable style={styles.settingsSheet} onPress={() => {}}>
            <Text style={styles.settingsTitle}>설정</Text>
            {auth?.googleSub ? (
              <>
                <Text style={styles.settingsDesc}>
                  계정: {auth.name?.trim() ? auth.name : auth.email ?? auth.googleSub}
                </Text>
                <Text style={styles.settingsSubDesc}>{auth.email ?? auth.googleSub}</Text>
                <Pressable style={styles.settingsActionBtn} onPress={askSwitchAccount}>
                  <Text style={styles.settingsActionText}>구글 계정 변경</Text>
                </Pressable>
                <Pressable style={styles.settingsActionBtn} onPress={askLogout}>
                  <Text style={styles.settingsActionText}>로그아웃</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.settingsDesc}>게스트 모드</Text>
                <Text style={styles.settingsSubDesc}>
                  구글 연동을 시작하면 이 시점부터 서버 동기화를 시작합니다.
                </Text>
                <Pressable style={styles.settingsActionBtn} onPress={askLinkGoogle}>
                  <Text style={styles.settingsActionText}>구글 연동 시작</Text>
                </Pressable>
              </>
            )}
            <Pressable
              style={[styles.settingsActionBtn, styles.settingsDangerBtn]}
              onPress={resetPedigree}
            >
              <Text style={[styles.settingsActionText, styles.settingsDangerText]}>족보 초기화</Text>
            </Pressable>
            <Pressable style={styles.settingsCloseBtn} onPress={() => setSettingsVisible(false)}>
              <Text style={styles.settingsCloseBtnText}>닫기</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    zIndex: 10,
    elevation: 10,
  },
  headerTitle: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '900',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSub: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
  },
  settingsBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  settingsBtnText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '800',
  },
  syncText: {
    marginTop: 6,
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
  },
  stage: {
    flex: 1,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  node: {
    position: 'absolute',
  },
  sidePlusLeft: {
    position: 'absolute',
    left: 10,
    top: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  sidePlusRight: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  sidePlusHintLeft: {
    position: 'absolute',
    left: 8,
    top: 58,
    color: '#374151',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    zIndex: 20,
  },
  sidePlusHintRight: {
    position: 'absolute',
    right: 8,
    top: 58,
    color: '#374151',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    zIndex: 20,
  },
  sidePlusText: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '900',
    marginTop: -2,
  },
  zoomBox: {
    position: 'absolute',
    right: 16,
    bottom: 18,
    gap: 10,
  },
  zoomBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomText: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '900',
    marginTop: -2,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 16,
    gap: 10,
  },
  sheetTitle: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 6,
  },
  sheetItem: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sheetItemText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '800',
  },
  sheetHint: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  sheetRow: {
    flexDirection: 'row',
    gap: 10,
  },
  sheetHalf: {
    flex: 1,
  },
  danger: {
    borderColor: '#fecaca',
    backgroundColor: '#fff1f2',
  },
  dangerText: {
    color: '#b91c1c',
  },
  settingsSheet: {
    marginHorizontal: 16,
    marginTop: 120,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 16,
    gap: 8,
  },
  settingsTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 6,
  },
  settingsDesc: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
  settingsSubDesc: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  settingsActionBtn: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  settingsActionText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '800',
  },
  settingsDangerBtn: {
    borderColor: '#fecaca',
    backgroundColor: '#fff1f2',
  },
  settingsDangerText: {
    color: '#b91c1c',
  },
  settingsCloseBtn: {
    marginTop: 10,
    alignSelf: 'flex-end',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  settingsCloseBtnText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '800',
  },
});
