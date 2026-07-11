/**
 * 족보 연결선 — 일반 가계도(pedigree chart) 방식
 *
 *   [조모]──[조부]     [외조모]──[외조부]
 *            \              /
 *         [모]────[부]
 *               │
 *              [나]
 *
 * - 부부: 카드 하단 가로선 (슬롯 1↔2, 3↔4 자동 인식)
 * - 부모→자식: 부부 중앙에서 세로 → 형제 rail → 각 자식 세로
 * - 부모가 좌우 다른 가지(1번·2번)여도 자식 연결은 T 형태 유지
 *
 * 튜닝: EDGE_DRAW_CONFIG
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ui } from '../theme/ui';
import type { Edge, PositionedNode } from '../utils/pedigreeLayout';

export const EDGE_DRAW_CONFIG = {
  enabled: true,
  spouseLineOffset: 6,
  trunkGap: 18,
  childGap: 14,
  strokeWidth: 2.5,
  color: ui.color.line,
} as const;

type Props = {
  edges: Edge[];
  nodeById: Record<string, PositionedNode>;
  spousePairs?: Array<{ aId: string; bId: string }>;
  strokeWidth?: number;
  color?: string;
};

type CoupleGroup = {
  kind: 'couple';
  leftId: string;
  rightId: string;
  childIds: string[];
};

type SingleGroup = {
  kind: 'single';
  parentId: string;
  childIds: string[];
};

type ParentGroup = CoupleGroup | SingleGroup;

function bar(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  stroke: number,
) {
  if (![x, y, w, h, stroke].every(Number.isFinite)) {
    return {
      position: 'absolute' as const,
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      backgroundColor: 'transparent',
    };
  }
  return {
    position: 'absolute' as const,
    left: Math.round(x),
    top: Math.round(y),
    width: Math.max(stroke, Math.round(w)),
    height: Math.max(stroke, Math.round(h)),
    backgroundColor: color,
    borderRadius: stroke / 2,
  };
}

function cx(n: PositionedNode): number {
  return n.x + n.width / 2;
}

function bottom(n: PositionedNode): number {
  return n.y + n.height;
}

function top(n: PositionedNode): number {
  return n.y;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

function isLayoutCouple(a: PositionedNode, b: PositionedNode): boolean {
  if (a.generation !== b.generation) return false;
  return a.partnerId === b.id || b.partnerId === a.id;
}

function pickCouple(
  parentIds: string[],
  spouseKeys: Set<string>,
  nodeById: Record<string, PositionedNode>,
): { couple: [string, string] | null; rest: string[] } {
  if (parentIds.length < 2) return { couple: null, rest: parentIds };

  // 한 자식의 부·모(엣지 2개)는 거리와 무관하게 항상 부부로 연결
  if (parentIds.length === 2) {
    const a = nodeById[parentIds[0]];
    const b = nodeById[parentIds[1]];
    if (a && b) {
      const left = cx(a) <= cx(b) ? parentIds[0] : parentIds[1];
      const right = left === parentIds[0] ? parentIds[1] : parentIds[0];
      return { couple: [left, right], rest: [] };
    }
  }

  for (let i = 0; i < parentIds.length; i++) {
    for (let j = i + 1; j < parentIds.length; j++) {
      const a = nodeById[parentIds[i]];
      const b = nodeById[parentIds[j]];
      if (!a || !b) continue;
      const key = pairKey(parentIds[i], parentIds[j]);
      if (spouseKeys.has(key) || isLayoutCouple(a, b)) {
        const left = cx(a) <= cx(b) ? parentIds[i] : parentIds[j];
        const right = left === parentIds[i] ? parentIds[j] : parentIds[i];
        const rest = parentIds.filter(id => id !== left && id !== right);
        return { couple: [left, right], rest };
      }
    }
  }
  return { couple: null, rest: parentIds };
}

function buildGroups(
  edges: Edge[],
  spousePairs: Array<{ aId: string; bId: string }>,
  nodeById: Record<string, PositionedNode>,
): { groups: ParentGroup[]; drawnCouples: Set<string> } {
  const byChild = new Map<string, Set<string>>();
  for (const { parentId, childId } of edges) {
    const set = byChild.get(childId) ?? new Set();
    set.add(parentId);
    byChild.set(childId, set);
  }

  const spouseKeys = new Set(spousePairs.map(p => pairKey(p.aId, p.bId)));
  const groupMap = new Map<string, ParentGroup>();
  const drawnCouples = new Set<string>();

  const addSingle = (parentId: string, childId: string) => {
    const k = `s:${parentId}`;
    const g = groupMap.get(k);
    if (g?.kind === 'single') g.childIds.push(childId);
    else groupMap.set(k, { kind: 'single', parentId, childIds: [childId] });
  };

  for (const [childId, parentSet] of byChild) {
    let remaining = Array.from(parentSet);
    const { couple, rest } = pickCouple(remaining, spouseKeys, nodeById);

    if (couple) {
      const [leftId, rightId] = couple;
      const k = `c:${pairKey(leftId, rightId)}`;
      drawnCouples.add(pairKey(leftId, rightId));
      const g = groupMap.get(k);
      if (g?.kind === 'couple') g.childIds.push(childId);
      else groupMap.set(k, { kind: 'couple', leftId, rightId, childIds: [childId] });
      remaining = rest;
    }

    for (const pid of remaining) addSingle(pid, childId);
  }

  return { groups: Array.from(groupMap.values()), drawnCouples };
}

/** 세대 사이 세로 간격을 정확히 이등분한 rail Y (픽셀 스냅) */
function railY(parentBottom: number, childTop: number, _cfg: typeof EDGE_DRAW_CONFIG): number {
  return Math.round((parentBottom + childTop) / 2);
}

type Ctx = {
  out: React.ReactNode[];
  nodeById: Record<string, PositionedNode>;
  stroke: number;
  fallbackColor?: string;
  cfg: typeof EDGE_DRAW_CONFIG;
};

function drawCouple(group: CoupleGroup, ctx: Ctx): void {
  const { out, nodeById, stroke, fallbackColor, cfg } = ctx;
  const left = nodeById[group.leftId];
  const right = nodeById[group.rightId];
  if (!left || !right) return;

  const children = group.childIds
    .map(id => nodeById[id])
    .filter(Boolean)
    .sort((a, b) => cx(a) - cx(b)) as PositionedNode[];
  if (!children.length) return;

  const leftEdge = left.x + left.width;
  const rightEdge = right.x;
  const parentBottom = Math.max(bottom(left), bottom(right));
  const baseY = parentBottom + cfg.spouseLineOffset;
  const midX = Math.round((left.x + right.x + right.width) / 2);

  const childXs = children.map(cx);
  const minChildX = Math.min(...childXs);
  const maxChildX = Math.max(...childXs);
  const minChildTop = Math.min(...children.map(top));
  const childGeneration = children[0]?.generation ?? left.generation + 1;
  const parentColor = fallbackColor ?? ui.generationLine(left.generation);
  const childColor = fallbackColor ?? ui.generationLine(childGeneration);

  const key = pairKey(group.leftId, group.rightId);

  out.push(
    <View
      key={`c_h_${key}`}
      style={bar(leftEdge, baseY - stroke / 2, rightEdge - leftEdge, stroke, parentColor, stroke)}
    />,
  );

  const ry = railY(parentBottom, minChildTop, cfg);

  out.push(
    <View key={`c_v_${key}`} style={bar(midX - stroke / 2, baseY, stroke, Math.max(stroke, ry - baseY), parentColor, stroke)} />,
  );

  const railLeft = Math.min(midX, minChildX);
  const railW = Math.max(midX, maxChildX) - railLeft;
  out.push(
    <View key={`c_r_${key}`} style={bar(railLeft, ry - stroke / 2, railW, stroke, childColor, stroke)} />,
  );

  for (const ch of children) {
    const x = cx(ch);
    out.push(
      <View
        key={`c_ch_${key}_${ch.id}`}
        style={bar(x - stroke / 2, ry, stroke, top(ch) - ry, childColor, stroke)}
      />,
    );
  }
}

function drawSingle(group: SingleGroup, ctx: Ctx): void {
  const { out, nodeById, stroke, fallbackColor, cfg } = ctx;
  const parent = nodeById[group.parentId];
  if (!parent) return;

  const children = group.childIds
    .map(id => nodeById[id])
    .filter(Boolean)
    .sort((a, b) => cx(a) - cx(b)) as PositionedNode[];
  if (!children.length) return;

  const px = cx(parent);
  const pBot = bottom(parent);
  const childXs = children.map(cx);
  const minChildTop = Math.min(...children.map(top));
  const ry = railY(pBot, minChildTop, cfg);
  const pid = group.parentId;
  const childGeneration = children[0]?.generation ?? parent.generation + 1;
  const parentColor = fallbackColor ?? ui.generationLine(parent.generation);
  const childColor = fallbackColor ?? ui.generationLine(childGeneration);

  out.push(
    <View key={`s_v_${pid}`} style={bar(px - stroke / 2, pBot, stroke, ry - pBot, parentColor, stroke)} />,
  );

  const railLeft = Math.min(px, ...childXs);
  const railW = Math.max(px, ...childXs) - railLeft;
  out.push(
    <View key={`s_r_${pid}`} style={bar(railLeft, ry - stroke / 2, railW, stroke, childColor, stroke)} />,
  );

  for (const ch of children) {
    const x = cx(ch);
    out.push(
      <View
        key={`s_ch_${pid}_${ch.id}`}
        style={bar(x - stroke / 2, ry, stroke, top(ch) - ry, childColor, stroke)}
      />,
    );
  }
}

function drawSpouseOnly(
  pairs: Array<{ aId: string; bId: string }>,
  drawn: Set<string>,
  nodeById: Record<string, PositionedNode>,
  ctx: Ctx,
): void {
  const { out, stroke, fallbackColor, cfg } = ctx;

  pairs.forEach((pair, idx) => {
    const key = pairKey(pair.aId, pair.bId);
    if (drawn.has(key)) return;

    const a = nodeById[pair.aId];
    const b = nodeById[pair.bId];
    if (!a || !b) return;
    if (a.generation !== b.generation) return;

    const left = cx(a) <= cx(b) ? a : b;
    const right = cx(a) <= cx(b) ? b : a;
    const leftEdge = left.x + left.width;
    const rightEdge = right.x;
    const y = Math.max(bottom(left), bottom(right)) + cfg.spouseLineOffset;
    const spouseColor = fallbackColor ?? ui.generationLine(left.generation);

    out.push(
      <View
        key={`sp_${idx}_${key}`}
        style={bar(leftEdge, y - stroke / 2, rightEdge - leftEdge, stroke, spouseColor, stroke)}
      />,
    );
  });
}

export function EdgeLines({
  edges,
  nodeById,
  spousePairs = [],
  strokeWidth = EDGE_DRAW_CONFIG.strokeWidth,
  color = '#000000',
}: Props) {
  const content = useMemo(() => {
    if (!EDGE_DRAW_CONFIG.enabled) return null;

    const cfg = EDGE_DRAW_CONFIG;
    const { groups, drawnCouples } = buildGroups(edges, spousePairs, nodeById);
    const out: React.ReactNode[] = [];
    const ctx: Ctx = { out, nodeById, stroke: strokeWidth, fallbackColor: color, cfg };

    for (const g of groups) {
      if (g.kind === 'couple') drawCouple(g, ctx);
      else drawSingle(g, ctx);
    }

    drawSpouseOnly(spousePairs, drawnCouples, nodeById, ctx);

    return out;
  }, [edges, nodeById, spousePairs, strokeWidth, color]);

  if (!content?.length) return null;

  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{content}</View>;
}
