# Rally Arcade

Protótipo de corrida arcade de rally para celular em **portrait**, jogável com uma mão só. O carro derrapa, os pisos mudam o grip e cada corrida termina com uma medalha pelo tempo.

Stack: **Vite + TypeScript estrito + Three.js**, física própria (sem engine), UI em DOM/CSS sobre o canvas.

> Status: **M0 — Fundação**. Nesta etapa existem apenas a cena, o chão provisório, o carro placeholder, a câmera de perseguição provisória, o loop fixo de 120 Hz e o HUD com cronômetro zerado e botão de reinício.

## Documentação

- [`Docs/Mini GDD - Rally Arcade v2.md`](Docs/Mini%20GDD%20-%20Rally%20Arcade%20v2.md)
- [`Docs/Implementation Plan - Rally Arcade MVP.md`](Docs/Implementation%20Plan%20-%20Rally%20Arcade%20MVP.md)

## Controles previstos (MVP)

| Ação | Touch (uma mão) | PC |
| --- | --- | --- |
| Acelerar | Tocar e segurar na tela | Mouse pressionado |
| Esterçar / derrapar | Arrastar o dedo na horizontal | Mover o mouse / WASD e setas |
| Frear | Soltar o dedo (rampa progressiva) | Soltar o mouse / S |
| Freio de mão | Arrastar além do limite de esterço | Espaço |
| Reiniciar | Botão no topo da tela | R |

O esquema touch será implementado no M1. Nesta etapa a dica **TOQUE E ARRASTE** é apenas visual.

## Comandos

```bash
npm install       # instala dependências
npm run dev       # servidor de desenvolvimento com --host
npm run build     # typecheck + build de produção em dist/
npm run preview   # serve o build localmente
npm run typecheck # apenas TypeScript
```

Requer Node 24+.

## Estrutura

```text
src/
├── main.ts              # bootstrap do Game
├── style.css            # reset mobile, HUD e safe areas
├── game/
│   ├── Game.ts          # renderer, cena, luzes, chão, loop e orquestração
│   ├── config.ts        # tuning inicial tipado (seção 4 do plano)
│   └── types.ts         # tipos compartilhados (estado, tuning, pista)
├── core/
│   ├── Loop.ts          # passo fixo 120 Hz + acumulador + alpha
│   └── math.ts          # clamp, lerp e suavização exponencial
├── car/
│   └── CarView.ts       # carro placeholder low poly + sombra blob
├── camera/
│   └── ChaseCamera.ts   # câmera de perseguição provisória
├── input/               # reservado para M1: touch, mouse e teclado
├── track/               # reservado para M3: spline, malha e sampler
├── world/               # reservado para M3: cenário e ambiente
└── ui/
    └── Hud.ts           # cronômetro, reinício e dica
```

Os demais módulos de `game/`, `car/`, `camera/`, `core/` e `ui/` descritos no plano entram nos marcos seguintes.

## Deploy

O workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) publica o build no GitHub Pages a cada push na `main` (ou manualmente via `workflow_dispatch`). No GitHub, configure **Settings → Pages → Source: GitHub Actions**.

URL esperada: <https://rigato.github.io/rally-arcade/>

O `vite.config.ts` usa `base: './'` para funcionar no subcaminho do Pages.

## Roadmap

- **M0 — Fundação** (atual): Vite + TS + Three, canvas portrait, loop fixo, chão liso, câmera provisória, HUD shell, Actions/Pages.
- **M1 — Carro e feeling**: física de derrapagem, touch/mouse/teclado, freio, freio de mão, câmera e carro low poly com rodas.
- **M2 — Pisos**: cascalho e areia.
- **M3 — Pista**: spline, elevação, largura, saltos, cenário.
- **M4 — Fora da pista**: terreno acidentado, obstáculos, colisão e recuperação.
- **M5 — Corrida completa**: powerups, cronômetro, parciais, medalhas, resultado e reinício.
