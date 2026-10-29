# Handoff — Rally Arcade (Oct 28, 2026)

Documento para abrir uma nova sessão de **plan** sem reler todo o histórico. Base do código: **`f4223e6`** (`feat: v7 random default, tighter hairpin, +3s medals and bold dust`).

> **Atualização v8 (Oct 28, 2026):** o protótipo agora tem seis cenários (floresta, deserto, neve, vilarejo, estrada de terra e praia), poeira por piso, 1–2 bifurcações procedurais, 1–3 obstáculos móveis por pista, menu de pistas/seeds e velocímetro. A pista fixa `track01-v3` continua congelada. Ver a seção 8 no fim deste documento e a seção 30 do Implementation Plan.

- **Live:** <https://rigato.github.io/rally-arcade/>
- **Repo:** <https://github.com/Rigato/rally-arcade>
- **Stack:** Vite + TypeScript estrito + Three.js; física própria, UI em DOM/CSS.
- **Estado:** protótipo jogável, MVP do GDD quase completo, em playtest de feeling/tempos.

## Documentos de referência

- [`Docs/Mini GDD - Rally Arcade v2.md`](Mini%20GDD%20-%20Rally%20Arcade%20v2.md) — **GDD oficial v2.2**, atualizado para o protótipo v8.
- [`Docs/bak_old/Mini GDD - Rally Arcade v2.md`](bak_old/Mini%20GDD%20-%20Rally%20Arcade%20v2.md) — backup do GDD v2 antes da revisão v2.1.
- [`Docs/old_Mini GDD - Rally Arcade v1.md`](old_Mini%20GDD%20-%20Rally%20Arcade%20v1.md) — GDD v1 original.
- [`Docs/Implementation Plan - Rally Arcade MVP.md`](Implementation%20Plan%20-%20Rally%20Arcade%20MVP.md) — decisões, marcos e histórico v1–v8.
- [`Docs/Handoff - Rally Arcade.md`](Handoff%20-%20Rally%20Arcade.md) — este documento.
- [`Docs/screenshots/`](screenshots/) — capturas de referência (GO, controles, menu de mão, pista, choke, hairpin extremo, contact sheet procedural).
- [`README.md`](../README.md) — quickstart, comandos, controles e deploy.

---

## 1. Resumo executivo — o que o GDD previa e ainda não foi feito

O loop principal e **quase todo** o checklist do **MVP do GDD (seção 7)** estão concluídos. As duas lacunas formais de controle são **freio de mão no touch** e **mouse no PC**; o restante do checklist está atendido. O que falta vem das seções **1–5** (pilares, áudio, mecânicas futuras) e **8 (Fora do MVP)**.

| Elemento previsto no GDD | Estado | Observação |
| --- | --- | --- |
| **Progressão fora da corrida**: medalha → dinheiro, tunar/comprar carros, desbloquear fases/mundos | ❌ Não iniciado | Só existem recordes locais, tuning e lado dos controles no `localStorage`. |
| **Mais cenários**: neve, vilarejos, asfalto, estrada de terra | ✅ Implementado no v8 | Floresta, deserto, neve, vilarejo/asfalto, estrada de terra e praia, com pisos e poeira próprios. |
| **Dificuldade crescente** e desafios a cada X tempos/cenários | ❌ Não iniciado | Não há mundos, níveis de dificuldade nem metas adaptativas. |
| **Suspensão influenciando o comportamento** lateral (além do visual) | ❌ Não iniciado | A suspensão é só roll/pitch visual e mola de pouso. |
| **Saltos com manobras/controle no ar e aterrissagem** | ❌ Não iniciado | O salto é balístico, sem controle no ar; o pouso só injeta shake/impacto. |
| **Público ajudando a recolocar o carro** na pista com custo de tempo | ❌ Não iniciado | Existe recuperação automática, mas não a ideia do público. |
| **Áudio completo**: Rally House, motor, pops de escapamento, derrapagem por piso | ❌ Não iniciado | Nenhum áudio no MVP (decisão explícita). |
| **Freio de mão no touch / hairpin com handbrake** | ⚠️ Parcial | Freio de mão só no teclado (Espaço); o touch tem 5 botões sem handbrake. O hairpin extremo atual exige freio normal, não handbrake. |
| **Mouse no PC** (GDD previa o mesmo esquema simulado com mouse) | ⚠️ Parcial | PC usa teclado; o mouse só clica no GO/canvas. |
| **Caminhos alternativos / linhas de risco-recompensa** | ⚠️ Parcial | 1–2 bifurcações por pista, com ramo próprio que sai e volta; ainda sem recompensa assimétrica. |
| **Menu/seed/favoritos de pistas procedurais**, salvar/compartilhar seed | ✅ Menu implementado no v8 | Grade 1–100 com melhor tempo, campo de seed, SORTEAR e PISTA FIXA. Histórico/favoritos/editor continuam fora. |
| **Vários carros/modelos de rally** | ❌ Não iniciado | Parte da progressão; existe um único carro low poly. |
| **Obstáculos móveis por cenário** | ✅ Implementado no v8 | 1–3 por pista, camelo/cervo/rena/carro/caminhão/trator/vaca/buggy, com toggle `?hazards=0`. |
| **Velocímetro** | ✅ Implementado no v8 | km/h e barra no canto inferior, espelhado com o lado dos controles. |

**Observação importante:** a seção de **controles touch do GDD (drag + soltar para frear)** foi **substituída** pelo esquema atual de GO + auto-aceleração + 5 botões. Isso não é uma pendência; é uma decisão de playtest. O **GDD oficial já foi atualizado na v2.2**; o v2 antigo está preservado em `Docs/bak_old/`.

**Já além do GDD:** o gerador procedural saiu de “fora do MVP” e virou o modo padrão; o touch de 5 botões com combos e menu MÃO também não estava previsto no GDD. A pista fixa continua como test track.

---

## 2. O que já está pronto e deve ser preservado

### Loop e corrida

- Corrida A→B, 4 setores sorteados do pool de 6 cenários, 3 parciais, medalha e retry instantâneo.
- **Pista fixa** `track01-v3` de **1096,8 m** (seed 91), 4 setores, raio mínimo 30,2 m, 2 rampas, 4 powerups, 50 obstáculos.
- **Pista procedural** gerada por seed, agora **default ao abrir `/`**, com 6 cenários, 1–2 bifurcações e 1–3 obstáculos móveis.
- GO com carro parado; auto-aceleração depois do start; sem game over.
- Melhor tempo por pista, resultado com medalha, parciais e `NOVO RECORDE`.
- Powerups: turbo (~2 s) e grip extra (10 s), com renovação de timer.
- Tela de resultado, retry e reinício por R.
- **Menu PISTAS** com grade de seeds 1–100, melhor tempo por seed, SORTEAR e PISTA FIXA; pausa a corrida enquanto aberto.
- **Velocímetro** em km/h com barra, espelhado conforme o lado dos controles.

### Controles atuais

- **Touch:** 5 botões no stack inferior — ◀/▶ puros, ◀F/▶F (esterço + freio no mesmo dedo), FREIO largo. Padrão à direita; menu **MÃO** alterna para a esquerda e persiste em `localStorage['rally.controls.side.v1']`.
- **Desktop:** stack touch oculto; GO “CLIQUE OU ENTER”; teclado A/← esquerda, D/→ direita, S/↓ freio, Espaço handbrake, R reset, H telemetria.
- **Multi-touch** funciona para dois dedos; o combo ◀F/▶F resolve uma mão.
- GO, toque no canvas, W/↑/Enter iniciam.

### Carro, pista e feedback

- `maxSpeed` **39,1 m/s (~141 km/h)**, `engineAcceleration` **11,5 m/s²**, `brakeMax` **13,8 m/s²**.
- Derrapagem solta e recuperável; grip de cascalho 4,6 / areia 2,9 / neve 2,35 / asfalto 6,1 / terra 3,55 / praia 2,55, com off-roads próprios.
- Off-road: caps de 50–68% e freio extra de 8–12 m/s² conforme o cenário.
- Rumble de câmera 0,15 m escalado por piso.
- Poeira v8: pool 112, perfis por piso com duas cores, taxa/tamanho/alpha/vida/subida/gravidade próprios; deserto com contraste corrigido e neve com spray branco-azulado.
- **Hairpin extremo:** 13–14 m, 1 por pista procedural, sweep 170–185°, largura 5,2–6,2 m, aproximação 45–60 m.
- **Bifurcações:** 1–2 por pista, ramo com spline/altura/largura próprios, 14–26 m de deslocamento lateral.
- **Hazards:** 1–3 por pista, tipo por cenário, travessia e colisão.

### Procedural v8

- **7 categorias**: longa, média, curta, cotovelo, hairpin normal 20–23 m, hairpin extremo 13–14 m, kink 140–220 m / 6–15°.
- Pista **1518–1624 m**, setores ~354–438 m, largura 4,6–15,0 m, chokes 4,6–5,4 m, longos estreitos 5,5–7 m, largos 13–15 m.
- **4 setores distintos** do pool de 6 cenários, sem repetir o mesmo em sequência.
- **1–2 bifurcações** e **1–3 hazards** por pista; 6–8 powerups, 50–75 obstáculos, 2–3 platôs planos (20–25% da pista), separação mínima 40 m, A→B.
- **100/100 seeds válidas** (1–100); 1 hairpin extremo por seed; 1–2 forks; 1–3 hazards.
- Medalhas procedurais: ouro **45,2–48,2 s**, prata +6 s, bronze +12 s; parciais no ritmo do ouro.
- Pista fixa: ouro **39 s**, prata **45 s**, bronze **51 s**; parciais **8,9/17,9/26,8 s**.

### Default e URLs

- `/` → procedural aleatória 1–100 a cada abertura/reload (URL não é reescrita).
- `?track=fixed` → pista fixa.
- `?track=proc&seed=N` → procedural determinística (1–100).
- `?track=proc` sem seed → aleatória.
- **FIXA** navega para `?track=fixed`; **NOVA** gera `?track=proc&seed=N`; o menu **PISTAS** faz os dois e escolhe seed.
- `?debug=1` / `#debug` → telemetria + painel lil-gui.
- `?s=<m>` → teleporta e volta a READY; usar com `track=fixed` ou `proc&seed` se quiser pista estável.
- `?touch=1` / `?touch=0` → força mostrar/ocultar controles touch (QA).
- `?hazards=0` → desliga os obstáculos móveis; sem o parâmetro eles ficam ligados.

### Persistência

- Melhor tempo fixo: `rally.best.track01-v3.v1`.
- Melhor tempo procedural: `rally.best.proc-N.v1` (uma chave por seed).
- Tuning: `rally.tuning.v4` (v3 é ignorado).
- Lado dos controles: `rally.controls.side.v1`.

---

## 3. Feedback do último playtest

- **Hairpin extremo 13–14 m:** aprovado. Não mexer por enquanto.
- **Medalhas +3 s:** melhorou; o usuário ainda vai testar mais. Ouro fixo 39 s / procedural 45,2–48,2 s.
- **Off-road:** aprovado (freio, cap e trepidação).
- **Poeira v7:** aprovada em volume/quantidade, mas **a cor no deserto tem pouco contraste** com o chão. Ficou anotado para a próxima rodada.
- **Default procedural:** aprovado.
- **Ideia futura do usuário:** modular o **volume de poeira por tipo de cenário** (ex.: areia mais fina/menos densa; floresta mais intensa).

### Pontos em aberto do GDD

- **Freio de mão no touch:** ainda aberto; só teclado.
- **Caminhos alternativos/linhas de risco:** ainda abertos; pista única.
- **Limite do mundo:** existe recuperação automática a 12 m além da borda; calibrar se necessário.
- **Câmera, curva de freio, turbo ~2 s e tempos-alvo:** resolvidos e calibrados no protótipo.
- **Handbrake como estratégia de hairpin:** não disponível no touch; decidir na próxima fase.

---

## 4. Pendências e riscos conhecidos

1. **Poeira no deserto:** cor `sand`/`desert` se mistura ao terreno. Opções: escurecer/esfriar a cor, adicionar contorno/sombra, usar mistura de duas cores ou partículas maiores com alpha menor. Testar contraste em movimento.
2. **Volume de poeira por cenário:** planejar um multiplicador por bioma/piso no futuro (floresta, deserto, neve, asfalto).
3. **Handbrake no touch:** existe só no teclado. O GDD valorizava hairpin com freio de mão; hoje o extremo é vencido no freio normal. Decidir: 6º botão, gesto, combo ou manter.
4. **Medalhas:** +3 s é um teste; pode precisar de novo ajuste após mais corridas. A pista fixa antiga tinha 59,3 s; os recordes antigos continuam no storage.
5. **Default sem seed na URL:** abrir `/` não permite repetir a pista. Se isso importar, mostrar a seed no HUD ou gravar `?track=proc&seed=N` (mas aí o reload deixa de ser aleatório).
6. **Ombros do hairpin extremo:** o apron de 12 m fica contínuo no apex; foi aceito para ganhar o aperto. Se o visual incomodar, reduzir o ombro local.
7. **Performance:** FPS de headless/software não representa celular; validar em aparelho real após novas partículas/cenários.
8. **Tuning v4:** quem tinha ajustes no v3 perdeu os valores; é intencional para aplicar os novos defaults.
9. **Áudio e progressão:** completamente ausentes; não há como testar esses pilares ainda.

---

## 5. Agenda sugerida para a próxima sessão de plan

### Decisão de foco

Escolher **um** vetor principal para o próximo ciclo, porque o protótipo já cobre o MVP:

1. **Conteúdo e variedade** — mais cenários (neve, vilarejo, asfalto, terra), variação de piso e dificuldade.
2. **Meta/progressão** — dinheiro, upgrades, carros, desbloqueios, persistência.
3. **Polimento de rally** — handbrake touch, poeira por bioma/contraste, som, câmera, saltos.
4. **Procedural como produto** — menu de seeds, histórico/favoritos, daily challenge, editor, seed compartilhável.

### Perguntas abertas para o plan

- Qual é o próximo pilar do GDD a atacar: **conteúdo**, **progressão**, **áudio** ou **polimento**?
- Áudio entra agora ou só depois de validar mais conteúdo? (Rally House + motor + derrapagem por piso.)
- Handbrake touch: 6º botão, gesto de arrasto, combo ◀F/▶F com pressão longa, ou manter teclado-only?
- Progressão: moeda por medalha, upgrades de motor/grip/freio, carros com stats diferentes, ou só desbloqueio de pistas?
- Mais cenários: quais 2–3 primeiro e como cada um muda grip/aceleração/visual? O gerador já tem 4 zonas; dá para mapear biomas por zona.
- Dificuldade crescente: mais curvas/chicanes, menos largura, mais obstáculos, ou metas de tempo mais apertadas?
- Caminhos alternativos: vale implementar linhas de risco/recompensa ou manter pista única?
- Procedural: o jogador deve ver/escolher a seed? Salvar pistas? Daily challenge?
- A pista fixa continua sendo o “test track” ou vira uma fase de campanha? O gerador novo pode congelar uma seed nova no futuro.
- Qual o alvo de duração de corrida para o próximo ciclo? Hoje as procedurais levam ~45–60 s; a fixa ~40 s.

### Próximos passos pequenos e independentes (se quiser aquecer)

- Corrigir contraste da poeira no deserto e adicionar multiplicador de volume por bioma.
- Adicionar seed visível/share no HUD ou no resultado.
- Testar handbrake touch em um 6º botão temporário.
- Manter o GDD v2.2 atualizado a cada rodada; o v2 antigo está em `Docs/bak_old/`.

---

## 6. Arquitetura e comandos

### Arquivos-chave

- `src/game/Game.ts` — boot, `resolveTrackDef`, loop, estados, render, integração de FX.
- `src/game/config.ts` — `CAR_TUNING`, `SURFACES`, `DUST_TUNING`, `FORK_TUNING`, `HAZARD_TUNING`, câmera, input, body, powerups, corrida.
- `src/game/scenarios.ts` — registro dos 6 cenários, paletas, poeira, portais e hazards.
- `src/game/Race.ts` — cronômetro, parciais, medalhas, melhor tempo.
- `src/car/Car.ts` — física, grip, off-road, saltos.
- `src/car/CarView.ts` — carro low poly, suspensão visual, rodas.
- `src/camera/ChaseCamera.ts` — câmera de perseguição, shake/rumble.
- `src/input/Input.ts` — GO, auto-throttle, 5 botões, teclado, multi-touch.
- `src/ui/Hud.ts` — HUD, GO, stack, menu MÃO, velocímetro botão PISTAS.
- `src/ui/TrackMenu.ts` — grade de seeds, SORTEAR, pista fixa.
- `src/ui/Results.ts` — resultado/medalha/retry/escolher pista.
- `src/fx/DriftDust.ts` — poeira com perfis por piso.
- `src/track/track01.ts` — pista fixa congelada (seed 91).
- `src/track/procedural/ProceduralTrack.ts` — gerador v8 + legado.
- `src/track/Track.ts` — spline, sampler, largura 4,4–15,2, off-road, ramos.
- `src/track/TrackBranch.ts` — sampler de ramo de bifurcação.
- `src/track/TrackMesh.ts` — malha da pista/ombros/placas.
- `src/track/ForkMesh.ts` — malha dos ramos.
- `src/track/Hazards.ts` — obstáculos móveis.
- `src/world/Scenery.ts` / `Environment.ts` — cenário e luz por zona.
- `scripts/proc-validate.ts` / `proc-diversity.ts` — validação 100 seeds e contact sheet.
- `scripts/validate-track.ts` — validação B1 da pista fixa.
- `scripts/freeze-track.ts` — reproduz a pista fixa a partir do legado.

### Comandos

```bash
npm install
npm run dev -- --host          # servidor local
npm run typecheck
npm run build
npm run validate:track         # pista fixa
npx --yes tsx scripts/proc-validate.ts --count 100 --start 1
npx --yes tsx scripts/proc-diversity.ts --count 12 --svg /tmp/opencode/proc-sheet.svg
```

### Deploy

- Workflow `.github/workflows/deploy.yml` publica no GitHub Pages a cada push na `main`.
- `vite.config.ts` usa `base: './'`.
- Última validação live: default procedural, menu PISTAS, seed determinística, pista fixa, cenários, forks, hazards, velocímetro, touch 5 botões e desktop oculto; console limpo.

### Testes de regressão que valem manter

- `/` 3× → seeds procedurais diferentes.
- FIXA / menu → `?track=fixed` e 1096,8 m.
- Menu → `?track=proc&seed=N`; resultado → menu; pausa congela timer.
- 100/100 seeds; 1 hairpin extremo por seed; 1–2 forks; 1–3 hazards.
- `?hazards=0` desliga; colisão de hazard reduz velocidade; `__rallyPath` confirma ramo.
- Freeze byte a byte de `track01.ts`.
- Touch 5 botões / desktop sem stack; GO/teclado; velocímetro; console limpo.

---

## 7. O que não refazer

- Esquema de 5 botões, GO, auto-aceleração e menu MÃO.
- Derrapagem solta e recuperável; não “colar” o carro no chão.
- Off-road com caps e freios por cenário; rumble mais forte fora de pista.
- Default procedural, menu PISTAS e 🎲 NOVA.
- Hairpin extremo 13–14 m (aprovado).
- Medalhas +3 s como base (testar mais).
- Pista fixa congelada e o perfil legado do gerador.
- Tuning em `rally.tuning.v4`.

## 8. Estado v8 — cenários, bifurcações, menu, velocímetro e hazards

- **Cenários:** seis (floresta, deserto, neve, vilarejo, estrada de terra, praia); 4 setores distintos por pista; pisos e poeira próprios. A pista fixa continua floresta/deserto.
- **Bifurcações:** 1–2 por pista; ramo com `TrackBranch`/`ForkMesh`, 14–26 m de deslocamento; física escolhe principal/ramo com histerese; pista fixa sem fork.
- **Hazards:** 1–3 por pista; tipos por cenário; travessia/collision; `?hazards=0` e checkbox no Debug; pista fixa sem hazards.
- **Menu:** grade 1–100, melhor tempo por seed, campo de seed, SORTEAR, PISTA FIXA; pausa a corrida; `ESCOLHER PISTA` no resultado.
- **Velocímetro:** km/h + barra, canto inferior, espelhado com o lado do stack.
- **Validação:** 100/100 seeds; 1–2 forks; 1–3 hazards (78/15/7 em 100 seeds); `typecheck`, `build` e `validate:track` OK; console limpo em mobile 390×844.
- **Arquivos novos:** `src/game/scenarios.ts`, `src/track/TrackBranch.ts`, `src/track/ForkMesh.ts`, `src/track/Hazards.ts`, `src/ui/TrackMenu.ts`.
- **Pendências:** playtest de grip dos novos pisos, legibilidade da escolha de fork, frequência/timing dos hazards, poeira em neve/praia e performance em celular real.
- **Não fazer ainda:** progressão, áudio, editor, caminhos com recompensa assimétrica, controle no ar e handbrake touch.
