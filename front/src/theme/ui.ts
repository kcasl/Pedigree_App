/** 앱 전역 UI 토큰 — 색·굵기·그림자 */
export const ui = {
  generationPalette: ['#EEF4FF', '#F2EEFF', '#FDEFFA', '#ECF8F2'] as const,
  color: {
    text: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#64748b',
    label: '#334155',
    border: '#cbd5e1',
    borderLight: '#e2e8f0',
    surface: '#ffffff',
    surfaceMuted: '#f8fafc',
    badgeBg: '#f1f5f9',
    canvas: '#f2e3c7',
    accent: '#2563eb',
    accentDark: '#1d4ed8',
    accentBg: '#eff6ff',
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
