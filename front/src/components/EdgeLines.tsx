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

export function EdgeLines({
  edges,
  nodeById,
  spousePairs = [],
  strokeWidth = 2,
  color = '#111827',
}: Props) {
  // Draw connectors grouped by child so only a parent pair(couple) is connected per child.
  const lines: React.ReactNode[] = [];
  const gap = 24; // 카드와 선이 겹쳐서 가려지는 문제를 줄이기 위한 여유 간격
  const attachOffset = 8; // 노드 경계에 딱 붙어 가려지는 문제 방지(끝점을 살짝 띄움)
  const midYOffset = 10; // 두 노드 사이 "아래쪽" 가로선이 더 잘 보이도록 살짝 아래로 내림

  const parentsByChild: Record<string, string[]> = {};
  edges.forEach(edge => {
    const arr = parentsByChild[edge.childId] ?? [];
    arr.push(edge.parentId);
    parentsByChild[edge.childId] = arr;
  });

  Object.entries(parentsByChild).forEach(([childId, rawParentIds], idx) => {
    const child = nodeById[childId];
    if (!child) return;

    const uniqueParentIds = Array.from(new Set(rawParentIds));
    const parentNodes = uniqueParentIds
      .map(id => nodeById[id])
      .filter((n): n is PositionedNode => !!n)
      .sort((a, b) => a.x - b.x);

    if (parentNodes.length === 0) return;

    const childX = child.x + child.width / 2;
    const childY = child.y - attachOffset;

    // 부모가 1명인 경우: 기존 L자 연결
    if (parentNodes.length === 1) {
      const parent = parentNodes[0];
      const parentX = parent.x + parent.width / 2;
      const parentY = parent.y + parent.height + attachOffset;

      let midY = (parentY + childY) / 2 + midYOffset;
      const minMid = parentY + gap;
      const maxMid = childY - gap;
      if (minMid <= maxMid) {
        midY = Math.min(maxMid, Math.max(minMid, midY));
      }

      const v1H = Math.max(strokeWidth, childY - midY);
      lines.push(
        <View
          key={`single_v1_${idx}`}
          style={lineStyle(
            childX - strokeWidth / 2,
            midY,
            strokeWidth,
            v1H,
            color,
            strokeWidth,
          )}
        />,
      );

      const leftX = Math.min(parentX, childX);
      const rightX = Math.max(parentX, childX);
      const hW = Math.max(strokeWidth, rightX - leftX);
      lines.push(
        <View
          key={`single_h_${idx}`}
          style={lineStyle(leftX, midY - strokeWidth / 2, hW, strokeWidth, color, strokeWidth)}
        />,
      );

      const v2H = Math.max(strokeWidth, midY - parentY);
      lines.push(
        <View
          key={`single_v2_${idx}`}
          style={lineStyle(
            parentX - strokeWidth / 2,
            parentY,
            strokeWidth,
            v2H,
            color,
            strokeWidth,
          )}
        />,
      );
      return;
    }

    // 부모가 2명 이상이면 자녀 기준으로 가까운 2명만 부부 쌍으로 연결
    const pair = [...parentNodes]
      .sort((a, b) => Math.abs(a.x + a.width / 2 - childX) - Math.abs(b.x + b.width / 2 - childX))
      .slice(0, 2)
      .sort((a, b) => a.x - b.x);
    const leftParent = pair[0];
    const rightParent = pair[1];

    const leftX = leftParent.x + leftParent.width / 2;
    const rightX = rightParent.x + rightParent.width / 2;
    const leftY = leftParent.y + leftParent.height + attachOffset;
    const rightY = rightParent.y + rightParent.height + attachOffset;

    const spouseY = Math.max(leftY, rightY);
    const coupleMidX = (leftX + rightX) / 2;

    // 부모 높이가 다르면 각자 spouseY까지 수직 보정
    if (leftY < spouseY) {
      lines.push(
        <View
          key={`pair_left_adjust_${idx}`}
          style={lineStyle(
            leftX - strokeWidth / 2,
            leftY,
            strokeWidth,
            Math.max(strokeWidth, spouseY - leftY),
            color,
            strokeWidth,
          )}
        />,
      );
    }
    if (rightY < spouseY) {
      lines.push(
        <View
          key={`pair_right_adjust_${idx}`}
          style={lineStyle(
            rightX - strokeWidth / 2,
            rightY,
            strokeWidth,
            Math.max(strokeWidth, spouseY - rightY),
            color,
            strokeWidth,
          )}
        />,
      );
    }

    // 부부 가로 연결선
    lines.push(
      <View
        key={`pair_h_${idx}`}
        style={lineStyle(
          Math.min(leftX, rightX),
          spouseY - strokeWidth / 2,
          Math.max(strokeWidth, Math.abs(rightX - leftX)),
          strokeWidth,
          color,
          strokeWidth,
        )}
      />,
    );

    let midY = (spouseY + childY) / 2 + midYOffset;
    const minMid = spouseY + gap;
    const maxMid = childY - gap;
    if (minMid <= maxMid) {
      midY = Math.min(maxMid, Math.max(minMid, midY));
    }

    // 부부 중심에서 자녀로 내려가는 트렁크
    lines.push(
      <View
        key={`pair_trunk_${idx}`}
        style={lineStyle(
          coupleMidX - strokeWidth / 2,
          spouseY,
          strokeWidth,
          Math.max(strokeWidth, midY - spouseY),
          color,
          strokeWidth,
        )}
      />,
    );

    // 자녀 쪽 수직선
    lines.push(
      <View
        key={`pair_child_v_${idx}`}
        style={lineStyle(
          childX - strokeWidth / 2,
          midY,
          strokeWidth,
          Math.max(strokeWidth, childY - midY),
          color,
          strokeWidth,
        )}
      />,
    );

    // 트렁크-자녀 가로 연결
    lines.push(
      <View
        key={`pair_child_h_${idx}`}
        style={lineStyle(
          Math.min(coupleMidX, childX),
          midY - strokeWidth / 2,
          Math.max(strokeWidth, Math.abs(childX - coupleMidX)),
          strokeWidth,
          color,
          strokeWidth,
        )}
      />,
    );
  });

  // 배우자 연결선: 자녀 유무와 무관하게 카드 하단에서 항상 연결
  spousePairs.forEach((pair, idx) => {
    const a = nodeById[pair.aId];
    const b = nodeById[pair.bId];
    if (!a || !b) return;

    const ax = a.x + a.width / 2;
    const bx = b.x + b.width / 2;
    const y = Math.max(a.y + a.height, b.y + b.height) + 10;
    const left = Math.min(ax, bx);
    const width = Math.max(strokeWidth, Math.abs(ax - bx));
    lines.push(
      <View
        key={`spouse_${idx}_${pair.aId}_${pair.bId}`}
        style={lineStyle(left, y - strokeWidth / 2, width, strokeWidth, color, strokeWidth)}
      />,
    );
  });

  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{lines}</View>;
}

