/** 앱 전역 UI 토큰 — 색·굵기·그림자 */
export const ui = {
  generationPalette: ['#D6E8FF', '#DDD0FF', '#F8C8E8', '#B8EBD0'] as const,
  color: {
    text: '#0b1220',
    textSecondary: '#3f4f63',
    textMuted: '#5b6b80',
    label: '#1e293b',
    border: '#94a3b8',
    borderLight: '#cbd5e1',
    surface: '#ffffff',
    surfaceMuted: '#eef2f7',
    badgeBg: '#e8edf4',
    canvas: '#edd9b8',
    accent: '#1d4ed8',
    accentDark: '#1e3a8a',
    accentBg: '#dbeafe',
    danger: '#b91c1c',
    dangerBg: '#fff1f2',
    dangerBorder: '#fecaca',
    overlay: 'rgba(15,23,42,0.38)',
    line: '#000000',
  },
  generationLine(gen: number): string {
    const palette = this.generationPalette;
    const idx = ((gen % palette.length) + palette.length) % palette.length;
    return palette[idx];
  },
  /** 세대(가로줄)별 카드 배경 — 위로 갈수록 밝음 */
  generationSurface(gen: number): string {
    return this.generationLine(gen);
  },
  weight: {
    body: '600' as const,
    label: '700' as const,
    title: '800' as const,
    heading: '900' as const,
  },
  shadow: {
    card: {
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.07,
      shadowRadius: 5,
      elevation: 2,
    },
    float: {
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
  },
} as const;
