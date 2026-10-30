# Handoff — Rally Arcade (Oct 30, 2026)

Documento para abrir uma nova sessão de **plan** ou **implementação** sem reler todo o histórico. **Substitui integralmente o handoff anterior.**

Base do código: **`7f03ab4`** (`docs: update handoff after v3 density pass`). A documentação foi alinhada no commit seguinte.

- **Live:** <https://rigato.github.io/rally-arcade/>
- **Repo:** <https://github.com/Rigato/rally-arcade>
- **Stack:** Vite + TypeScript estrito + Three.js; física própria, UI em DOM/CSS.
- **Estado:** protótipo jogável; o gerador **v3 por blocos** é o padrão; a pista fixa continua congelada. O foco atual é playtest de feeling, densidade e ritmo das pistas longas.

---

## 1. Estado atual em uma tela

Métricas medidas nas seeds **1–100** com o código em `7f03ab4`:

| Item | Estado atual |
| --- | --- |
| Gerador padrão | **v3 block-first** (`ProceduralTrackV3.ts`) |
| Rollback | `?gen=v2` e `?gen=v1` |
| Comprimento total | **2.692–3.798 m** (média ~3,19 km) |
| Blocos por pista | **5–6** (70 seeds com 5, 30 com 6) |
| Splits por pista | **1–2** (50 seeds com 1, 50 com 2) |
| Rotas de split | **612–820 m** (média ~713 m), duas rotas completas por split |
| Largura | **4,6–15,0 m** no total; rotas de **5,5–9,0 m** |
| Raio mínimo | **9,9 m** |
| Inclinação máxima | **0,79** com kickers |
| Hairpins | **1–2 por pista**; 99/100 com ao menos 1; 41 com 2; seed 61 é a única sem |
| Rampas | **1–5** |
| Hazards | **2–4** |
| Powerups | **12–16** |
| Obstáculos | **86–110 no main** + **34–86 no total das rotas** |
| Curvatura do main | **~13,1 rad/km** (v1 ~11,7) |
| Curvatura das rotas | **~14,5 rad/km** (fork v2 ~19,2) |
| Chokes / largos | **~2,0 chokes/km** / **~1,56 trechos largos/km** |
| Pista plana | **~27%** |
| Elevação | amplitude **~22 m**; subida acumulada **~38 m/km** |
| Medalhas procedurais | ouro **80,4–113,4 s** (1:20–1:53), prata +12%, bronze +24% |
| Pista fixa | **1.096,8 m**, ouro/prata/bronze **39/45/51 s**, parciais **8,9/17,9/26,8 s** |
| Validação | **v3 100/100**, **v2 100/100**, **v1 100/100**, 0 avisos no v3 |

**Leitura rápida:** o passe de densidade manteve o comprimento e as rotas longas, mas adensou curvas, chokes, largos, platôs, rampas, powerups, hazards, obstáculos e cenário. O v3 não é mais uma pista principal com um “plugin” pendurado: cada split é um bloco de cenário com duas rotas completas.

---

## 2. O que é o gerador v3

O v3 mudou a unidade de geração: em vez de uma pista principal com um desvio, a pista é uma **sequência de blocos de cenário**.

```
[bloco linear] → [bloco com split] → [bloco linear] → [bloco com split] → [bloco linear]
                         │
                  entrada comum
                  ┌── rota A completa ──┐
                  │                     │
                  └── rota B completa ──┘
                         saída comum
```

- Cada bloco tem **um bioma** (`forest`, `desert`, `snow`, `village`, `dirt`, `beach`); não há repetição do mesmo bioma na mesma pista.
- Bloco linear = uma rota completa. Bloco com split = entrada comum + **duas rotas completas** + saída comum.
- Cada rota tem spline, perfil de largura, elevação, ombros/bordas dos dois lados, cenário dos dois lados, postes, hazards, obstáculos, powerups e kickers próprios.
- A **rota A** é o eixo lógico (trunk) para cronômetro, parciais e medalhas. A **rota B** mapeia seu progresso normalizado para o mesmo intervalo `startS..endS`.
- As **3 parciais** ficam somente em fronteiras comuns de blocos, nas mais próximas de 25/50/75%. Nunca dentro de um split. As bandeiras físicas mostram apenas **SPLIT**, sem nome de bioma.
- O miolo do split é paisagem (morro, mata ou vale), não um canteiro plano.
- A escolha do split pode ser **simétrica** (linha) ou **assimétrica** (distância/velocidade/dificuldade). Ainda não há recompensa explícita por escolher a rota mais arriscada.
- Se todas as tentativas de geração falharem, o v3 cai para o v2. Isso não ocorreu nas seeds 1–100.

### Comprimentos medidos

| Tipo de bloco | Faixa medida |
| --- | --- |
| Linear | ~390–680 m (500–680 m quando tem hairpin) |
| Com split | ~755–976 m de eixo |
| Rota A/B | 612–820 m |

### Visual e encaixes

- `ForkMesh` desenha a rota completa com **material/textura iguais aos da pista principal**, UVs e blend de zona equivalentes.
- `TrackMesh` encolhe os ombros no split e cobre a emenda; o gore tem fade nas bordas internas.
- `Scenery` preenche as duas rotas e o miolo do Y; postes de borda e props existem dos dois lados.
- O conteúdo é **path-aware**: `TrackHazard`, `TrackObstacle` e `TrackPowerup` têm `pathId`; hazards de uma rota só ativam nela.
- `Obstacles` escala a densidade pelo comprimento do caminho; por isso o main tem ~100 obstáculos e cada rota tem sua própria população.

---

## 3. O que já está pronto e deve ser preservado

### Corrida e loop

- Corrida **A→B**, 5–6 blocos de cenário, 3 parciais, medalha e retry instantâneo.
- **Pista fixa** `track01-v3` de **1.096,8 m** (seed 91), 4 setores, 2 rampas, 4 powerups e 50 obstáculos.
- **Pista procedural** é o default ao abrir `/`; o menu **PISTAS** escolhe seed ou pista fixa.
- GO com carro parado; auto-aceleração após o start; sem game over.
- Melhor tempo por pista, resultado com medalha, parciais e `NOVO RECORDE`.
- Powerups: turbo (~2 s) e grip extra (10 s), com renovação de timer.
- **Menu PISTAS** com grade 1–100, melhor tempo por seed, campo de seed, **SORTEAR** e **PISTA FIXA**; pausa a corrida enquanto aberto.
- **Velocímetro** em km/h com barra, espelhado conforme o lado dos controles.

### Controles atuais

- **Touch:** 5 botões — ◀/▶ puros, ◀F/▶F (esterço + freio no mesmo dedo) e FREIO largo. Padrão à direita; menu **MÃO** alterna e persiste.
- **Desktop:** stack touch oculto; GO “CLIQUE OU ENTER”; teclado A/← esquerda, D/→ direita, S/↓ freio, Espaço handbrake, R reset, H telemetria.
- **Freio de mão no touch ainda não existe**; só teclado. O mouse no PC ainda só inicia a corrida.
- Multi-touch funciona para dois dedos; o combo ◀F/▶F resolve uma mão.

### Carro, pista e feedback

- `maxSpeed` **39,1 m/s (~141 km/h)**, `engineAcceleration` **11,5 m/s²**, `brakeMax` **13,8 m/s²**.
- Derrapagem solta e recuperável; grip por piso: cascalho 4,6 / areia 2,9 / neve 2,35 / asfalto 6,1 / terra 3,55 / praia 2,55, com off-roads próprios.
- Off-road com caps e freio extra por cenário; rumble mais forte fora da pista.
- Poeira por piso com duas cores, taxa, tamanho, alpha, vida, subida e gravidade próprios.
- **Hairpin extremo:** 13–14 m, sweep 170–185°, largura 5,2–6,2 m, aproximação 45–60 m; o normal tem 20–23 m.
- **Hazards:** 2–4 por pista, tipo por cenário, travessia de 4,8–10,5 m/s e colisão.
- **Pista fixa** continua floresta/deserto, sem splits e sem hazards.

### Persistência

- Melhor tempo fixo: `rally.best.track01-v3.v1`.
- Melhor tempo procedural: `rally.best.proc-N.v1` (uma chave por seed).
- Tuning: `rally.tuning.v4` (v3 é ignorado).
- Lado dos controles: `rally.controls.side.v1`.

---

## 4. Documentos de referência

- [`Docs/Mini GDD - Rally Arcade v2.md`](Mini%20GDD%20-%20Rally%20Arcade%20v2.md) — **GDD oficial v2.5**, atualizado para o v3 e o passe de densidade.
- [`Docs/Design - Gerador v3 por blocos.md`](Design%20-%20Gerador%20v3%20por%20blocos.md) — desenho técnico do v3.
- [`Docs/Implementation Plan - Rally Arcade MVP.md`](Implementation%20Plan%20-%20Rally%20Arcade%20MVP.md) — decisões e histórico; a seção 25 descreve a integração v3.
- [`README.md`](../README.md) — quickstart, comandos, controles, URLs e deploy.
- [`Docs/screenshots/`](screenshots/) — capturas atuais, incluindo `fork-v3.png`, `route-v3.png` e `hairpin-v3.png`.
- Este handoff — estado atual, riscos e próximos passos.

---

## 5. URLs, debug e comandos

### URLs

- `/` ou `?debug=1` → procedural aleatória 1–100 a cada abertura/reload.
- `?track=fixed` → pista fixa `track01-v3`.
- `?track=proc&seed=N` → procedural determinística (1–100).
- `?track=proc` sem seed → procedural aleatória.
- `?gen=v3` (padrão), `?gen=v2`, `?gen=v1` → gerador atual ou rollback.
- `?s=<m>` → teleporta e volta a READY; usar com `track=fixed` ou `proc&seed` para pista estável.
- `?hazards=0` → desliga obstáculos móveis.
- `?branch=0&bt=0.45` → teleporta para 45% da primeira rota alternativa; `bt` vai de 0 (entrada) a 1 (saída). Usar com `debug=1`.
- `?touch=1` / `?touch=0` → força mostrar/ocultar controles touch (QA).

Exemplos úteis:

```text
https://rigato.github.io/rally-arcade/?debug=1&track=proc&seed=1&s=1735
https://rigato.github.io/rally-arcade/?debug=1&track=proc&seed=1&branch=0&bt=0.45
https://rigato.github.io/rally-arcade/?debug=1&track=proc&seed=1&s=1100
https://rigato.github.io/rally-arcade/?track=fixed&debug=1
```

### Comandos

```bash
npm install
npm run dev -- --host
npm run typecheck
npm run build
npm run preview
npm run validate:track

npx --yes tsx scripts/proc-validate-v3.ts --count 100 --start 1
npx --yes tsx scripts/proc-validate.ts --gen v2 --count 100 --start 1
npx --yes tsx scripts/proc-validate.ts --gen v1 --count 100 --start 1
```

### Deploy

- Workflow `.github/workflows/deploy.yml` publica no GitHub Pages a cada push na `main`.
- `vite.config.ts` usa `base: './'`.
- Último deploy verificado em `7f03ab4`: console limpo, `[Game] pista procedural v3 seed=1`, pista de 2.966 m com 1 ramo e 3 hazards.

---

## 6. Playtest e pontos abertos

1. **Densidade das rotas longas.** A curvatura média das rotas subiu para ~14,5 rad/km, mas o fork compacto do v2 ainda é mais intenso (~19,2). Se no playtest as rotas longas ainda parecerem fluidas, o próximo passo é **aumentar só a curvatura delas para 16–18 rad/km, sem encurtar**. Não voltar a encurtar rotas.
2. **Seed 61 sem hairpin.** É a única das 100 seeds sem hairpin; o layout é válido. Se for importante ter 100/100, tratar depois sem comprometer o comprimento.
3. **Performance em celular real.** FPS de headless/software não representa o aparelho. Validar partículas, cenário, splits e hazards em celular de médio porte.
4. **Freio de mão no touch.** Continua só no teclado. Decidir entre 6º botão, gesto, combo ou manter teclado-only.
5. **Mouse no PC.** O GDD previa direção com mouse; hoje o mouse só inicia. Baixa prioridade.
6. **Recompensa assimétrica no split.** As rotas podem diferir em distância/dificuldade, mas ainda não há recompensa explícita (atalho vs. risco). Decidir se isso entra no design.
7. **Duração da corrida.** As procedurais levam ~1:20–1:53 no alvo de ouro, bem acima dos 30–60 s do MVP original. Isso é intencional no estado atual; se o playtest pedir corridas mais curtas, a decisão deve ser explícita e não um efeito colateral.
8. **Hazards e poeira.** A frequência 2–4 e o timing de travessia ainda precisam de playtest; o contraste da poeira em neve/praia também.
9. **Default sem seed na URL.** Abrir `/` sorteia uma pista e não reescreve a URL; o menu PISTAS mostra a seed para repetir.
10. **Áudio e progressão.** Continuam ausentes; são os próximos grandes pilares possíveis, não pendências do v3.

---

## 7. Próximos passos recomendados

1. **Playtest do v3 no celular real**, com foco nas rotas longas: seed 1 (1 split), uma seed com 2 splits e a seed 61 (sem hairpin).
2. **Se as rotas ainda parecerem vazias/fluidas:** subir a curvatura das rotas para 16–18 rad/km, mantendo 612–820 m e a largura 5,5–9,0 m.
3. **Se o comprimento incomodar:** decidir conscientemente o alvo de duração; não encurtar só as rotas.
4. **Escolher o próximo pilar:** conteúdo, progressão, áudio ou polimento de controles. O v3 já cobre o requisito de variedade de pista.
5. **Se o foco for polimento:** handbrake touch, mouse no PC, timing dos hazards e contraste da poeira.
6. **Atualizar GDD/Handoff a cada rodada** e manter o Implementation Plan como histórico.

---

## 8. O que não refazer

- **Não encurtar** o total (~2,7–3,8 km) nem as rotas de split (612–820 m) para “resolver” densidade.
- **Não remover** a estrutura block-first, os dois caminhos completos ou o miolo de paisagem.
- **Não mudar** o material/textura das rotas em relação à pista principal nem reintroduzir escurecimento artificial.
- **Não mover** parciais para dentro de splits; elas ficam só em fronteiras comuns. As bandeiras mostram apenas **SPLIT**.
- **Não alterar** a pista fixa `track01-v3` nem suas medalhas 39/45/51.
- **Não remover** o rollback v1/v2 (`?gen=v2`, `?gen=v1`).
- **Não reverter** GO + auto-aceleração + 5 botões, o menu MÃO ou o default procedural.
- **Não fechar** o hairpin extremo abaixo de 13 m sem playtest; 13–14 m foi aprovado.

---

## 9. Arquivos-chave

- `src/track/procedural/ProceduralTrackV3.ts` — gerador v3, blocos, splits, conteúdo e validação.
- `src/track/procedural/ProceduralTrackV2.ts` — rollback v2; não alterar.
- `src/track/procedural/ProceduralTrack.ts` — rollback v1; não alterar.
- `src/track/Track.ts` — spline, sampler, alturas, larguras, progresso e ramos.
- `src/track/TrackBranch.ts` — sampler da rota completa.
- `src/track/TrackMesh.ts` — malha da pista, ombros, gore e textura compartilhada.
- `src/track/ForkMesh.ts` — malha/material das duas rotas completas.
- `src/track/Obstacles.ts` — obstáculos por caminho e densidade por comprimento.
- `src/track/Hazards.ts` — obstáculos móveis por caminho.
- `src/track/Gates.ts` — portais, parciais e chegada.
- `src/world/Scenery.ts` — cenário, postes e preenchimento do miolo/rotas.
- `src/game/Game.ts` — boot, `resolveTrackDef`, loop e integração.
- `src/game/config.ts` — `CAR_TUNING`, `SURFACES`, `DUST_TUNING`, `FORK_TUNING`, `HAZARD_TUNING`.
- `src/game/Race.ts` — cronômetro, parciais, medalhas e melhor tempo.
- `src/game/scenarios.ts` — seis cenários, pisos, paletas, poeira e hazards.
- `src/car/Car.ts` / `src/car/CarView.ts` — física, grip, off-road, saltos e visual.
- `src/ui/Hud.ts`, `src/ui/TrackMenu.ts`, `src/ui/Results.ts` — HUD, menu de pistas e resultado.
- `scripts/proc-validate-v3.ts` — validação 100 seeds e relatório do v3.
- `scripts/proc-validate.ts` — validação dos rollbacks v1/v2.
- `scripts/validate-track.ts` — validação da pista fixa.
- `Docs/screenshots/fork-v3.png`, `route-v3.png`, `hairpin-v3.png` — capturas atuais.

---

## 10. Últimos commits relevantes

- `7f03ab4` — `docs: update handoff after v3 density pass`
- `76003a7` — `feat: densify v3 tracks and long split routes`
- `cb2a008` — `docs: update handoff after v3 enrichment`
- `25b9a53` — `feat: enrich v3 track features and split visuals`
- `2d8b194` — `feat: block-based procedural track generator v3`
