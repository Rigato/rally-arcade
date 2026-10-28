# Rally Arcade

Protótipo de corrida arcade de rally para celular em **portrait**, com controles de toque simples. O carro derrapa, os pisos mudam o grip e cada corrida termina com tempo, três parciais e medalha.

Stack: **Vite + TypeScript estrito + Three.js**, física própria (sem engine), UI em DOM/CSS sobre o canvas.

**Jogue agora:** <https://rigato.github.io/rally-arcade/>

> Status: **MVP completo — M5, com powerups (M5b), controles GO/botões e pista A→B**. O ciclo largada → 3 parciais → chegada → medalha → reinício está fechado. A pista fixa agora é uma seed procedural curada (1096,8 m), e o carro tem física de derrapagem mais solta; o conjunto está em playtest para calibrar tempos e feeling.

## Screenshots

![Largada com GO](Docs/screenshots/start-go.png)

![Controles em jogo](Docs/screenshots/running-controls.png)

## Documentação

- [`Docs/Mini GDD - Rally Arcade v2.md`](Docs/Mini%20GDD%20-%20Rally%20Arcade%20v2.md)
- [`Docs/Implementation Plan - Rally Arcade MVP.md`](Docs/Implementation%20Plan%20-%20Rally%20Arcade%20MVP.md)

## O loop

1. O carro começa **parado** em `s = 22 m`; o botão **GO!** central (ou um toque na tela) inicia o cronômetro. Depois disso o carro **acelera sozinho**.
2. Dirigir, derrapar, pular e escolher a linha. Sair da pista custa tempo; a recuperação automática mantém o relógio correndo.
3. A pista é **A→B**, com 4 setores intercalados (floresta → deserto → floresta → deserto). Em `s = 250`, `500` e `750 m` aparecem as **parciais 1, 2 e 3**, com tempo e diferença contra os alvos provisórios (13,9 s / 27,8 s / 41,7 s).
4. Ao cruzar a faixa em `s ≈ 1093 m`, o relógio para, o carro congela e a tela de resultado abre após ~0,5 s. A largada e a chegada ficam em pontos distintos.
5. A medalha vem do tempo final: **ouro ≤ 59,3 s**, **prata ≤ 67,6 s**, **bronze ≤ 77,1 s**. Sem medalha, o resultado mostra quantos segundos faltaram para o bronze.
6. **CORRER DE NOVO** (ou o botão ↺ / tecla **R**) recoloca o carro na largada em menos de 1 s. O melhor tempo continua no topo do HUD.

## Controles

| Ação | Touch | PC |
| --- | --- | --- |
| Iniciar | GO! central ou toque na tela | W / ↑ / Enter |
| Acelerar | Automático depois do GO | Automático depois do start |
| Esterçar / derrapar | Segurar ◀ ou ▶ (canto inferior esquerdo) | A / ← (esquerda), D / → (direita) |
| Frear | Segurar FREIO (canto inferior direito) | S / ↓ |
| Frear e virar | Dois dedos: ◀/▶ + FREIO | A/D + S |
| Freio de mão | Sem botão no touch por enquanto | Espaço |
| Reiniciar | Botão no topo da tela | R |
| Pista | 🎲 NOVA (seed 1–100) / FIXA | Mesmos botões na tela |
| Telemetria (debug) | — | H |
| Pausa | Auto-pause ao trocar de aba | — |

O carro fica parado no READY. O GO libera a largada e liga a auto-aceleração; soltar o freio volta a acelerar. Segurar ◀/▶ vira na direção da tela; com dois dedos é possível frear e virar ao mesmo tempo. O freio de mão continua disponível no teclado (Espaço), mas não há um quarto botão no touch.

Os botões **🎲 NOVA** e **FIXA** no topo trocam entre uma pista procedural aleatória (seed 1–100) e a pista fixa A→B.

## HUD e resultado

- **Topo esquerdo:** melhor tempo da pista (`MELHOR --:--.---` até a primeira corrida).
- **Topo central:** cronômetro `mm:ss.mmm`, parado em READY e FINISHED.
- **Topo direito:** reinício imediato.
- **Botões de pista:** `🎲 NOVA` gera uma seed procedural 1–100; `FIXA` volta à pista A→B.
- **Barra de progresso:** distância percorrida, um marcador por parcial (250/500/750 m) e ponto do carro no fim do preenchimento.
- **GO!:** overlay central no READY; inicia a corrida e a auto-aceleração.
- **Controles touch:** ◀/▶ no canto inferior esquerdo, FREIO no canto inferior direito; aparecem depois do GO.
- **Banner de parcial:** nome, tempo e delta (`+0,42` em vermelho, `-0,31` em verde) por ~2,5 s.
- **Resultado:** tempo total, medalha, tempos-alvo, as **3 parciais** (tempo e delta), melhor tempo, selo `NOVO RECORDE` quando aplicável e o botão grande **CORRER DE NOVO**. O overlay escuro só intercepta toque no painel/botão; escondido, não bloqueia o canvas.
- **Powerups (topo esquerdo):** chips com nome, tempo restante e barra de duração, atualizados a ~10 Hz. Ao coletar, o nome do powerup sobe e some em ~0,75 s.

O melhor tempo fica em `localStorage['rally.best.track01-v3.v1']` (uma chave por `track.def.id`). Se o storage estiver bloqueado, o recorde vale só para a sessão e o jogo continua normalmente.

## Powerups

Dois tipos no MVP, com ativação imediata:

| Powerup | Efeito | Duração | Pickup |
| --- | --- | --- | --- |
| **Turbo** | velocidade máxima e aceleração × 1,3 + boost de FOV | 2,0 s | anel laranja |
| **Grip extra** | grip lateral × 1,8 | 10 s | anel azul |

- **4 pickups** autorados em `src/track/track01.ts`, distribuídos pela pista: turbo em `s ≈ 426,7`, grip em `s ≈ 475,7`, turbo em `s ≈ 800,6` e turbo em `s ≈ 1048,5`; nenhum imediatamente antes das rampas.
- Pegar o mesmo tipo de novo **renova o timer** (nunca acumula); **tipos diferentes coexistem**. Cada pickup some ao ser coletado e volta no reinício (R), no retry e no teleporte `?s=`.
- A coleta só vale em **RUNNING**; READY, RECOVERING e FINISHED não coletam. Na recuperação os timers ficam congelados.
- O turbo não altera saltos, colisão, freio ou rampa: só velocidade, aceleração e o FOV da câmera (`CAMERA_TUNING.turboFovBoost`). O grip extra age só no grip lateral.

## Painel de ajuste e debug

O debug é opt-in: **`?debug=1`** ou **`#debug`**. Sem isso, a telemetria e o painel de tuning não aparecem.

```text
https://rigato.github.io/rally-arcade/?debug=1
https://rigato.github.io/rally-arcade/?debug=1&s=780
https://rigato.github.io/rally-arcade/?debug=1&track=proc&seed=1
```

- **`?s=<metros>`** teleporta o carro para o centro da pista e volta a corrida para READY, preservando o melhor tempo. É útil para revisar a pista e testar a chegada.
- **`?track=proc&seed=N`** carrega uma pista procedural determinística, inclusive sem `?debug=1`; **FIXA** volta à pista A→B.
- **H** alterna a telemetria no desktop; no painel, a pasta **Debug** também controla piso forçado, colisores, reposicionar e ir para um `s`.
- O painel cobre **Carro**, **Carroceria**, **Câmera**, **Input**, **Pisos**, **Powerups / Corrida** e **Debug**. O Input agora só tem as suavizações de esterço/freio; os parâmetros de derrapagem ficam em **Carro**.
- Todo ajuste vale na hora porque física, câmera, input e corrida leem os mesmos objetos mutáveis de `src/game/config.ts`.
- Alterações são salvas em `localStorage['rally.tuning.v3']` com debounce de ~200 ms. **Resetar tuning** volta aos defaults e apaga a chave.
- **Copiar JSON** exporta o tuning atual; se o clipboard for bloqueado, abre um textarea para copiar manualmente.

## Comandos

```bash
npm install       # instala dependências
npm run dev       # servidor de desenvolvimento com --host
npm run build     # typecheck + build de produção em dist/
npm run preview   # serve o build localmente
npm run typecheck # apenas TypeScript
npm run validate:track # valida comprimento, raio, rampas, parciais, powerups e obstáculos
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
│   └── Input.ts         # GO, auto-throttle, 3 botões, teclado e multi-touch
├── track/
│   ├── track01.ts       # pista fixa A→B (seed 91, ~1097 m, 4 setores)
│   ├── Track.ts         # spline, sampler, altura e validação
│   ├── TrackMesh.ts     # pista, ombros, placas e portais
│   ├── Gates.ts         # portais em cada troca de setor + chegada
│   ├── zones.ts         # mistura de paletas nos limites das zonas
│   ├── Obstacles.ts     # obstáculos sólidos e colisão
│   ├── Powerups.ts      # pickups de turbo/grip, timers e efeitos na física
│   └── procedural/      # gerador por seed e validação do protótipo
├── world/
│   ├── Scenery.ts       # cenário instanciado por setor (floresta/deserto)
│   └── Environment.ts   # céu, névoa e luz multi-zona
└── ui/
    ├── Hud.ts           # cronômetro, melhor, progresso, parcial, recuperação e debug
    ├── Results.ts       # overlay de chegada, medalha e retry
    ├── format.ts        # formatação de tempo e delta
    └── TuningPanel.ts   # lil-gui em ?debug=1
```

Na raiz, `scripts/` reúne `validate-track.ts`, `select-track.ts`, `freeze-track.ts` e `proc-validate.ts`. A pista fixa foi congelada da seed procedural com `select-track.ts` e `freeze-track.ts`.

## Protótipo procedural

A base do gerador de pistas por seed está em `src/track/procedural/`:

- `generateProceduralTrack(seed)` monta um `TrackDef` completo com 4 zonas alternadas, 3 parciais, largura/elevação variadas, 1–2 rampas baixas, powerups na pista e obstáculos fora dela.
- `validateProceduralTrack(def)` usa o mesmo `Track` do jogo e valida comprimento, raio mínimo, autointerseção, rampas, splits, powerups e obstáculos.

Teste 20 seeds e gere um preview top-down:

```bash
npx --yes tsx scripts/proc-validate.ts
npx --yes tsx scripts/proc-validate.ts --count 100 --start 1
npx --yes tsx scripts/proc-validate.ts --svg /tmp/opencode/pista.svg
```

A integração está pronta: `?track=proc&seed=1` (com ou sem `?debug=1`) carrega a pista gerada com os mesmos sistemas de cenário, splits, powerups e obstáculos. Na tela, **🎲 NOVA** sorteia uma seed 1–100 e **FIXA** volta à pista A→B. Ainda não há menu para escolher seed nem editor de pista; o objetivo é validar o gerador.

## Deploy

O workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) publica o build no GitHub Pages a cada push na `main` (ou manualmente via `workflow_dispatch`). O Pages já está configurado com **Source: GitHub Actions**.

URL publicada: <https://rigato.github.io/rally-arcade/>

O `vite.config.ts` usa `base: './'` para funcionar no subcaminho do Pages. O deploy é validado com HTTP 200 e smoke test live nas pistas fixa A→B e procedural.

## Roadmap

- **M0 — Fundação** (concluído): Vite + TS + Three, canvas portrait, loop fixo, HUD shell, Actions/Pages.
- **M1 — Carro e feeling** (concluído): física de derrapagem, touch/mouse/teclado, freio, freio de mão, câmera, carro low poly e painel de tuning.
- **M2 — Pisos** (concluído): cascalho e areia, troca por zona.
- **M3 — Pista** (concluído): spline, elevação, largura, saltos, cenário e portais.
- **M4 — Fora da pista** (concluído): terreno acidentado, obstáculos, colisão e recuperação com penalidade.
- **M5 — Corrida completa** (concluído): cronômetro, distância, parcial, medalhas, resultado, melhor tempo persistido e reinício instantâneo.
- **M5b — Powerups** (concluído): pickups 3D de turbo e grip extra, efeitos reais na física, chips com timers no HUD e restauração no reinício/teleporte.
- **Pista v2** (substituída): circuito fechado de ~1035 m, 4 setores, curvas de raio ≥ 36 m e 3 parciais; reprovado no playtest por ser fechado.
- **Controles v3** (em playtest): GO, auto-aceleração, 3 botões touch, teclado invertido corretamente, carro mais solto e derrapagem visível.
- **Pista A→B** (em playtest): seed 91 congelada, 1096,8 m, 4 setores, raio mínimo 30,2 m, 2 rampas baixas, 3 parciais e 50 obstáculos.
- **Protótipo procedural** (em validação): gerador determinístico por seed, carregável por `?track=proc&seed=N` e botão 🎲 NOVA na tela.

Fora do MVP: progressão, loja, menu/editor de pistas procedurais, áudio e cenários extras.
