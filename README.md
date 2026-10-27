# Rally Arcade

Protótipo de corrida arcade de rally para celular em **portrait**, jogável com uma mão só. O carro derrapa, os pisos mudam o grip e cada corrida termina com tempo, parcial e medalha.

Stack: **Vite + TypeScript estrito + Three.js**, física própria (sem engine), UI em DOM/CSS sobre o canvas.

**Jogue agora:** <https://rigato.github.io/rally-arcade/>

> Status: **MVP completo — M5, com powerups (M5b)**. O ciclo largada → parcial → chegada → medalha → reinício está fechado, com cronômetro, barra de progresso, melhor tempo persistido, tela de resultado e pickups de turbo/grip. Falta apenas o playtest em celular real e a calibração final dos tempos.

## Screenshot

![Largada na floresta](Docs/screenshots/forest-start.png)

## Documentação

- [`Docs/Mini GDD - Rally Arcade v2.md`](Docs/Mini%20GDD%20-%20Rally%20Arcade%20v2.md)
- [`Docs/Implementation Plan - Rally Arcade MVP.md`](Docs/Implementation%20Plan%20-%20Rally%20Arcade%20MVP.md)

## O loop

1. O carro larga em `s = 22 m` com o cronômetro zerado. O **primeiro toque** (ou tecla de acelerar) inicia a corrida.
2. Dirigir, derrapar, pular e escolher a linha. Sair da pista custa tempo; a recuperação automática mantém o relógio correndo.
3. Em `s = 300 m` (troca de floresta para deserto) aparece a **parcial 1**, com tempo e diferença contra o alvo de 21 s. A diferença não aparece em nenhum outro lugar durante o trecho.
4. Ao cruzar a faixa em `s ≈ 796 m`, o relógio para, o carro congela e a tela de resultado abre após ~0,5 s.
5. A medalha vem do tempo final: **ouro ≤ 43 s**, **prata ≤ 49 s**, **bronze ≤ 57 s**. Sem medalha, o resultado mostra quantos segundos faltaram para o bronze.
6. **CORRER DE NOVO** (ou o botão ↺ / tecla **R**) recoloca o carro na largada em menos de 1 s. O melhor tempo continua no topo do HUD.

## Controles

| Ação | Touch (uma mão) | PC |
| --- | --- | --- |
| Acelerar | Tocar e segurar na tela | Mouse pressionado / W / ↑ |
| Esterçar / derrapar | Arrastar o dedo na horizontal (deadzone + curva exponencial) | Mover o mouse / A, D / ←, → |
| Frear | Arrastar o dedo para baixo (novo padrão: freia sem soltar e continua esterçando) | Arrastar o mouse para baixo / S / ↓ |
| Frear soltando | Soltar o dedo aplica a rampa de freio | Soltar o mouse |
| Freio de mão | Arrastar além do limite de esterço (padrão) ou botão dedicado | Espaço |
| Reiniciar | Botão no topo da tela | R |
| Telemetria (debug) | — | H |
| Pausa | Auto-pause ao trocar de aba | — |

O esquema padrão é o **drag2d**: o mesmo dedo acelera ao encostar, esterça no eixo X e freia no eixo Y para baixo. Assim dá para frear e virar ao mesmo tempo sem tirar o dedo. O esquema antigo **release** (soltar para frear) continua disponível no painel de debug, em **Input → Esquema de toque**. O guia visual (anel no ponto de encosto) pode ser desligado em **Input → Guia de toque**.

O freio de mão pode alternar entre **deslocamento** e **botão** no painel de debug. No modo botão, o alvo aparece no canto inferior direito do HUD.

## HUD e resultado

- **Topo esquerdo:** melhor tempo da pista (`MELHOR --:--.---` até a primeira corrida).
- **Topo central:** cronômetro `mm:ss.mmm`, parado em READY e FINISHED.
- **Topo direito:** reinício imediato.
- **Barra de progresso:** distância percorrida em metros, marcador da parcial em `s = 300` e ponto do carro no fim do preenchimento.
- **Banner de parcial:** nome, tempo e delta (`+0,42` em vermelho, `-0,31` em verde) por ~2,5 s.
- **Resultado:** tempo total, medalha, tempos-alvo, parcial, melhor tempo, selo `NOVO RECORDE` quando aplicável e o botão grande **CORRER DE NOVO**. O overlay escuro só intercepta toque no painel/botão; escondido, não bloqueia o canvas.
- **Powerups (canto inferior esquerdo):** chips com nome, tempo restante e barra de duração, atualizados a ~10 Hz. Ao coletar, o nome do powerup sobe e some em ~0,75 s, sem vinheta de impacto.

O melhor tempo fica em `localStorage['rally.best.track01.v1']` (uma chave por `track.def.id`). Se o storage estiver bloqueado, o recorde vale só para a sessão e o jogo continua normalmente.

## Powerups

Dois tipos no MVP, com ativação imediata:

| Powerup | Efeito | Duração | Pickup |
| --- | --- | --- | --- |
| **Turbo** | velocidade máxima e aceleração × 1,3 + boost de FOV | 2,0 s | anel laranja |
| **Grip extra** | grip lateral × 1,8 | 10 s | anel azul |

- **4 pickups autorados** em `src/track/track01.ts`, fora da linha ideal: turbo em `s = 120` (`u = +1,6`), grip em `s = 200` (`u = −1,2`), grip em `s = 440` (`u = +1,2`) e turbo em `s = 600` (`u = −1,6`).
- Pegar o mesmo tipo de novo **renova o timer** (nunca acumula); **tipos diferentes coexistem**. Cada pickup some ao ser coletado e volta no reinício (R), no retry e no teleporte `?s=`.
- A coleta só vale em **RUNNING**; READY, RECOVERING e FINISHED não coletam. Na recuperação os timers ficam congelados.
- O turbo não altera saltos, colisão, freio ou rampa: só velocidade, aceleração e o FOV da câmera (`CAMERA_TUNING.turboFovBoost`). O grip extra age só no grip lateral.

## Painel de ajuste e debug

O debug é opt-in: **`?debug=1`** ou **`#debug`**. Sem isso, a telemetria e o painel de tuning não aparecem.

```text
https://rigato.github.io/rally-arcade/?debug=1
https://rigato.github.io/rally-arcade/?debug=1&s=780
```

- **`?s=<metros>`** teleporta o carro para o centro da pista e volta a corrida para READY, preservando o melhor tempo. É útil para revisar a pista e testar a chegada.
- **H** alterna a telemetria no desktop; no painel, a pasta **Debug** também controla piso forçado, colisores, reposicionar e ir para um `s`.
- O painel cobre **Carro**, **Câmera**, **Input**, **Pisos**, **Powerups / Corrida** e **Debug**. Os tempos-alvo de medalha, o alvo da parcial e os multiplicadores/durações dos powerups são editáveis ao vivo.
- Todo ajuste vale na hora porque física, câmera, input e corrida leem os mesmos objetos mutáveis de `src/game/config.ts`.
- Alterações são salvas em `localStorage['rally.tuning.v2']` com debounce de ~200 ms. **Resetar tuning** volta aos defaults e apaga a chave.
- **Copiar JSON** exporta o tuning atual; se o clipboard for bloqueado, abre um textarea para copiar manualmente.

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
├── style.css            # reset mobile, HUD, progresso, parcial, resultado e safe areas
├── game/
│   ├── Game.ts          # renderer, cena, loop, estados e orquestração da corrida
│   ├── Race.ts          # relógio, parcial, medalhas, melhor tempo e snapshot
│   ├── config.ts        # defaults tipados de tuning (objetos mutáveis)
│   ├── types.ts         # tipos compartilhados (estado, tuning, pista)
│   ├── tuningStore.ts   # localStorage, merge, reset e export JSON
│   └── debug.ts         # detecção de ?debug=1 / #debug
├── core/
│   ├── Loop.ts          # passo fixo 120 Hz + acumulador + alpha
│   ├── Spring.ts        # mola/amortecedor da suspensão visual
│   └── math.ts          # clamp, lerp e suavização exponencial
├── car/
│   ├── Car.ts           # física de derrapagem, saltos e pose congelada na chegada
│   └── CarView.ts       # carro low poly + rodas + sombra blob
├── camera/
│   └── ChaseCamera.ts   # câmera de perseguição
├── input/
│   └── Input.ts         # touch, mouse e teclado
├── track/
│   ├── track01.ts       # pista fixa autorada (~800 m)
│   ├── Track.ts         # spline, sampler, altura e validação
│   ├── TrackMesh.ts     # pista, ombros, placas e portais
│   ├── Gates.ts         # portais de cenário e chegada
│   ├── Obstacles.ts     # obstáculos sólidos e colisão
│   └── Powerups.ts      # pickups de turbo/grip, timers e efeitos na física
├── world/
│   ├── Scenery.ts       # floresta e deserto instanciados
│   └── Environment.ts   # céu, névoa e luz por cenário
└── ui/
    ├── Hud.ts           # cronômetro, melhor, progresso, parcial, recuperação e debug
    ├── Results.ts       # overlay de chegada, medalha e retry
    ├── format.ts        # formatação de tempo e delta
    └── TuningPanel.ts   # lil-gui em ?debug=1
```

## Deploy

O workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) publica o build no GitHub Pages a cada push na `main` (ou manualmente via `workflow_dispatch`). O Pages já está configurado com **Source: GitHub Actions**.

URL publicada: <https://rigato.github.io/rally-arcade/>

O `vite.config.ts` usa `base: './'` para funcionar no subcaminho do Pages. O deploy do commit `37cf79e` foi validado com HTTP 200 e smoke test headless.

## Roadmap

- **M0 — Fundação** (concluído): Vite + TS + Three, canvas portrait, loop fixo, HUD shell, Actions/Pages.
- **M1 — Carro e feeling** (concluído): física de derrapagem, touch/mouse/teclado, freio, freio de mão, câmera, carro low poly e painel de tuning.
- **M2 — Pisos** (concluído): cascalho e areia, troca por zona.
- **M3 — Pista** (concluído): spline, elevação, largura, saltos, cenário e portais.
- **M4 — Fora da pista** (concluído): terreno acidentado, obstáculos, colisão e recuperação com penalidade.
- **M5 — Corrida completa** (concluído): cronômetro, distância, parcial, medalhas, resultado, melhor tempo persistido e reinício instantâneo.
- **M5b — Powerups** (concluído): pickups 3D de turbo e grip extra, efeitos reais na física, chips com timers no HUD e restauração no reinício/teleporte.

Fora do MVP: progressão, loja, pista procedural, áudio e cenários extras.
