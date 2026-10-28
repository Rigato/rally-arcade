# Rally Arcade

Protótipo de corrida arcade de rally para celular em **portrait**, com controles de toque simples. O carro derrapa, os pisos mudam o grip e cada corrida termina com tempo, três parciais e medalha.

Stack: **Vite + TypeScript estrito + Three.js**, física própria (sem engine), UI em DOM/CSS sobre o canvas.

**Jogue agora:** <https://rigato.github.io/rally-arcade/>

> Status: **MVP completo — M5, com powerups (M5b), controles touch de uma mão, pista A→B e ajustes v6 de hairpin/medalhas/poeira**. O ciclo largada → 3 parciais → chegada → medalha → reinício está fechado. As pistas aleatórias misturam sete tipos de curva, têm setores longos, platôs e chokes; agora cada uma tem um **hairpin extremo** e medalhas recalibradas. O carro está ~15% mais rápido, as áreas de escape freiam/sacodem mais e a poeira sobe um pouco mais. O conjunto está em playtest para calibrar o hairpin extremo e os tempos.

## Screenshots

![Largada com GO](Docs/screenshots/start-go.png)

![Controles touch em jogo](Docs/screenshots/running-controls.png)

![Menu de mão](Docs/screenshots/touch-hand-menu.png)

## Documentação

- [`Docs/Mini GDD - Rally Arcade v2.md`](Docs/Mini%20GDD%20-%20Rally%20Arcade%20v2.md)
- [`Docs/Implementation Plan - Rally Arcade MVP.md`](Docs/Implementation%20Plan%20-%20Rally%20Arcade%20MVP.md)

## O loop

1. O carro começa **parado** em `s = 22 m`; o botão **GO!** central (ou um toque na tela) inicia o cronômetro. Depois disso o carro **acelera sozinho**.
2. Dirigir, derrapar, pular e escolher a linha. Sair da pista custa tempo; a recuperação automática mantém o relógio correndo.
3. A pista é **A→B**, com 4 setores intercalados (floresta → deserto → floresta → deserto). Na pista fixa, as **parciais 1, 2 e 3** ficam em `s = 250`, `500` e `750 m`, com alvos **8,2 / 16,5 / 24,7 s**. Nas pistas aleatórias os setores têm **340–470 m** e as parciais ficam em 25/50/75% do traçado, no ritmo do ouro.
4. Na pista fixa, ao cruzar a faixa em `s ≈ 1093 m`, o relógio para, o carro congela e a tela de resultado abre após ~0,5 s. A largada e a chegada ficam em pontos distintos; nas pistas aleatórias a chegada fica no fim do traçado de ~1,5 km.
5. Na pista fixa, a medalha vem do tempo final: **ouro ≤ 36 s**, **prata ≤ 42 s**, **bronze ≤ 48 s**. Sem medalha, o resultado mostra quantos segundos faltaram para o bronze.
6. **CORRER DE NOVO** (ou o botão ↺ / tecla **R**) recoloca o carro na largada em menos de 1 s. O melhor tempo continua no topo do HUD.

## Controles

| Ação | Touch | PC |
| --- | --- | --- |
| Iniciar | GO! central ou toque na tela | Clique no GO / W / ↑ / Enter |
| Acelerar | Automático depois do GO | Automático depois do start |
| Esterçar / derrapar | Segurar ◀ ou ▶ no stack (canto inferior direito por padrão) | A / ← (esquerda), D / → (direita) |
| Frear | Segurar FREIO na base do stack | S / ↓ |
| Frear e virar | ◀F/▶F com um dedo, ou ◀/▶ + FREIO com dois dedos | A/D + S |
| Lado do stack | Menu **MÃO**: DIREITA ou ESQUERDA, persistido | — |
| Freio de mão | Sem botão no touch por enquanto | Espaço |
| Reiniciar | Botão no topo da tela | R |
| Pista | 🎲 NOVA (seed 1–100) / FIXA | Mesmos botões na tela |
| Telemetria (debug) | — | H |
| Pausa | Auto-pause ao trocar de aba | — |

O carro fica parado no READY. O GO libera a largada e liga a auto-aceleração; soltar o freio volta a acelerar. O stack touch tem **5 botões**: a linha de cima é ◀/▶ puro, a linha do meio é **◀F/▶F** (esterço + freio no mesmo dedo) e embaixo fica o **FREIO** largo. Assim dá para frear e virar com um polegar, ou usar dois dedos nos botões puros. O menu **MÃO** acima do stack escolhe o lado (DIREITA/ESQUERDA) e a escolha fica em `localStorage['rally.controls.side.v1']`.

No PC o stack, o gatilho MÃO e o menu não aparecem; o GO mostra “CLIQUE OU ENTER” e o teclado continua funcionando. O freio de mão segue disponível no Espaço, mas não há botão de freio de mão no touch.

Os botões **🎲 NOVA** e **FIXA** no topo trocam entre uma pista procedural aleatória (seed 1–100) e a pista fixa A→B.

## HUD e resultado

- **Topo esquerdo:** melhor tempo da pista (`MELHOR --:--.---` até a primeira corrida).
- **Topo central:** cronômetro `mm:ss.mmm`, parado em READY e FINISHED.
- **Topo direito:** reinício imediato.
- **Botões de pista:** `🎲 NOVA` gera uma seed procedural 1–100; `FIXA` volta à pista A→B.
- **Barra de progresso:** distância percorrida, um marcador por parcial (250/500/750 m) e ponto do carro no fim do preenchimento.
- **GO!:** overlay central no READY; inicia a corrida e a auto-aceleração.
- **Controles touch:** stack de 5 botões no canto inferior direito — ◀/▶ puros, ◀F/▶F com freio e FREIO largo embaixo. O menu **MÃO** escolhe o lado; no PC todo o stack fica oculto.
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

- **4 pickups** autorados em `src/track/track01.ts`, distribuídos pela pista: turbo em `s ≈ 426,7`, grip em `s ≈ 475,7`, turbo em `s ≈ 800,6` e turbo em `s ≈ 1048,5`; nenhum imediatamente antes das rampas. Nas pistas aleatórias são **6–8 pickups**.
- Pegar o mesmo tipo de novo **renova o timer** (nunca acumula); **tipos diferentes coexistem**. Cada pickup some ao ser coletado e volta no reinício (R), no retry e no teleporte `?s=`.
- A coleta só vale em **RUNNING**; READY, RECOVERING e FINISHED não coletam. Na recuperação os timers ficam congelados.
- O turbo não altera saltos, colisão, freio ou rampa: só velocidade, aceleração e o FOV da câmera (`CAMERA_TUNING.turboFovBoost`). O grip extra age só no grip lateral.

## Carro, escape e poeira

- **Velocidade/aceleração/freio:** 39,1 m/s (~141 km/h), 11,5 m/s² e 13,8 m/s² — +15% sobre a versão anterior.
- **Fora de pista:** o carro fica limitado a **65%** da velocidade máxima na floresta e **62%** no deserto, com freio extra de 10/8 m/s². Na prática, entrar a 141 km/h estabiliza em ~91/87 km/h em ~2,1 s, sem corte instantâneo.
- **Trepidação:** o rumble da câmera sobe para 0,15 m e é escalado pelo `bump` do piso; fora de pista sacode mais.
- **Poeira:** pool de **80 partículas** emitidas nas rodas traseiras quando há slip (>5°) e velocidade (>5 m/s), a até **34/s**. A quantidade cresce com o slip (pouca derrapagem = quase nada; 27°+ = poeira clara), as partículas sobem **1,0–2,0 m/s**, a cor segue o piso e tudo some em menos de 1 s.
- O tuning salvo usa `localStorage['rally.tuning.v4']`; valores antigos da v3 são ignorados.

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
│   └── Input.ts         # GO, auto-throttle, 5 botões, teclado e multi-touch
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

Na raiz, `scripts/` reúne `validate-track.ts`, `select-track.ts`, `freeze-track.ts`, `proc-validate.ts` e `proc-diversity.ts`. A pista fixa foi congelada da seed 91 do gerador legado com `select-track.ts` e `freeze-track.ts`.

## Protótipo procedural

O gerador de pistas por seed fica em `src/track/procedural/`:

- `generateProceduralTrack(seed)` usa uma **gramática de segmentos**: retas de ~20–90 m e curvas sorteadas entre **sete categorias** — longa (R≈70–110 m), média (45–65 m), curta (28–38 m), cotovelo (26–31 m), **hairpin normal (20–23 m)**, **hairpin extremo (14–15 m)** e **mudança de rota / kink (R≈140–220 m, sweep 6–15°)**. Cada seed usa **exatamente 1 hairpin extremo**, 0–1 normal, 1–3 kinks e pelo menos quatro categorias, com curvas nos dois sentidos.
- O **hairpin extremo** tem sweep 170–185°, largura local **5,2–6,2 m**, aproximação reta de 45–60 m e saída de 35–60 m; fica a ≥80 m da largada/chegada. É o ponto que exige frear de verdade.
- Candidatos são rejeitados se trechos não vizinhos ficarem a menos de **40 m** entre centros (as duas pernas do próprio hairpin extremo são a exceção), se o layout passar de ~650×650 m ou se a chegada ficar a menos de **100 m** da largada. O resultado é sempre uma pista **A→B**.
- **Setores mais longos:** cada um tem **340–470 m** (35–65% acima dos ~250–290 m anteriores) e a pista total fica em **1518–1625 m**. São 6–8 powerups, 50–75 obstáculos e 1–2 rampas.
- **Relevo:** amplitudes ~20% maiores, com 2–3 **platôs planos** de 70–150 m cobrindo 20–25% da pista.
- **Largura agressiva:** base 10,5–12 m, trechos largos 13–15 m, longos estreitos 5,5–7 m e **chokes de 4,6–5,4 m**. O sampler (`Track.ts`) aceita **4,4–15,2 m**.
- **Medalhas procedurais:** ouro **36 s em 1.300 m → 46 s em 1.650 m** (linear, clampado); nas pistas atuais de 1.518–1.625 m fica **42,2–45,3 s**. Prata = ouro + 6 s; bronze = ouro + 12 s. As parciais usam o ritmo do ouro.
- `validateProceduralTrack(def)` usa o mesmo `Track` do jogo e valida comprimento, raio mínimo, autointerseção, separação, rampas, splits, powerups e obstáculos.
- `generateLegacyProceduralTrack(seed)` preserva a serpentina antiga de 4 pernas, usada para reproduzir a pista fixa `track01-v3`. As pistas aleatórias usam o gerador novo.

Validação atual: **100/100 seeds** (1–100), comprimento **1517,7–1625,3 m**, setores ~**354–438 m**, raio mínimo **13,6–14,8 m**, largura **4,6–15,0 m**, separação mínima **40,0 m**, A→B **108,2–788,0 m**, 20–25% de pista plana e exatamente **1 hairpin extremo por seed**.

![12 seeds procedurais](Docs/screenshots/proc-variety.png)

![Hairpin extremo](Docs/screenshots/extreme-hairpin.png)

![Choke point estreito](Docs/screenshots/track-choke.png)

![Trecho largo](Docs/screenshots/track-wide.png)

Teste as seeds e gere um preview top-down ou um contact sheet:

```bash
npx --yes tsx scripts/proc-validate.ts
npx --yes tsx scripts/proc-validate.ts --count 100 --start 1
npx --yes tsx scripts/proc-validate.ts --svg /tmp/opencode/pista.svg
npx --yes tsx scripts/proc-diversity.ts --count 12 --svg /tmp/opencode/proc-sheet.svg
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
- **Controles v3** (substituída): GO, auto-aceleração, 3 botões touch e teclado invertido corretamente.
- **Controles v4** (em playtest): 5 botões touch com combos ◀F/▶F, menu MÃO à esquerda/direita e stack oculto no PC.
- **Pista A→B** (em playtest): seed 91 congelada, 1096,8 m, 4 setores, raio mínimo 30,2 m, 2 rampas baixas, 3 parciais e 50 obstáculos.
- **Física v5** (em playtest): aceleração/velocidade/freio +15%, off-road com cap de 65%/62% e desaceleração suave, rumble mais forte.
- **Poeira v6** (em playtest): pool 80, emissão ~+21%, começa em 5° e sobe mais (1,0–2,0 m/s).
- **Hairpin extremo v6** (em playtest): 1 por pista, 14–15 m, aproximação/saída retas e largura 5,2–6,2 m.
- **Medalhas v6** (em playtest): fixa 36/42/48 s; procedurais 42,2–45,3 s de ouro, com parciais no ritmo do ouro.
- **Protótipo procedural v4** (em playtest): sete tipos de curva (incluindo hairpin extremo e kink), setores de 340–470 m, platôs e chokes de 4,6 m; 100/100 seeds.

Fora do MVP: progressão, loja, menu/editor de pistas procedurais, áudio e cenários extras.
