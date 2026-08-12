import type { StoredDeck } from './backend/types';

/**
 * 첫 실행 시 바로 대전해 볼 수 있게 준비한 예시 덱.
 * GDD §7.2의 전략 축(느린 고화력 vs 빠른 저스펙)을 양 끝과 중간으로 하나씩 보여 준다.
 */
export const PRESET_DECKS: StoredDeck[] = [
  {
    id: 'preset-balanced',
    name: '균형 편성',
    pieces: [
      { baseId: 'guard', skillId: 'cleave' },
      { baseId: 'lancer', skillId: 'pierce' },
      { baseId: 'ranger', skillId: 'bolt' },
      { baseId: 'acolyte', skillId: 'hex' },
      { baseId: 'rider', skillId: 'cleave' },
    ],
  },
  {
    id: 'preset-swarm',
    name: '속공 6기물',
    pieces: [
      { baseId: 'lancer', skillId: 'cleave' },
      { baseId: 'lancer', skillId: 'cleave' },
      { baseId: 'lancer', skillId: 'cleave' },
      { baseId: 'lancer', skillId: 'cleave' },
      { baseId: 'lancer', skillId: 'cleave' },
      { baseId: 'lancer', skillId: 'cleave' },
    ],
  },
  {
    id: 'preset-heavy',
    name: '중장 4기물',
    pieces: [
      { baseId: 'warlord', skillId: 'smite' },
      { baseId: 'rider', skillId: 'smite' },
      { baseId: 'guard', skillId: 'cleave' },
      { baseId: 'guard', skillId: 'cleave' },
    ],
  },
  {
    id: 'preset-support',
    name: '지원 편성 (신규)',
    pieces: [
      { baseId: 'paladin', skillId: 'mend' }, // 아군 치유 오라 + 응급처치 (5+2=7)
      { baseId: 'acolyte', skillId: 'heal' }, // 3+3=6
      { baseId: 'pyromancer', skillId: 'scorch' }, // 화상 부여, 자신은 화상 면역 (4+3=7)
      { baseId: 'shaman', skillId: 'frostbite' }, // 빙결 부여, 자신은 빙결 면역 (4+3=7)
    ],
  },
];
