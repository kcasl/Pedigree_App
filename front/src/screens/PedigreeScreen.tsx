import React, { useEffect, useMemo, useState } from 'react';
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
import { nowIso } from '../utils/date';
import { buildPedigreeLayout } from '../utils/pedigreeLayout';

type PendingAdd =
  | { kind: 'parent'; childId: PersonId; parentType: ParentType }
  | { kind: 'sibling'; ofId: PersonId }
  | { kind: 'child'; parentId: PersonId; parentRole: ParentType }
  | { kind: 'spouse'; ofId: PersonId }
  | { kind: 'paternalPlus' }
  | { kind: 'maternalPlus' };

const PEDIGREE_STORAGE_KEY = 'pedigree.people.v1';

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
    fatherId,
    motherId,
  };

  const father: Person = {
    id: fatherId,
    name: '아버지',
    createdAt,
  };
  const mother: Person = {
    id: motherId,
    name: '어머니',
    createdAt,
  };
  const child: Person = {
    id: childId,
    name: '자녀',
    createdAt,
    fatherId: self.id,
  };

  return {
    [self.id]: self,
    [father.id]: father,
    [mother.id]: mother,
    [child.id]: child,
  };
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

export function PedigreeScreen() {
  const [peopleById, setPeopleById] = useState<Record<PersonId, Person>>(createInitialPeople);
  const [isHydrated, setIsHydrated] = useState(false);

  const self = peopleById.self;

  const [selectedId, setSelectedId] = useState<PersonId>('self');
  const selected = peopleById[selectedId];

  const [actionVisible, setActionVisible] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  const [editingId, setEditingId] = useState<PersonId | null>(null);
  const [detailId, setDetailId] = useState<PersonId | null>(null);

  const selectedDetail = detailId ? peopleById[detailId] : undefined;

  useEffect(() => {
    let mounted = true;
    const hydrate = async () => {
      try {
        const raw = await AsyncStorage.getItem(PEDIGREE_STORAGE_KEY);
        const restored = parseStoredPeople(raw);
        if (mounted && restored) {
          setPeopleById(restored);
        }
      } catch {
        // 저장소 접근 실패 시 기본 템플릿으로 계속 진행
      } finally {
        if (mounted) setIsHydrated(true);
      }
    };
    hydrate();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    AsyncStorage.setItem(PEDIGREE_STORAGE_KEY, JSON.stringify(peopleById)).catch(() => {
      // 저장 실패는 UX를 막지 않고 무시
    });
  }, [isHydrated, peopleById]);

  const setParent = (childId: PersonId, parentType: ParentType, parentId: PersonId) => {
    setPeopleById(prev => {
      const child = prev[childId];
      if (!child) return prev;
      return {
        ...prev,
        [childId]: {
          ...child,
          ...(parentType === 'father' ? { fatherId: parentId } : { motherId: parentId }),
        },
      };
    });
  };

  const addSibling = (ofId: PersonId, newPersonId: PersonId) => {
    setPeopleById(prev => {
      const base = prev[ofId];
      if (!base) return prev;
      if (!base.fatherId && !base.motherId) return prev;
      return {
        ...prev,
        [newPersonId]: {
          ...prev[newPersonId],
          fatherId: base.fatherId,
          motherId: base.motherId,
        },
      };
    });
  };

  const addChild = (parentId: PersonId, parentRole: ParentType, newPersonId: PersonId) => {
    setPeopleById(prev => {
      const parent = prev[parentId];
      if (!parent) return prev;
      return {
        ...prev,
        [newPersonId]: {
          ...prev[newPersonId],
          ...(parentRole === 'father' ? { fatherId: parentId } : { motherId: parentId }),
        },
      };
    });
  };

  const setSpousePair = (aId: PersonId, bId: PersonId) => {
    setPeopleById(prev => {
      const a = prev[aId];
      const b = prev[bId];
      if (!a || !b) return prev;
      return {
        ...prev,
        [aId]: {
          ...a,
          spouseId: bId,
        },
        [bId]: {
          ...b,
          spouseId: aId,
        },
      };
    });
  };

  const deletePerson = (id: PersonId) => {
    if (id === 'self') return;
    setPeopleById(prev => {
      if (!prev[id]) return prev;
      const next: Record<PersonId, Person> = { ...prev };
      delete next[id];
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
      maxDescendantDepth: 3,
      // 한 줄에 노드가 늘어나면 자동으로 카드/간격을 살짝 줄이는 튜닝 활성화
      autoTune: true,
      cardWidth: 176,
      cardHeight: 122,
      colGap: 44,
      rowGap: 230,
      padding: 40,
    });
  }, [peopleById]);

  const MIN_SCALE = 0.5;
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
        return pendingAdd.parentRole === 'father' ? '자녀 추가(부 기준)' : '자녀 추가(모 기준)';
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

    setPeopleById(prev => ({
      ...prev,
      [person.id]: person,
    }));

    if (action.kind === 'parent') {
      setParent(action.childId, action.parentType, person.id);
    } else if (action.kind === 'sibling') {
      // requires parents
      const base = peopleById[action.ofId];
      if (!base?.fatherId && !base?.motherId) {
        Alert.alert('형제 추가 불가', '부모 정보가 있어야 형제를 추가할 수 있어요.');
      } else {
        addSibling(action.ofId, person.id);
      }
    } else if (action.kind === 'child') {
      addChild(action.parentId, action.parentRole, person.id);
    } else if (action.kind === 'spouse') {
      setSpousePair(action.ofId, person.id);
    } else if (action.kind === 'paternalPlus') {
      addSibling(self.fatherId!, person.id);
    } else if (action.kind === 'maternalPlus') {
      addSibling(self.motherId!, person.id);
    }

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
          phone: person.phone,
          birthDate: person.birthDate,
          photoUri: person.photoUri,
          note: person.note,
        },
      };
    });
    setEditingId(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>족보</Text>
        <Text style={styles.headerSub}>
          나(중앙) 기준 · 친가(왼쪽) / 외가(오른쪽) 대칭 정렬
        </Text>
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
            <EdgeLines edges={layout.edges} nodeById={layout.nodeById} />

            {/* 노드 */}
            {layout.nodes.map(n => {
              const p = peopleById[n.id];
              if (!p) return null;
              return (
                <View key={n.id} style={[styles.node, { left: n.x, top: n.y }]}>
                  <PersonNodeCard
                    label={p.id === 'self' ? '나' : ' '}
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

            <Text style={styles.sheetHint}>자녀 추가 시, 이 인물이 자녀의 “부/모”인지 선택</Text>
            <View style={styles.sheetRow}>
              <Pressable
                style={[styles.sheetItem, styles.sheetHalf]}
                onPress={() => {
                  setActionVisible(false);
                  setPendingAdd({ kind: 'child', parentId: selectedId, parentRole: 'father' });
                }}
              >
                <Text style={styles.sheetItemText}>자녀(부 기준)</Text>
              </Pressable>
              <Pressable
                style={[styles.sheetItem, styles.sheetHalf]}
                onPress={() => {
                  setActionVisible(false);
                  setPendingAdd({ kind: 'child', parentId: selectedId, parentRole: 'mother' });
                }}
              >
                <Text style={styles.sheetItemText}>자녀(모 기준)</Text>
              </Pressable>
            </View>

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
        onClose={() => setPendingAdd(null)}
        onSubmit={onSubmitNewPerson}
      />

      <AddPersonModal
        visible={editingId != null}
        title="정보 수정"
        initialPerson={editingId ? peopleById[editingId] : undefined}
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
  headerSub: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
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
});
