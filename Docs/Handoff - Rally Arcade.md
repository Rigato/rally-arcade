# Handoff — Rally Arcade (Oct 28, 2026)

Documento para abrir uma nova sessão de **plan** sem reler todo o histórico. Base do código: **`f4223e6`** (`feat: v7 random default, tighter hairpin, +3s medals and bold dust`).

- **Live:** <https://rigato.github.io/rally-arcade/>
- **Repo:** <https://github.com/Rigato/rally-arcade>
- **Stack:** Vite + TypeScript estrito + Three.js; física própria, UI em DOM/CSS.
- **Estado:** protótipo jogável, MVP do GDD quase completo, em playtest de feeling/tempos.

---

## 1. Resumo executivo — o que o GDD previa e ainda não foi feito

O loop principal e **quase todo** o checklist do **MVP do GDD (seção 7)** estão concluídos. As duas lacunas formais de controle são **freio de mão no touch** e **mouse no PC**; o restante do checklist está atendido. O que falta vem das seções **1–5** (pilares, áudio, mecânicas futuras) e **8 (Fora do MVP)**.

| Elemento previsto no GDD | Estado | Observação |
| --- | --- | --- |
| **Progressão fora da corrida**: medalha → dinheiro, tunar/comprar carros, desbloquear fases/mundos | ❌ Não iniciado | Só existem recordes locais, tuning e lado dos controles no `localStorage`. |
| **Mais cenários**: neve, vilarejos, asfalto, estrada de terra | ❌ Não iniciado | Hoje só floresta (cascalho) e deserto (areia), com off-road próprio. |
| **Dificuldade crescente** e desafios a cada X tempos/cenários | ❌ Não iniciado | Não há mundos, níveis de dificuldade nem metas adaptativas. |
| **Suspensão influenciando o comportamento** lateral (além do visual) | ❌ Não iniciado | A suspensão é só roll/pitch visual e mola de pouso. |
| **Saltos com manobras/controle no ar e aterrissagem** | ❌ Não iniciado | O salto é balístico, sem controle no ar; o pouso só injeta shake/impacto. |
| **Público ajudando a recolocar o carro** na pista com custo de tempo | ❌ Não iniciado | Existe recuperação automática, mas não a ideia do público. |
| **Áudio completo**: Rally House, motor, pops de escapamento, derrapagem por piso | ❌ Não iniciado | Nenhum áudio no MVP (decisão explícita). |
| **Freio de mão no touch / hairpin com handbrake** | ⚠️ Parcial | Freio de mão só no teclado (Espaço); o touch tem 5 botões sem handbrake. O hairpin extremo atual exige freio normal, não handbrake. |
| **Mouse no PC** (GDD previa o mesmo esquema simulado com mouse) | ⚠️ Parcial | PC usa teclado; o mouse só clica no GO/canvas. |
| **Caminhos alternativos / linhas de risco-recompensa** | ❌ Não iniciado | Era um ponto em aberto do GDD; a pista é uma linha única com ombros largos. |
| **Menu/seed/favoritos de pistas procedurais**, salvar/compartilhar seed | ⚠️ Parcial | Já há procedural aleatória por padrão, `?track=proc&seed=N`, botão NOVA e FIXA; não há menu de seeds, histórico, favoritos nem editor (editor é extensão, não está explícito no GDD). |
| **Vários carros/modelos de rally** | ❌ Não iniciado | Parte da progressão; existe um único carro low poly. |

**Observação importante:** a seção de **controles touch do GDD (drag + soltar para frear)** foi **substituída** pelo esquema atual de GO + auto-aceleração + 5 botões. Isso não é uma pendência; é uma decisão de playtest. O GDD precisa ser atualizado nesse ponto.

**Já além do GDD:** o gerador procedural saiu de “fora do MVP” e virou o modo padrão; o touch de 5 botões com combos e menu MÃO também não estava previsto no GDD. A pista fixa continua como test track.

---

## 2. O que já está pronto e deve ser preservado

### Loop e corrida

- Corrida A→B, 4 setores alternados floresta/deserto, 3 parciais, medalha e retry instantâneo.
- **Pista fixa** `track01-v3` de **1096,8 m** (seed 91), 4 setores, raio mínimo 30,2 m, 2 rampas, 4 powerups, 50 obstáculos.
- **Pista procedural** gerada por seed, agora **default ao abrir `/`**.
- GO com carro parado; auto-aceleração depois do start; sem game over.
- Melhor tempo por pista, resultado com medalha, parciais e `NOVO RECORDE`.
- Powerups: turbo (~2 s) e grip extra (10 s), com renovação de timer.
- Tela de resultado, retry e reinício por R.

### Controles atuais

- **Touch:** 5 botões no stack inferior — ◀/▶ puros, ◀F/▶F (esterço + freio no mesmo dedo), FREIO largo. Padrão à direita; menu **MÃO** alterna para a esquerda e persiste em `localStorage['rally.controls.side.v1']`.
- **Desktop:** stack touch oculto; GO “CLIQUE OU ENTER”; teclado A/← esquerda, D/→ direita, S/↓ freio, Espaço handbrake, R reset, H telemetria.
- **Multi-touch** funciona para dois dedos; o combo ◀F/▶F resolve uma mão.
- GO, toque no canvas, W/↑/Enter iniciam.

### Carro, pista e feedback

- `maxSpeed` **39,1 m/s (~141 km/h)**, `engineAcceleration` **11,5 m/s²**, `brakeMax` **13,8 m/s²**.
- Derrapagem solta e recuperável; grip de cascalho 4,6 / areia 2,9 / off-road 2,2 e 1,8.
- Off-road: cap de **65%** (floresta) / **62%** (deserto), freio extra 10/8 m/s², perda de ~35–38% em ~2,1 s.
- Rumble de câmera 0,15 m escalado por piso.
- Poeira v7: pool 96, até 55/s, começa em 4°, satura em 24°, partículas 0,40–0,85 m, sobe 1,3–2,5 m/s, vida 0,60–1,10 s.
- **Hairpin extremo:** 13–14 m, 1 por pista procedural, sweep 170–185°, largura 5,2–6,2 m, aproximação 45–60 m.

### Procedural v7

- **7 categorias**: longa, média, curta, cotovelo, hairpin normal 20–23 m, hairpin extremo 13–14 m, kink 140–220 m / 6–15°.
- Pista **1518–1624 m**, setores ~354–438 m, largura 4,6–15,0 m, chokes 4,6–5,4 m, longos estreitos 5,5–7 m, largos 13–15 m.
- 6–8 powerups, 50–75 obstáculos, 2–3 platôs planos (20–25% da pista), separação mínima 40 m, A→B.
- **100/100 seeds válidas** (1–100); 1 hairpin extremo por seed.
- Medalhas procedurais: ouro **45,2–48,2 s**, prata +6 s, bronze +12 s; parciais no ritmo do ouro.
- Pista fixa: ouro **39 s**, prata **45 s**, bronze **51 s**; parciais **8,9/17,9/26,8 s**.

### Default e URLs

- `/` → procedural aleatória 1–100 a cada abertura/reload (URL não é reescrita).
- `?track=fixed` → pista fixa.
- `?track=proc&seed=N` → procedural determinística (1–100).
- `?track=proc` sem seed → aleatória.
- **FIXA** navega para `?track=fixed`; **NOVA** gera `?track=proc&seed=N`.
- `?debug=1` / `#debug` → telemetria + painel lil-gui.
- `?s=<m>` → teleporta e volta a READY; usar com `track=fixed` ou `proc&seed` se quiser pista estável.
- `?touch=1` / `?touch=0` → força mostrar/ocultar controles touch (QA).

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
- Atualizar o GDD para o esquema de controle atual (5 botões, GO, auto-throttle) e para o default procedural.

---

## 6. Arquitetura e comandos

### Arquivos-chave

- `src/game/Game.ts` — boot, `resolveTrackDef`, loop, estados, render, integração de FX.
- `src/game/config.ts` — `CAR_TUNING`, `SURFACES`, câmera, input, body, powerups, corrida.
- `src/game/Race.ts` — cronômetro, parciais, medalhas, melhor tempo.
- `src/car/Car.ts` — física, grip, off-road, saltos.
- `src/car/CarView.ts` — carro low poly, suspensão visual, rodas.
- `src/camera/ChaseCamera.ts` — câmera de perseguição, shake/rumble.
- `src/input/Input.ts` — GO, auto-throttle, 5 botões, teclado, multi-touch.
- `src/ui/Hud.ts` — HUD, GO, stack, menu MÃO, botões NOVA/FIXA.
- `src/ui/Results.ts` — resultado/medalha/retry.
- `src/fx/DriftDust.ts` — poeira.
- `src/track/track01.ts` — pista fixa congelada (seed 91).
- `src/track/procedural/ProceduralTrack.ts` — gerador v7 + legado.
- `src/track/Track.ts` — spline, sampler, largura 4,4–15,2, off-road.
- `src/track/TrackMesh.ts` — malha da pista/ombros/placas.
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
- Última validação live: default procedural, FIXA, seed determinística, medalhas 39/45/51 e 45,2–48,2, touch 5 botões, desktop oculto, console limpo.

### Testes de regressão que valem manter

- `/` 3× → seeds procedurais diferentes.
- FIXA → `?track=fixed` e 1096,8 m.
- NOVA → `?track=proc&seed=N`.
- `?track=proc&seed=7` → `proc-7`.
- Pista fixa: resultado 39/45/51; procedural seed 1 ≈ 46,5/52,5/58,5.
- 100/100 seeds; 1 hairpin extremo por seed; raio 12,7–13,8 m.
- Freeze byte a byte de `track01.ts`.
- Touch 5 botões / desktop sem stack; GO/teclado; console limpo.

---

## 7. O que não refazer

- Esquema de 5 botões, GO, auto-aceleração e menu MÃO.
- Derrapagem solta e recuperável; não “colar” o carro no chão.
- Off-road com cap 65/62%, freio extra 10/8 e rumble mais forte.
- Default procedural e FIXA/NOVA.
- Hairpin extremo 13–14 m (aprovado).
- Medalhas +3 s como base (testar mais).
- Pista fixa congelada e o perfil legado do gerador.
- Tuning em `rally.tuning.v4`.
