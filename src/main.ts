import './style.css';
import { Game } from './game/Game';
import { loadTuning } from './game/tuningStore';

// Antes de instanciar o Game: aplica overrides do localStorage sobre os
// objetos mutáveis de config.ts, mantendo as mesmas referências.
loadTuning();

const app = document.querySelector<HTMLElement>('#app');
const hud = document.querySelector<HTMLElement>('#hud');

if (!app || !hud) {
  throw new Error('Não foi possível encontrar os contêineres #app e #hud.');
}

const game = new Game(app, hud);
game.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}
