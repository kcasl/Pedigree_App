import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Edge, PositionedNode } from '../utils/pedigreeLayout';

type Props = {
  edges: Edge[];
  nodeById: Record<string, PositionedNode>;
  spousePairs?: Array<{ aId: string; bId: string }>;
  strokeWidth?: number;
  color?: string;
};

function lineStyle(x: number, y: number, w: number, h: number, color: string, strokeWidth: number) {
  return {
    position: 'absolute' as const,
    left: x,
    top: y,
    width: w,
    height: h,
    backgroundColor: color,
    borderRadius: strokeWidth / 2,
  };
}

function pairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}__${bId}` : `${bId}__${aId}`;
}

export function EdgeLines({
  edges,
  nodeById,
  spousePairs = [],
  strokeWidth = 2,
  color = '#111827',
}: Props) {
  const lines: React.ReactNode[] = [];
  const gap = 24;
  const attachOffset = 8;
  const laneStep = 10;
  const lineDrop = 12;

  const parentsByChild: Record<string, string[]> = {};
  edges.forEach(edge => {
    const arr = parentsByChild[edge.childId] ?? [];
    arr.push(edge.parentId);
    parentsByChild[edge.childId] = arr;
  });

  const spouseKeySet = new Set<string>(
    spousePairs.map(pair => pairKey(pair.aId, pair.bId)),
  );

  // child -> resolved parents (strict mode)
  const parentGroupByChild: Record<
    string,
    { kind: 'pair'; aId: string; bId: string } | { kind: 'single'; parentId: string }
  > = {};
  const childIdsByGroupKey: Record<string, string[]> = {};

  for (const [childId, rawParentIds] of Object.entries(parentsByChild)) {
    const uniqueParentIds = Array.from(new Set(rawParentIds));

    if (uniqueParentIds.length === 1) {
      parentGroupByChild[childId] = { kind: 'single', parentId: uniqueParentIds[0] };
      const gKey = `single__${uniqueParentIds[0]}`;
      const arr = childIdsByGroupKey[gKey] ?? [];
      arr.push(childId);
      childIdsByGroupKey[gKey] = arr;
      continue;
    }

    if (uniqueParentIds.length >= 2) {
      let resolvedCoupleKey: string | null = null;

      // 엄격 모드: 부모가 3명 이상 걸린 경우에는 "배우자쌍"만 유효 부모쌍으로 인정한다.
      for (let i = 0; i < uniqueParentIds.length; i++) {
        for (let j = i + 1; j < uniqueParentIds.length; j++) {
          const key = pairKey(uniqueParentIds[i], uniqueParentIds[j]);
          if (spouseKeySet.has(key)) {
            resolvedCoupleKey = key;
            break;
          }
        }
        if (resolvedCoupleKey) break;
      }

      // 단, 부모가 정확히 2명인 경우에는 배우자 링크가 없어도 해당 2명만 연결 허용.
      if (!resolvedCoupleKey && uniqueParentIds.length === 2) {
        resolvedCoupleKey = pairKey(uniqueParentIds[0], uniqueParentIds[1]);
      }

      if (resolvedCoupleKey) {
        const [aId, bId] = resolvedCoupleKey.split('__');
        parentGroupByChild[childId] = { kind: 'pair', aId, bId };
        const gKey = `pair__${resolvedCoupleKey}`;
        const arr = childIdsByGroupKey[gKey] ?? [];
        arr.push(childId);
        childIdsByGroupKey[gKey] = arr;
      } else {
        parentGroupByChild[childId] = { kind: 'single', parentId: uniqueParentIds[0] };
        const gKey = `single__${uniqueParentIds[0]}`;
        const arr = childIdsByGroupKey[gKey] ?? [];
        arr.push(childId);
        childIdsByGroupKey[gKey] = arr;
      }
    }
  }

  // 그룹 내 child index (lane)는 같은 부모그룹 안에서만 공유됨 -> 다른 가계선과 섞이지 않음.
  const laneByChildId: Record<string, number> = {};
  Object.values(childIdsByGroupKey).forEach(ids => {
    const sorted = ids
      .map(id => nodeById[id])
      .filter((v): v is PositionedNode => !!v)
      .sort((a, b) => a.x - b.x)
      .map(v => v.id);
    sorted.forEach((id, idx) => {
      laneByChildId[id] = idx;
    });
  });

  // child-centric strict rendering
  Object.entries(parentGroupByChild).forEach(([childId, group]) => {
    const child = nodeById[childId];
    if (!child) return;
    const childX = child.x + child.width / 2;
    const childTop = child.y - attachOffset;
    const lane = laneByChildId[childId] ?? 0;

    if (group.kind === 'pair') {
      const a = nodeById[group.aId];
      const b = nodeById[group.bId];
      if (!a || !b) return;

      const left = a.x <= b.x ? a : b;
      const right = a.x <= b.x ? b : a;
      const leftX = left.x + left.width / 2;
      const rightX = right.x + right.width / 2;
      const leftBottom = left.y + left.height + attachOffset;
      const rightBottom = right.y + right.height + attachOffset;
      const spouseY = Math.max(leftBottom, rightBottom);
      const midX = (leftX + rightX) / 2;

      if (leftBottom < spouseY) {
        lines.push(
          <View
            key={`pair_adj_l_${childId}`}
            style={lineStyle(
              leftX - strokeWidth / 2,
              leftBottom,
              strokeWidth,
              Math.max(strokeWidth, spouseY - leftBottom),
              color,
              strokeWidth,
            )}
          />,
        );
      }
      if (rightBottom < spouseY) {
        lines.push(
          <View
            key={`pair_adj_r_${childId}`}
            style={lineStyle(
              rightX - strokeWidth / 2,
              rightBottom,
              strokeWidth,
              Math.max(strokeWidth, spouseY - rightBottom),
              color,
              strokeWidth,
            )}
          />,
        );
      }

      // pair baseline (always)
      lines.push(
        <View
          key={`pair_base_${childId}`}
          style={lineStyle(
            leftX,
            spouseY - strokeWidth / 2,
            Math.max(strokeWidth, rightX - leftX),
            strokeWidth,
            color,
            strokeWidth,
          )}
        />,
      );

      // parent-center -> child (L-shape), lane offset to avoid sibling overlap
      let midY = (spouseY + childTop) / 2 + lineDrop + lane * laneStep;
      const minMid = spouseY + gap + lineDrop;
      const maxMid = childTop - gap;
      if (minMid <= maxMid) {
        midY = Math.min(maxMid, Math.max(minMid, midY));
      }

      lines.push(
        <View
          key={`pair_trunk_${childId}`}
          style={lineStyle(
            midX - strokeWidth / 2,
            spouseY,
            strokeWidth,
            Math.max(strokeWidth, midY - spouseY),
            color,
            strokeWidth,
          )}
        />,
      );
      lines.push(
        <View
          key={`pair_h_${childId}`}
          style={lineStyle(
            Math.min(midX, childX),
            midY - strokeWidth / 2,
            Math.max(strokeWidth, Math.abs(childX - midX)),
            strokeWidth,
            color,
            strokeWidth,
          )}
        />,
      );
      lines.push(
        <View
          key={`pair_child_v_${childId}`}
          style={lineStyle(
            childX - strokeWidth / 2,
            midY,
            strokeWidth,
            Math.max(strokeWidth, childTop - midY),
            color,
            strokeWidth,
          )}
        />,
      );
      return;
    }

    const parent = nodeById[group.parentId];
    if (!parent) return;
    const parentX = parent.x + parent.width / 2;
    const parentBottom = parent.y + parent.height + attachOffset;

    let midY = (parentBottom + childTop) / 2 + lineDrop + lane * laneStep;
    const minMid = parentBottom + gap + lineDrop;
    const maxMid = childTop - gap;
    if (minMid <= maxMid) {
      midY = Math.min(maxMid, Math.max(minMid, midY));
    }

    lines.push(
      <View
        key={`single_v_parent_${childId}`}
        style={lineStyle(
          parentX - strokeWidth / 2,
          parentBottom,
          strokeWidth,
          Math.max(strokeWidth, midY - parentBottom),
          color,
          strokeWidth,
        )}
      />,
    );
    lines.push(
      <View
        key={`single_h_${childId}`}
        style={lineStyle(
          Math.min(parentX, childX),
          midY - strokeWidth / 2,
          Math.max(strokeWidth, Math.abs(childX - parentX)),
          strokeWidth,
          color,
          strokeWidth,
        )}
      />,
    );
    lines.push(
      <View
        key={`single_v_child_${childId}`}
        style={lineStyle(
          childX - strokeWidth / 2,
          midY,
          strokeWidth,
          Math.max(strokeWidth, childTop - midY),
          color,
          strokeWidth,
        )}
      />,
    );
  });

  // Always keep spouse baseline visible
  spousePairs.forEach((pair, idx) => {
    const a = nodeById[pair.aId];
    const b = nodeById[pair.bId];
    if (!a || !b) return;
    const left = a.x <= b.x ? a : b;
    const right = a.x <= b.x ? b : a;
    const leftX = left.x + left.width / 2;
    const rightX = right.x + right.width / 2;
    const y = Math.max(left.y + left.height, right.y + right.height) + 10;
    lines.push(
      <View
        key={`spouse_${idx}_${pair.aId}_${pair.bId}`}
        style={lineStyle(
          leftX,
          y - strokeWidth / 2,
          Math.max(strokeWidth, rightX - leftX),
          strokeWidth,
          color,
          strokeWidth,
        )}
      />,
    );
  });

  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{lines}</View>;
}

