# Rally Arcade

Protótipo de corrida arcade de rally para celular em **portrait**, jogável com uma mão só. O carro derrapa, os pisos mudam o grip e cada corrida termina com uma medalha pelo tempo.

Stack: **Vite + TypeScript estrito + Three.js**, física própria (sem engine), UI em DOM/CSS sobre o canvas.

> Status: **M1b — Carro, feeling e painel de ajuste**. Já existem física de derrapagem, touch/mouse/teclado, freio de mão, câmera de perseguição, carro low poly com suspensão visual, HUD com cronômetro/telemetria e painel de tuning persistente (`?debug=1`).

## Documentação

- [`Docs/Mini GDD - Rally Arcade v2.md`](Docs/Mini%20GDD%20-%20Rally%20Arcade%20v2.md)
- [`Docs/Implementation Plan - Rally Arcade MVP.md`](Docs/Implementation%20Plan%20-%20Rally%20Arcade%20MVP.md)

## Controles previstos (MVP)

| Ação | Touch (uma mão) | PC |
| --- | --- | --- |
| Acelerar | Tocar e segurar na tela | Mouse pressionado |
| Esterçar / derrapar | Arrastar o dedo na horizontal | Mover o mouse / WASD e setas |
| Frear | Soltar o dedo (rampa progressiva) | Soltar o mouse / S |
| Freio de mão | Arrastar além do limite de esterço (padrão) ou botão dedicado | Espaço |
| Reiniciar | Botão no topo da tela | R |
| Telemetria (debug) | — | H |
| Pausa | Auto-pause ao trocar de aba | — |

O freio de mão pode alternar entre **deslocamento** e **botão** no painel de debug. No modo botão, o alvo aparece no canto inferior direito do HUD.

## Painel de ajuste e debug

O painel só existe quando a URL pede debug: **`?debug=1`** ou **`#debug`**. Em produção normal (`/`) nada é renderizado e a telemetria fica oculta.

```text
https://rigato.github.io/rally-arcade/?debug=1
```

Pastas disponíveis:

- **Carro** — aceleração, velocidade máxima, arrasto, rolamento, guinada, resposta de esterço, freio/rampa, freio de mão e gravidade no ar.
- **Câmera** — distância, altura, look-ahead, lags, FOV e boosts.
- **Input** — lock de esterço, deadzone, suavização, limiar do freio de mão e modo (`drag`/`button`).
- **Pisos** — grip, aceleração, arrasto, bump e multiplicador de esterço de cascalho, areia e fora de pista.
- **Powerups / Corrida** — durações/intensidades e tempos-alvo de medalha (ainda não usados no M1b, já editáveis).
- **Debug** — telemetria, piso forçado (`auto`, cascalho, areia, fora), reposicionar carro, copiar JSON e resetar tuning.

Comportamento:

- O painel abre no canto inferior esquerdo, sobre o jogo, já expandido; as pastas começam fechadas para não cobrir a direção. Toque no título do painel para recolhê-lo.
- Todo ajuste vale **ao vivo** — física, câmera e input leem os mesmos objetos mutáveis de `src/game/config.ts`.
- Alterações são salvas em `localStorage['rally.tuning.v1']` com debounce de ~200 ms. Recarregar a página preserva os valores. Em modo privado/storage bloqueado, o jogo continua funcionando só em memória.
- **Resetar tuning** restaura os defaults e apaga a chave salva.
- **Copiar JSON** exporta o tuning atual; se o clipboard for bloqueado, abre um textarea para copiar manualmente.
- O piso forçado do seletor vale na hora. `auto` ainda resolve para cascalho até o M2 implementar as zonas da pista.
- Toques e teclas dentro do painel não dirigem o carro nem iniciam o cronômetro; só o canvas recebe input de jogo.
- A telemetria mostra estado, FPS (média móvel), piso, CHÃO/AR, velocidade, derrape, guinada, input e posição. A tecla **H** alterna a telemetria no desktop.

### Fluxo de tuning no celular

1. Abra a URL do Pages com `?debug=1` no Chrome Android ou Safari iOS.
2. Recolha o painel e dirija para sentir o baseline.
3. Abra uma pasta, ajuste um parâmetro, recolha o painel e teste de novo. O valor já está ativo e salvo.
4. Ao encontrar um setup bom, use **Copiar JSON** e envie o conteúdo para o desenvolvimento (issue, chat ou arquivo).
5. Antes de fechar o marco, congele os valores aprovados em `src/game/config.ts` e rode `npm run build`.

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
├── main.ts              # bootstrap: loadTuning() antes do Game
├── style.css            # reset mobile, HUD, painel e safe areas
├── game/
│   ├── Game.ts          # renderer, cena, loop, piso forçado e orquestração
│   ├── config.ts        # defaults tipados de tuning (objetos mutáveis)
│   ├── types.ts         # tipos compartilhados (estado, tuning, pista)
│   ├── tuningStore.ts   # localStorage, merge, reset e export JSON
│   └── debug.ts         # detecção de ?debug=1 / #debug
├── core/
│   ├── Loop.ts          # passo fixo 120 Hz + acumulador + alpha
│   ├── Spring.ts        # mola/amortecedor da suspensão visual
│   └── math.ts          # clamp, lerp e suavização exponencial
├── car/
│   ├── Car.ts           # física de derrapagem
│   └── CarView.ts       # carro low poly + rodas + sombra blob
├── camera/
│   └── ChaseCamera.ts   # câmera de perseguição
├── input/
│   └── Input.ts         # touch, mouse e teclado
├── track/               # reservado para M3: spline, malha e sampler
├── world/
│   └── Arena.ts         # chão e grade provisórios do M1
└── ui/
    ├── Hud.ts           # cronômetro, reinício, freio de mão e telemetria
    └── TuningPanel.ts   # lil-gui em ?debug=1
```

Os demais módulos de `game/`, `track/` e `world/` descritos no plano entram nos marcos seguintes.

## Deploy

O workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) publica o build no GitHub Pages a cada push na `main` (ou manualmente via `workflow_dispatch`). No GitHub, configure **Settings → Pages → Source: GitHub Actions**.

URL esperada: <https://rigato.github.io/rally-arcade/>

O `vite.config.ts` usa `base: './'` para funcionar no subcaminho do Pages.

## Roadmap

- **M0 — Fundação** (concluído): Vite + TS + Three, canvas portrait, loop fixo, chão liso, câmera provisória, HUD shell, Actions/Pages.
- **M1a — Carro e feeling** (concluído): física de derrapagem, touch/mouse/teclado, freio, freio de mão, câmera e carro low poly com rodas.
- **M1b — Painel e persistência** (atual): lil-gui em `?debug=1`, tuning ao vivo, localStorage, export JSON, telemetria com FPS/piso/CHÃO-AR e piso forçado.
- **M2 — Pisos**: cascalho e areia, troca por zona.
- **M3 — Pista**: spline, elevação, largura, saltos, cenário.
- **M4 — Fora da pista**: terreno acidentado, obstáculos, colisão e recuperação.
- **M5 — Corrida completa**: powerups, cronômetro, parciais, medalhas, resultado e reinício.
