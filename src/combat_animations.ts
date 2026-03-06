import {
  GameState, Position,
} from './types';

export type ShootingStyle = 
  | 'single'
  | 'rapid'
  | 'beam'
  ;

export function shootingAnimation(state: GameState, fromPosition: Position, targetPosition: Position, shootingStyle: ShootingStyle) {
  console.log('shoots', state, fromPosition, targetPosition, shootingStyle);
  return null;
}