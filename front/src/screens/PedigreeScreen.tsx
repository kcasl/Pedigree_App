import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AddPersonModal } from '../components/AddPersonModal';
import { ContactDirectoryModal } from '../components/ContactDirectoryModal';
import { PersonDetailModal } from '../components/PersonDetailModal';
import { EdgeLines } from '../components/EdgeLines';
import { DraggablePersonNode } from '../components/DraggablePersonNode';
import type { ParentType, Person, PersonId } from '../types/pedigree';
import { API_BASE_URL } from '../config/api';
import { ENABLE_SERVER_SYNC } from '../config/features';
import type { ActiveView, PedigreeStore } from '../types/lineage';
import { ACTIVE_VIEW_BG, ACTIVE_VIEW_LABEL } from '../types/lineage';
import {
  clearPedigreePeople,
  loadPedigreeStore,
  parseStoredPeople,
  savePedigreeStore,
} from '../storage/pedigreeStorage';
import { nowIso } from '../utils/date';
import { buildViewKinshipLabels, buildViewOrdinalLabels, canAddSiblingFromNode, nextEmptySiblingSlotId, resolveSiblingAdd, syncAllViews, syncStoreAfterEdit } from '../utils/viewSync';
import { normalizePhoneDigits } from '../utils/phone';
import {
  createDefaultStore,
  migrateLegacyToStore,
  reconcileStore,
  SELF_SLOT_INDEX,
  slotIdsForView,
} from '../utils/standardTemplate';
import { buildStandardPedigreeLayout, STANDARD_LAYOUT_DEFAULTS } from '../utils/standardLayout';
import type { PositionedNode } from '../utils/pedigreeLayout';
import { ui } from '../theme/ui';
import pako from 'pako';
import { Buffer } from 'buffer';

type PendingAdd =
  | { kind: 'parent'; childId: PersonId; parentType: ParentType }
  | { kind: 'sibling'; ofId: PersonId }
  | { kind: 'child'; parentId: PersonId }
  | { kind: 'spouse'; ofId: PersonId };

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

function createInitialStore(): PedigreeStore {
  return createDefaultStore(nowIso());
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

function useScreenInsets() {
  const insets = useSafeAreaInsets();
  const statusBarHeight = StatusBar.currentHeight ?? 24;
  const topInset =
    Platform.OS === 'android'
      ? Math.min(insets.top, statusBarHeight)
      : insets.top;
  return { topInset, bottomInset: insets.bottom };
}

export function PedigreeScreen({
  auth,
  onRequestLogout,
  onRequestSwitchAccount,
  onRequestLinkGoogle,
}: Props) {
  const { topInset, bottomInset } = useScreenInsets();
  const [store, setStore] = useState<PedigreeStore>(createInitialStore);
  const activeView = store.activeView;
  const peopleById = store.views[activeView];
  const slots = useMemo(() => slotIdsForView(activeView), [activeView]);
  const self = peopleById[slots.selfId];

  const updateActiveViewPeople = (
    updater: (prev: Record<PersonId, Person>) => Record<PersonId, Person>,
  ) => {
    setStore(prev =>
      syncStoreAfterEdit(prev, prev.activeView, updater(prev.views[prev.activeView])),
    );
  };

  const switchLineageView = (view: ActiveView) => {
    const nextSlots = slotIdsForView(view);
    setStore(prev => syncAllViews({ ...prev, activeView: view }));
    setSelectedId(nextSlots.selfId);
    setActionVisible(false);
  };

  const switchToSelfView = () => switchLineageView('self');

  const [selectedId, setSelectedId] = useState<PersonId>('me_sib2');
  const selected = peopleById[selectedId];
  const [isHydrated, setIsHydrated] = useState(false);
  const [localSaveStatus, setLocalSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const remoteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedPeopleRef = useRef<Record<PersonId, Person>>({});
  const deletedIdsRef = useRef<Set<PersonId>>(new Set());
  const queueRef = useRef<PendingPatchPayload[]>([]);
  const isFlushingRef = useRef(false);
  const legacyQueueStorageKey = useMemo(
    () => (auth?.googleSub ? `pedigree.queue.${auth.googleSub}.v1` : 'pedigree.queue.guest.v1'),
    [auth?.googleSub],
  );

  const [actionVisible, setActionVisible] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  const [editingId, setEditingId] = useState<PersonId | null>(null);
  const [detailId, setDetailId] = useState<PersonId | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [contactsVisible, setContactsVisible] = useState(false);
  const [usageVisible, setUsageVisible] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const selectedDetail = detailId ? peopleById[detailId] : undefined;

  const persistQueue = async () => {
    if (!ENABLE_SERVER_SYNC) return;
    try {
      await AsyncStorage.setItem(legacyQueueStorageKey, JSON.stringify(queueRef.current));
    } catch {
      // 큐 저장 실패는 치명적이지 않으므로 무시
    }
  };

  const flushQueue = async () => {
    if (!ENABLE_SERVER_SYNC) return;
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
      try {
        const localStore = await loadPedigreeStore();
        if (mounted && localStore) {
          const synced = syncAllViews(localStore);
          setStore(synced);
          lastSyncedPeopleRef.current = synced.views[synced.activeView];
          setSelectedId(slotIdsForView(synced.activeView).selfId);
        } else if (mounted) {
          const initial = syncAllViews(createInitialStore());
          setStore(initial);
          lastSyncedPeopleRef.current = initial.views[initial.activeView];
        }

        if (ENABLE_SERVER_SYNC) {
          const queueRaw = await AsyncStorage.getItem(legacyQueueStorageKey);
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
        }
      } catch {
        if (mounted) {
          const initial = syncAllViews(createInitialStore());
          setStore(initial);
          lastSyncedPeopleRef.current = initial.views[initial.activeView];
        }
      }

      if (ENABLE_SERVER_SYNC && auth?.googleSub && auth.accessToken) {
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
            const localStore = await loadPedigreeStore();
            if (mounted && remotePeople) {
              const migrated = syncAllViews(reconcileStore(migrateLegacyToStore(remotePeople)));
              setStore(migrated);
              lastSyncedPeopleRef.current = migrated.views[migrated.activeView];
              await savePedigreeStore(migrated);
            } else if (mounted && !localStore) {
              const initial = syncAllViews(createInitialStore());
              setStore(initial);
              lastSyncedPeopleRef.current = initial.views[initial.activeView];
              lastSyncedPeopleRef.current = initial.views.paternal;
            }
            if (mounted) setSyncStatus('synced');
          } else if (mounted) {
            setSyncStatus('error');
          }
        } catch {
          if (mounted) setSyncStatus('offline');
        }
      }
      if (mounted) setIsHydrated(true);
    };
    hydrate();
    return () => {
      mounted = false;
    };
  }, [auth?.accessToken, auth?.googleSub, legacyQueueStorageKey]);

  useEffect(() => {
    if (!isHydrated) return;
    savePedigreeStore(store)
      .then(() => {
        setLocalSaveStatus('saved');
      })
      .catch(() => {
        setLocalSaveStatus('error');
      });
  }, [isHydrated, store]);

  useEffect(() => {
    if (!ENABLE_SERVER_SYNC) return;
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
    if (!ENABLE_SERVER_SYNC) return;
    if (!isHydrated) return;
    if (!auth?.googleSub || !auth.accessToken) return;
    if (queueRef.current.length === 0) return;
    flushQueue();
  }, [auth?.accessToken, auth?.googleSub, isHydrated]);

  const deletePerson = (id: PersonId) => {
    if (id === slots.selfId) return;
    updateActiveViewPeople(prev => {
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
    try {
      return buildStandardPedigreeLayout(peopleById, {
        ...STANDARD_LAYOUT_DEFAULTS,
        view: activeView,
      });
    } catch (error) {
      console.warn('[PedigreeScreen] layout failed', error);
      const fallback = createDefaultStore().views[activeView];
      return buildStandardPedigreeLayout(fallback, {
        ...STANDARD_LAYOUT_DEFAULTS,
        view: activeView,
      });
    }
  }, [peopleById, activeView]);

  const displayLayout = useMemo(() => {
    const nodeById: Record<PersonId, PositionedNode> = {};
    const nodes: PositionedNode[] = [];
    for (const n of layout.nodes) {
      if (
        !Number.isFinite(n.x) ||
        !Number.isFinite(n.y) ||
        !Number.isFinite(n.width) ||
        !Number.isFinite(n.height)
      ) {
        continue;
      }
      if (nodeById[n.id]) continue;
      const next = {
        ...n,
        x: Math.round(n.x),
        y: Math.round(n.y),
      };
      nodeById[n.id] = next;
      nodes.push(next);
    }
    const canvasWidth = Number.isFinite(layout.canvasWidth) ? layout.canvasWidth : 1600;
    const canvasHeight = Number.isFinite(layout.canvasHeight) ? layout.canvasHeight : 1200;
    return { ...layout, nodes, nodeById, canvasWidth, canvasHeight };
  }, [layout]);

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

  const contactEntries = useMemo(() => {
    const views: ActiveView[] = ['self', 'paternal', 'maternal', 'spouse'];
    const seenPhones = new Set<string>();
    const entries: {
      id: string;
      name: string;
      phone: string;
      viewLabel: string;
      kinshipLabel: string;
    }[] = [];

    for (const view of views) {
      for (const person of Object.values(store.views[view])) {
        const digits = normalizePhoneDigits(person.phone);
        if (!digits || seenPhones.has(digits)) continue;
        seenPhones.add(digits);
        entries.push({
          id: `${view}:${person.id}`,
          name: person.name?.trim() || '이름 없음',
          phone: digits,
          viewLabel: ACTIVE_VIEW_LABEL[view],
          kinshipLabel: buildViewKinshipLabels(view, store.views[view], store.views.self)[person.id] ?? person.name,
        });
      }
    }

    return entries;
  }, [store.views]);

  const kinshipLabelById = useMemo(
    () => buildViewKinshipLabels(activeView, peopleById, store.views.self),
    [peopleById, activeView, store.views.self],
  );

  const ordinalLabelById = useMemo(
    () => buildViewOrdinalLabels(activeView, peopleById),
    [peopleById, activeView],
  );

  const MIN_SCALE = 0.25;
  const MAX_SCALE = 2.8;
  const clampScaleOnJs = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

  const scale = useSharedValue(0.9);
  const savedScale = useSharedValue(0.9);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const displayLayoutRef = useRef(displayLayout);
  displayLayoutRef.current = displayLayout;
  const stageSizeRef = useRef(stageSize);
  stageSizeRef.current = stageSize;

  const centerOnPedigree = useCallback((animated = true) => {
    const sw = stageSizeRef.current.width;
    const sh = stageSizeRef.current.height;
    if (sw <= 0 || sh <= 0) return;

    const layout = displayLayoutRef.current;
    const cw = layout.canvasWidth;
    const ch = layout.canvasHeight;
    if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw <= 0 || ch <= 0) return;

    const focal = layout.nodeById[layout.selfId];
    const focusX = focal ? focal.x + focal.width / 2 : cw / 2;
    const focusY = focal ? focal.y + focal.height / 2 : ch / 2;
    if (!Number.isFinite(focusX) || !Number.isFinite(focusY)) return;

    const pad = 28;
    const fit = Math.min(
      (sw - pad * 2) / Math.max(cw, 1),
      (sh - pad * 2) / Math.max(ch, 1),
      0.95,
    );
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.max(fit, 0.4)));
    // RN 기본 scale 기준점(center)에 맞춘 translate
    const nextX = sw / 2 - cw / 2 - (focusX - cw / 2) * nextScale;
    const nextY = sh / 2 - ch / 2 - (focusY - ch / 2) * nextScale;
    if (![nextX, nextY, nextScale].every(Number.isFinite)) return;

    if (animated) {
      scale.value = withTiming(nextScale, { duration: 180 });
      translateX.value = withTiming(nextX, { duration: 180 });
      translateY.value = withTiming(nextY, { duration: 180 });
    } else {
      scale.value = nextScale;
      translateX.value = nextX;
      translateY.value = nextY;
    }
    savedScale.value = nextScale;
    savedX.value = nextX;
    savedY.value = nextY;
  }, [savedScale, savedX, savedY, scale, translateX, translateY]);

  const recenterToSelfView = () => {
    if (activeView !== 'self') {
      switchToSelfView();
      return;
    }
    centerOnPedigree(true);
  };

  useEffect(() => {
    if (!isHydrated) return;
    if (stageSize.width <= 0 || stageSize.height <= 0) return;
    const timer = setTimeout(() => {
      centerOnPedigree(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeView, centerOnPedigree, isHydrated, stageSize.height, stageSize.width]);

  const onStageLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setStageSize(prev =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  };

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          savedScale.value = scale.value;
        })
        .onUpdate(e => {
          scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
        }),
    [savedScale, scale],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
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
        }),
    [savedX, savedY, translateX, translateY],
  );

  const composed = useMemo(() => Gesture.Simultaneous(pinch, pan), [pinch, pan]);

  const canvasStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const zoomBy = (factor: number) => {
    const next = clampScaleOnJs(scale.value * factor);
    const sw = stageSize.width;
    const sh = stageSize.height;
    const cw = displayLayout.canvasWidth;
    const ch = displayLayout.canvasHeight;
    if (sw > 0 && sh > 0 && cw > 0 && ch > 0) {
      const cx = sw / 2;
      const cy = sh / 2;
      const worldX = (cx - translateX.value - cw / 2) / scale.value + cw / 2;
      const worldY = (cy - translateY.value - ch / 2) / scale.value + ch / 2;
      const nextX = cx - cw / 2 - (worldX - cw / 2) * next;
      const nextY = cy - ch / 2 - (worldY - ch / 2) * next;
      if ([nextX, nextY].every(Number.isFinite)) {
        scale.value = withTiming(next, { duration: 140 });
        translateX.value = withTiming(nextX, { duration: 140 });
        translateY.value = withTiming(nextY, { duration: 140 });
        savedScale.value = next;
        savedX.value = nextX;
        savedY.value = nextY;
        return;
      }
    }
    scale.value = withTiming(next, { duration: 140 });
    savedScale.value = next;
  };

  const openActionsFor = (id: PersonId) => {
    setSelectedId(id);
    setActionVisible(true);
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
      default:
        return '인물 등록';
    }
  }, [pendingAdd]);

  const onSubmitNewPerson = (person: Person) => {
    const action = pendingAdd;
    if (!action) return;
    updateActiveViewPeople(prev => {
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
        const resolved = resolveSiblingAdd(activeView, next, action.ofId);
        if (!resolved) return prev;
        const slotId = nextEmptySiblingSlotId(activeView, next, resolved);
        const finalId = slotId ?? person.id;
        next[finalId] = {
          ...person,
          id: finalId,
          ...(resolved.fatherId ? { fatherId: resolved.fatherId } : {}),
          ...(resolved.motherId ? { motherId: resolved.motherId } : {}),
        };
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
      }

      return next;
    });

    setPendingAdd(null);
  };

  const onSubmitEditPerson = (person: Person) => {
    updateActiveViewPeople(prev => {
      const existing = prev[person.id];
      if (!existing) return prev;
      return {
        ...prev,
        [person.id]: {
          ...existing,
          name: person.name,
          gender: person.gender,
          phone: person.phone,
          birthDate: person.birthDate,
          createdAt: person.createdAt,
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
          // 초기화 시 기본 족보 포맷(나·부모·양가 조부모·배우자·자녀)으로 복원
          const initial = syncAllViews(createInitialStore());
          setStore(initial);
          setSelectedId(slotIdsForView('self').selfId);
          lastSyncedPeopleRef.current = initial.views[initial.activeView];
          deletedIdsRef.current.clear();
          queueRef.current = [];
          setSyncStatus('idle');
          await clearPedigreePeople();

          if (ENABLE_SERVER_SYNC && auth?.googleSub && auth.accessToken) {
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

  const screenBg = ACTIVE_VIEW_BG[activeView];
  const safeCanvasWidth = Number.isFinite(displayLayout.canvasWidth)
    ? Math.max(1, Math.round(displayLayout.canvasWidth))
    : 1600;
  const safeCanvasHeight = Number.isFinite(displayLayout.canvasHeight)
    ? Math.max(1, Math.round(displayLayout.canvasHeight))
    : 1200;

  if (!isHydrated) {
    return (
      <View
        style={[
          styles.safe,
          { backgroundColor: screenBg, paddingTop: topInset, paddingBottom: bottomInset },
        ]}
      >
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={ui.color.accent} />
          <Text style={styles.loadingText}>족보 불러오는 중...</Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.safe,
        { backgroundColor: screenBg, paddingTop: topInset, paddingBottom: bottomInset },
      ]}
    >
      <View style={[styles.header, { backgroundColor: screenBg }]}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>가족가계도</Text>
            <Text style={[styles.viewBadge, { backgroundColor: ACTIVE_VIEW_BG[activeView] }]}>
              {ACTIVE_VIEW_LABEL[activeView]} 시점
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable style={styles.settingsBtn} onPress={() => setContactsVisible(true)}>
              <Text style={styles.settingsBtnText}>연락처</Text>
            </Pressable>
            <Pressable style={styles.settingsBtn} onPress={() => setSettingsVisible(true)}>
              <Text style={styles.settingsBtnText}>설정</Text>
            </Pressable>
            <View style={styles.headerActionColumn}>
              <Pressable style={styles.settingsBtn} onPress={() => setUsageVisible(true)}>
                <Text style={styles.settingsBtnText}>사용법</Text>
              </Pressable>
              {activeView !== 'self' ? (
                <Pressable style={styles.selfReturnBtn} onPress={switchToSelfView}>
                  <Text style={styles.selfReturnBtnText}>나 시점</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
        <Text style={styles.syncText}>
          {localSaveStatus === 'error'
            ? '기기 저장 실패'
            : ENABLE_SERVER_SYNC && auth?.googleSub
              ? syncStatus === 'syncing'
                ? '동기화 중...'
                : syncStatus === 'synced'
                  ? '서버 동기화 완료'
                  : syncStatus === 'offline'
                    ? '오프라인 모드 (로컬 저장 중)'
                    : syncStatus === 'error'
                      ? '동기화 오류 (재시도 예정)'
                      : '동기화 대기'
              : '기기에 저장됨'}
        </Text>
      </View>

      <View style={[styles.stage, { backgroundColor: screenBg }]} onLayout={onStageLayout}>
        <GestureDetector gesture={composed}>
          <Animated.View
            style={[
              {
                width: safeCanvasWidth,
                height: safeCanvasHeight,
                backgroundColor: screenBg,
              },
              canvasStyle,
            ]}
          >
            <EdgeLines
              edges={displayLayout.edges}
              nodeById={displayLayout.nodeById}
              spousePairs={spousePairs}
            />

            {displayLayout.nodes.map(n => {
              const p = peopleById[n.id];
              if (!p) return null;
              return (
                <View key={n.id} style={[styles.node, { left: n.x, top: n.y }]}>
                  <DraggablePersonNode
                    person={p}
                    label={kinshipLabelById[p.id] ?? p.name}
                    ordinalLabel={ordinalLabelById[p.id]}
                    width={n.width}
                    highlighted={layout.highlightIds.has(n.id)}
                    generation={n.generation}
                    onPress={() => openActionsFor(n.id)}
                  />
                </View>
              );
            })}
          </Animated.View>
        </GestureDetector>
      </View>

      {/* 줌 컨트롤: + / − / 中(중앙 복귀) */}
      <View style={styles.zoomBox}>
        <Pressable style={styles.zoomBtn} onPress={() => zoomBy(1.2)}>
          <Text style={styles.zoomText}>+</Text>
        </Pressable>
        <Pressable style={styles.zoomBtn} onPress={() => zoomBy(1 / 1.2)}>
          <Text style={styles.zoomText}>−</Text>
        </Pressable>
        <Pressable style={[styles.zoomBtn, styles.zoomCenterBtn]} onPress={recenterToSelfView}>
          <Text style={styles.zoomCenterText}>中</Text>
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

            {activeView === 'self' && selectedId === slots.selfId ? (
              <>
                <Pressable
                  style={[styles.sheetItem, styles.lineageSwitch]}
                  onPress={() => switchLineageView('paternal')}
                >
                  <Text style={styles.lineageSwitchText}>친가보기</Text>
                </Pressable>
                <Pressable
                  style={[styles.sheetItem, styles.lineageSwitchMaternal]}
                  onPress={() => switchLineageView('maternal')}
                >
                  <Text style={styles.lineageSwitchText}>외가보기</Text>
                </Pressable>
                <Pressable
                  style={[styles.sheetItem, styles.lineageSwitchSpouse]}
                  onPress={() => switchLineageView('spouse')}
                >
                  <Text style={styles.lineageSwitchText}>배우자보기</Text>
                </Pressable>
              </>
            ) : null}

            {activeView === 'self' && selectedId === slots.father ? (
              <Pressable
                style={[styles.sheetItem, styles.lineageSwitch]}
                onPress={() => switchLineageView('paternal')}
              >
                <Text style={styles.lineageSwitchText}>친가보기</Text>
              </Pressable>
            ) : null}

            {activeView === 'self' && selectedId === slots.mother ? (
              <Pressable
                style={[styles.sheetItem, styles.lineageSwitchMaternal]}
                onPress={() => switchLineageView('maternal')}
              >
                <Text style={styles.lineageSwitchText}>외가보기</Text>
              </Pressable>
            ) : null}

            {activeView === 'self' && selectedId === slots.spouseId ? (
              <Pressable
                style={[styles.sheetItem, styles.lineageSwitchSpouse]}
                onPress={() => switchLineageView('spouse')}
              >
                <Text style={styles.lineageSwitchText}>배우자보기</Text>
              </Pressable>
            ) : null}

            {activeView !== 'self' ? (
              <Pressable style={styles.sheetItem} onPress={switchToSelfView}>
                <Text style={styles.sheetItemText}>나 시점으로 돌아가기</Text>
              </Pressable>
            ) : null}

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

            {canAddSiblingFromNode(activeView, selectedId) ? (
              <Pressable
                style={styles.sheetItem}
                onPress={() => {
                  setActionVisible(false);
                  setPendingAdd({ kind: 'sibling', ofId: selectedId });
                }}
              >
                <Text style={styles.sheetItemText}>형제/자매 추가(같은 줄)</Text>
              </Pressable>
            ) : null}

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

            {selectedId !== slots.selfId ? (
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
                  구글 연동 시 계정 정보를 관리합니다. 족보 데이터는 기기에 저장됩니다.
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

      <ContactDirectoryModal
        visible={contactsVisible}
        entries={contactEntries}
        onClose={() => setContactsVisible(false)}
      />

      <Modal
        transparent
        visible={usageVisible}
        animationType="fade"
        onRequestClose={() => setUsageVisible(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setUsageVisible(false)}>
          <Pressable style={styles.settingsSheet} onPress={() => {}}>
            <Text style={styles.settingsTitle}>사용법</Text>
            <Text style={styles.settingsDesc}>1) 인물 카드 탭 → 작업 메뉴 열기</Text>
            <Text style={styles.settingsSubDesc}>
              부모/형제/배우자/자녀 추가, 정보 수정/삭제를 카드별로 실행할 수 있습니다.
            </Text>
            {activeView === 'self' ? (
              <>
                <Text style={styles.settingsDesc}>2) 시점 전환</Text>
                <Text style={styles.settingsSubDesc}>
                  아버지/어머니/배우자 카드에서 해당 집안 시점으로 전환할 수 있습니다.
                </Text>
              </>
            ) : null}
            <Text style={styles.settingsDesc}>{activeView === 'self' ? '3' : '2'}) 이동/확대</Text>
            <Text style={styles.settingsSubDesc}>
              핀치로 확대/축소, 드래그로 화면을 이동할 수 있습니다.
            </Text>
            {activeView !== 'self' ? (
              <>
                <Text style={styles.settingsDesc}>3) 나 시점 버튼</Text>
                <Text style={styles.settingsSubDesc}>
                  오른쪽 위 「나 시점」 버튼을 누르면 나 시점으로 돌아갑니다.
                </Text>
              </>
            ) : null}
            <Pressable style={styles.settingsCloseBtn} onPress={() => setUsageVisible(false)}>
              <Text style={styles.settingsCloseBtnText}>닫기</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: ui.color.textSecondary,
    fontSize: 14,
    fontWeight: ui.weight.label,
  },
  header: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
    zIndex: 10,
    elevation: 10,
  },
  headerTitle: {
    color: ui.color.text,
    fontSize: 18,
    fontWeight: ui.weight.heading,
  },
  viewBadge: {
    marginTop: 2,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    fontSize: 11,
    fontWeight: ui.weight.title,
    color: ui.color.text,
    overflow: 'hidden',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexShrink: 0,
    gap: 4,
  },
  headerActionColumn: {
    alignItems: 'stretch',
    gap: 4,
  },
  selfReturnBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2e7d32',
    backgroundColor: '#f1f8e9',
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignItems: 'center',
  },
  selfReturnBtnText: {
    color: '#1b5e20',
    fontSize: 11,
    fontWeight: ui.weight.title,
  },
  settingsBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ui.color.border,
    backgroundColor: ui.color.surface,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  settingsBtnText: {
    color: ui.color.text,
    fontSize: 11,
    fontWeight: ui.weight.title,
  },
  syncText: {
    marginTop: 2,
    color: ui.color.textMuted,
    fontSize: 11,
    fontWeight: ui.weight.label,
  },
  stage: {
    flex: 1,
    overflow: 'hidden',
  },
  node: {
    position: 'absolute',
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
    backgroundColor: ui.color.surface,
    borderWidth: 1.5,
    borderColor: ui.color.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...ui.shadow.float,
  },
  zoomText: {
    color: ui.color.text,
    fontSize: 20,
    fontWeight: ui.weight.heading,
    marginTop: -2,
  },
  zoomCenterBtn: {
    borderColor: '#2e7d32',
    backgroundColor: '#f1f8e9',
  },
  zoomCenterText: {
    color: '#1b5e20',
    fontSize: 18,
    fontWeight: ui.weight.heading,
    marginTop: -1,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: ui.color.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: ui.color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: ui.color.borderLight,
    padding: 16,
    gap: 10,
  },
  sheetTitle: {
    color: ui.color.text,
    fontSize: 15,
    fontWeight: ui.weight.heading,
    marginBottom: 6,
  },
  sheetItem: {
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: ui.color.surface,
    borderWidth: 1,
    borderColor: ui.color.border,
  },
  sheetItemText: {
    color: ui.color.text,
    fontSize: 14,
    fontWeight: ui.weight.title,
  },
  lineageSwitch: {
    backgroundColor: '#e3f2fd',
    borderColor: '#90caf9',
  },
  lineageSwitchMaternal: {
    backgroundColor: '#fce4ec',
    borderColor: '#f48fb1',
  },
  lineageSwitchSpouse: {
    backgroundColor: '#f1f8e9',
    borderColor: '#aed581',
  },
  lineageSwitchText: {
    color: ui.color.text,
    fontSize: 14,
    fontWeight: ui.weight.title,
  },
  sheetHint: {
    color: ui.color.textSecondary,
    fontSize: 12,
    fontWeight: ui.weight.body,
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
    borderColor: ui.color.dangerBorder,
    backgroundColor: ui.color.dangerBg,
  },
  dangerText: {
    color: ui.color.danger,
    fontWeight: ui.weight.title,
  },
  settingsSheet: {
    marginHorizontal: 16,
    marginTop: 120,
    backgroundColor: ui.color.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ui.color.border,
    padding: 16,
    gap: 8,
    ...ui.shadow.card,
  },
  settingsTitle: {
    color: ui.color.text,
    fontSize: 16,
    fontWeight: ui.weight.heading,
    marginBottom: 6,
  },
  settingsDesc: {
    color: ui.color.label,
    fontSize: 13,
    fontWeight: ui.weight.body,
  },
  settingsSubDesc: {
    color: ui.color.textSecondary,
    fontSize: 12,
    fontWeight: ui.weight.body,
    marginBottom: 8,
  },
  settingsActionBtn: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ui.color.border,
    backgroundColor: ui.color.surface,
    paddingHorizontal: 10,
    paddingVertical: 11,
  },
  settingsActionText: {
    color: ui.color.text,
    fontSize: 13,
    fontWeight: ui.weight.title,
  },
  settingsDangerBtn: {
    borderColor: ui.color.dangerBorder,
    backgroundColor: ui.color.dangerBg,
  },
  settingsDangerText: {
    color: ui.color.danger,
    fontWeight: ui.weight.title,
  },
  settingsCloseBtn: {
    marginTop: 10,
    alignSelf: 'flex-end',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ui.color.border,
    backgroundColor: ui.color.surface,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  settingsCloseBtnText: {
    color: ui.color.text,
    fontSize: 12,
    fontWeight: ui.weight.title,
  },
});
