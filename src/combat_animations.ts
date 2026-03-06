import {
  GameState, Position, ShootingEffect,
} from './types';

export type ShootingStyle = 
  | 'single'
  | 'rapid'
  | 'beam'
  ;

const ANIMATION_DURATION = 200; // 0.2 seconds in ms

export function shootingAnimation(state: GameState, fromPosition: Position, targetPosition: Position, shootingStyle: ShootingStyle) {
  const effects: ShootingEffect[] = [];

  if (shootingStyle === 'rapid') {
    for (let i = 0; i < 3; i++) {
      const effect: ShootingEffect = {
        from: { ...fromPosition },
        to: { ...targetPosition },
        style: 'single',
        animationFrame: i,
      };
      effects.push(effect);
    }
  } else {
    const effect: ShootingEffect = {
      from: { ...fromPosition },
      to: { ...targetPosition },
      style: shootingStyle,
      animationFrame: 0,
    };
    effects.push(effect);
  }

  state.animation = {
    isAnimating: true,
    startTime: performance.now(),
    duration: ANIMATION_DURATION,
    effects,
  };
}