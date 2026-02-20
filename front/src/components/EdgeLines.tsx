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
  const attachOffset = 0;
  const lineDrop = 10;
  const spouseLineDrop = 8;

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
  const couplesWithChildren = new Set<string>();

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
        couplesWithChildren.add(resolvedCoupleKey);
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

  // parent-group rendering:
  // parent(s) -> trunk -> sibling rail(가로) -> each child vertical.
  // 이렇게 그리면 부모-자식은 항상 T/ㅠ 형태가 고정된다.
  Object.entries(childIdsByGroupKey).forEach(([groupKey, rawChildIds]) => {
    const childNodes = rawChildIds
      .map(id => nodeById[id])
      .filter((n): n is PositionedNode => Boolean(n))
      .sort((a, b) => a.x - b.x);
    if (!childNodes.length) return;

    const childXs = childNodes.map(n => n.x + n.width / 2);
    const childTops = childNodes.map(n => n.y - attachOffset);
    const minChildX = Math.min(...childXs);
    const maxChildX = Math.max(...childXs);
    const minChildTop = Math.min(...childTops);
    const avgChildX = childXs.reduce((sum, x) => sum + x, 0) / childXs.length;

    if (groupKey.startsWith('pair__')) {
      const pair = groupKey.replace('pair__', '');
      const [aId, bId] = pair.split('__');
      const a = nodeById[aId];
      const b = nodeById[bId];
      if (!a || !b) return;

      const left = a.x <= b.x ? a : b;
      const right = a.x <= b.x ? b : a;
      const leftX = left.x + left.width / 2;
      const rightX = right.x + right.width / 2;
      const leftBottom = left.y + left.height + attachOffset;
      const rightBottom = right.y + right.height + attachOffset;
      const spouseY = Math.max(leftBottom, rightBottom);
      const spouseLineY = spouseY + spouseLineDrop;
      const pairCenterX = (leftX + rightX) / 2;
      const outwardAnchorGap = 10;

      let anchorX = pairCenterX;
      if (avgChildX < pairCenterX - 0.5) {
        anchorX = leftX - outwardAnchorGap;
      } else if (avgChildX > pairCenterX + 0.5) {
        anchorX = rightX + outwardAnchorGap;
      }

      if (leftBottom < spouseY) {
        lines.push(
          <View
            key={`pair_adj_l_${pair}`}
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
            key={`pair_adj_r_${pair}`}
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

      // spouse baseline
      lines.push(
        <View
          key={`pair_base_${pair}`}
          style={lineStyle(
            leftX,
            spouseLineY - strokeWidth / 2,
            Math.max(strokeWidth, rightX - leftX),
            strokeWidth,
            color,
            strokeWidth,
          )}
        />,
      );

      // outward ㄴ/ㄱ branch: first horizontal on spouse baseline
      if (Math.abs(anchorX - pairCenterX) > 0.5) {
        lines.push(
          <View
            key={`pair_out_h_${pair}`}
            style={lineStyle(
              Math.min(pairCenterX, anchorX),
              spouseLineY - strokeWidth / 2,
              Math.max(strokeWidth, Math.abs(anchorX - pairCenterX)),
              strokeWidth,
              color,
              strokeWidth,
            )}
          />,
        );
      }

      let railY = spouseLineY + gap + lineDrop;
      const maxRailY = minChildTop - gap;
      if (railY > maxRailY) railY = (spouseLineY + minChildTop) / 2;

      // trunk vertical
      lines.push(
        <View
          key={`pair_trunk_${pair}`}
          style={lineStyle(
            anchorX - strokeWidth / 2,
            spouseLineY,
            strokeWidth,
            Math.max(strokeWidth, railY - spouseLineY),
            color,
            strokeWidth,
          )}
        />,
      );

      // sibling rail (horizontal)
      lines.push(
        <View
          key={`pair_rail_${pair}`}
          style={lineStyle(
            Math.min(anchorX, minChildX),
            railY - strokeWidth / 2,
            Math.max(strokeWidth, Math.max(anchorX, maxChildX) - Math.min(anchorX, minChildX)),
            strokeWidth,
            color,
            strokeWidth,
          )}
        />,
      );

      // each child vertical
      childNodes.forEach(child => {
        const childX = child.x + child.width / 2;
        const childTop = child.y - attachOffset;
        lines.push(
          <View
            key={`pair_child_v_${pair}_${child.id}`}
            style={lineStyle(
              childX - strokeWidth / 2,
              railY,
              strokeWidth,
              Math.max(strokeWidth, childTop - railY),
              color,
              strokeWidth,
            )}
          />,
        );
      });
      return;
    }

    const parentId = groupKey.replace('single__', '');
    const parent = nodeById[parentId];
    if (!parent) return;

    const parentX = parent.x + parent.width / 2;
    const parentBottom = parent.y + parent.height + attachOffset;
    const outwardGap = 10;
    let anchorX = parentX;
    if (avgChildX < parentX - 0.5) anchorX = parentX - outwardGap;
    else if (avgChildX > parentX + 0.5) anchorX = parentX + outwardGap;

    // outward ㄴ/ㄱ branch for single parent
    if (Math.abs(anchorX - parentX) > 0.5) {
      lines.push(
        <View
          key={`single_out_h_${parentId}`}
          style={lineStyle(
            Math.min(parentX, anchorX),
            parentBottom - strokeWidth / 2,
            Math.max(strokeWidth, Math.abs(anchorX - parentX)),
            strokeWidth,
            color,
            strokeWidth,
          )}
        />,
      );
    }

    let railY = parentBottom + gap + lineDrop;
    const maxRailY = minChildTop - gap;
    if (railY > maxRailY) railY = (parentBottom + minChildTop) / 2;

    lines.push(
      <View
        key={`single_trunk_${parentId}`}
        style={lineStyle(
          anchorX - strokeWidth / 2,
          parentBottom,
          strokeWidth,
          Math.max(strokeWidth, railY - parentBottom),
          color,
          strokeWidth,
        )}
      />,
    );
    lines.push(
      <View
        key={`single_rail_${parentId}`}
        style={lineStyle(
          Math.min(anchorX, minChildX),
          railY - strokeWidth / 2,
          Math.max(strokeWidth, Math.max(anchorX, maxChildX) - Math.min(anchorX, minChildX)),
          strokeWidth,
          color,
          strokeWidth,
        )}
      />,
    );
    childNodes.forEach(child => {
      const childX = child.x + child.width / 2;
      const childTop = child.y - attachOffset;
      lines.push(
        <View
          key={`single_child_v_${parentId}_${child.id}`}
          style={lineStyle(
            childX - strokeWidth / 2,
            railY,
            strokeWidth,
            Math.max(strokeWidth, childTop - railY),
            color,
            strokeWidth,
          )}
        />
      );
    });
  });

  // Always keep spouse baseline visible
  spousePairs.forEach((pair, idx) => {
    const key = pairKey(pair.aId, pair.bId);
    // 자녀 연결에서 이미 부부 가로선을 그린 경우 중복선을 그리지 않는다.
    if (couplesWithChildren.has(key)) return;
    const a = nodeById[pair.aId];
    const b = nodeById[pair.bId];
    if (!a || !b) return;
    const left = a.x <= b.x ? a : b;
    const right = a.x <= b.x ? b : a;
    const leftX = left.x + left.width / 2;
    const rightX = right.x + right.width / 2;
    const y = Math.max(left.y + left.height, right.y + right.height) + 10 + spouseLineDrop;
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

