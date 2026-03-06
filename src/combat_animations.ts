import {
  GameState, Position, ShootingEffect,
} from './types';

export type ShootingStyle = 
  | 'single'
  | 'rapid'
  | 'beam'
  ;

const ANIMATION_DURATION: Record<ShootingStyle, number> = {
  single: 200,
  rapid:  200,
  beam:   400, // 10 frames × 40ms for glitch beam
};

export function shootingAnimation(state: GameState, fromPosition: Position, targetPosition: Position, shootingStyle: ShootingStyle) {
  const effects: ShootingEffect[] = [];

  if (shootingStyle === 'rapid') {
    for (let i = 0; i < 3; i++) {
      effects.push({ from: { ...fromPosition }, to: { ...targetPosition }, style: 'single', animationFrame: i });
    }
  } else {
    effects.push({ from: { ...fromPosition }, to: { ...targetPosition }, style: shootingStyle, animationFrame: 0 });
  }

  state.animation = {
    isAnimating: true,
    startTime: performance.now(),
    duration: ANIMATION_DURATION[shootingStyle],
    effects,
  };
}