# Implementation Plan — Rally Arcade MVP

Oct 27, 2026 · Baseado no `Mini GDD - Rally Arcade v2.md`

Este documento é a referência de implementação do MVP. Se uma nova sessão começar, leia primeiro o GDD e depois este plano.

## 1. Objetivo do MVP

Validar se **dirigir é gostoso com uma mão só**, antes de investir em arte, conteúdo e progressão. O protótipo precisa entregar o ciclo completo:

> toque para acelerar → derrapar → sair da pista e se recuperar → trocar de cenário → chegar → medalha → reiniciar em 1 toque

Critérios de sucesso:

- 60 fps em celular de médio porte.
- Corrida completa de 30–60 s com dois pisos claramente diferentes.
- Hairpin com freio de mão funcional; cascalho e areia com sensações distintas.
- Reinício em menos de 1 s, sem menus intermediários.
- 5–10 tentativas seguidas sem tédio (teste real do feeling).

Fora do MVP: progressão, loja, pista procedural, cenários extras, manobras aéreas, suspensão dinâmica, público, multiplayer e trilha sonora licenciada.

## 2. Decisões fechadas

| Área | Decisão |
|---|---|
| Stack | Vite + TypeScript estrito + three.js |
| Física | Própria, sem Rapier/Cannon |
| Passo de simulação | Fixo em 120 Hz, render interpolado |
| UI | DOM/CSS sobre o canvas |
| Painel de ajuste | lil-gui, acessível via `?debug=1` |
| Pista | Uma pista fixa autorada em TS (`src/track/track01.ts`) |
| Escala | 1 unidade = 1 metro |
| Pista | 799,8 m; 0–300 m floresta, 300–799,8 m deserto |
| Visual | Low poly procedural com primitivas |
| Áudio | Fora do MVP; apenas stretch opcional |
| Plataforma | Portrait-first no celular; PC com mouse como secundário |
| Deploy | GitHub Pages via GitHub Actions a cada push na `main` |
| Repositório | https://github.com/Rigato/rally-arcade |

Versões atuais no npm na data do plano: three `0.186.x`, vite `8.x`, lil-gui `0.21.x`, `@types/three` `0.186.x`.

## 3. Estrutura de arquivos

```
src/
├── main.ts
├── style.css
├── game/
│   ├── Game.ts          # bootstrap, cena, loop, orquestração
│   ├── Race.ts          # estados, cronômetro, parciais, medalhas, reinício
│   ├── config.ts        # defaults tipados de tuning
│   └── types.ts
├── core/
│   ├── Loop.ts          # passo fixo + acumulador + interpolação
│   ├── Spring.ts        # mola/amortecedor
│   ├── Rng.ts           # seed determinística
│   └── math.ts
├── input/
│   └── Input.ts
├── car/
│   ├── Car.ts           # física
│   ├── CarView.ts       # malha, rodas, roll/pitch, sombra
│   └── surfaces.ts
├── track/
│   ├── track01.ts       # dados da pista
│   ├── Track.ts         # spline + sampler (s, u, altura, piso)
│   ├── TrackMesh.ts     # pista, ombros, placas, portais
│   ├── Obstacles.ts
│   └── Powerups.ts
├── world/
│   ├── Scenery.ts
│   └── Environment.ts
├── camera/
│   └── ChaseCamera.ts
└── ui/
    ├── Hud.ts
    ├── Results.ts
    └── TuningPanel.ts
```

Fluxo por frame:

`Input → Car.step(dt fixo) → Track.project/height/surface → Race (splits/fim) → CarView (interpolação) → ChaseCamera → Hud`

Sem framework de estado e sem event bus. O `Game` coordena os módulos e usa callbacks simples para pickup, parcial e chegada.

## 4. Física e sensação

### Modelo

Estado: posição, heading (yaw), velocidade no mundo, velocidade vertical, `onGround`, `yawRate`.

A cada passo fixo:

1. Esterço define a guinada alvo: `yawTarget = steer × maxYawRate × f(speed) × surface.steer`. `f(speed)` cresce de zero até ~6 m/s e cai levemente no topo.
2. Rotaciona o heading e decompõe a velocidade em longitudinal/lateral no referencial do carro.
3. Longitudinal: motor − arrasto quadrático − rolamento − freio − componente da gravidade na inclinação.
4. Lateral: `vLat *= exp(-grip × dt)`. A derrapagem nasce do carro girar enquanto a velocidade continua reta; o grip puxa a velocidade para o heading.
5. Freio de mão: grip × ~0,28, desaceleração moderada, resposta de esterço levemente maior; permite jogar o carro de lado no hairpin.
6. Frear ao soltar: rampa de ~30% até 100% em ~0,55 s.
7. Inclinação: diferença de altura entre frente e traseira gera aceleração/desaceleração gravitacional.
8. Ar: sem esterço, gravidade ~24 m/s², sem grip lateral; heading mantém.
9. Colisão: dois círculos (frente/traseira) contra círculos de obstáculos; resolve penetração, ricochete com restituição ~0,25 e perda forte de velocidade, sem teletransporte.

### Valores iniciais de tuning

| Parâmetro | Inicial |
|---|---|
| Aceleração do motor | 10 m/s² |
| Velocidade máxima | 34 m/s |
| Arrasto | `0.003 × v²` + 0,5 m/s² de rolamento |
| Guinada máxima | 2,0 rad/s |
| Resposta de esterço | tau 0,10 s |
| Freio máximo | 12 m/s² (rampa 3,5 → 12 em 0,55 s) |
| Gravidade no ar | 24 m/s² |
| Turbo | +30% de velocidade e força por 2 s |

### Pisos

| Superfície | Grip (1/s) | Acel. | Arrasto | Bump | Onde |
|---|---|---|---|---|---|
| Cascalho | 6,5 | 1,0 | 1,0 | 0,6 | pista da floresta |
| Areia | 3,8 | 0,85 | 1,25 | 0,9 | pista do deserto |
| Fora — floresta | 3,4 | 0,8 | 1,7 | 1,4 | ombro/mato |
| Fora — deserto | 2,7 | 0,7 | 2,0 | 1,8 | dunas/areia fofa |

Todos os valores devem ser ajustáveis ao vivo pelo painel. Nenhum número é definitivo.

### Saltos

Elevação analítica: spline base + kickers autorados (rampa curta e queda). Quando a altura do chão cai mais rápido que a trajetória balística, o carro decola com a velocidade vertical da rampa. No pouso, a mola visual da suspensão absorve o impacto. Sem controle no ar.

### Suspensão visual

Hierarquia: `carRoot` (posição + yaw + alinhamento ao chão) → `bodyPivot` (roll/pitch) → carroceria. Rodas no `carRoot`, com giro e esterço visual; traseiras travam no freio de mão. Roll vem da aceleração lateral; pitch da aceleração/frenagem; pouso injeta velocidade na mola. A suspensão não altera a física neste MVP.

## 5. Pista e mundo

### Dados

```ts
type TrackDef = {
  id: string;
  points: { x: number; z: number; y: number; width: number }[];
  zones: { start: number; end: number; id: 'forest' | 'desert'; surface: 'gravel' | 'sand' }[];
  kickers: { s: number; length: number; height: number }[];
  obstacles: { type: 'rock' | 'tree' | 'log'; s: number; u: number; radius: number }[];
  powerups: { type: 'turbo' | 'grip'; s: number; u: number }[];
  splits: { s: number; name: string; target: number }[];
  medals: { gold: number; silver: number; bronze: number };
};
```

Centro da pista com Catmull-Rom centrípeto; largura interpolada por ponto; elevação própria. Objetos posicionados em coordenadas de pista `(s, u)`.

### Composição da pista fixa

- 799,8 m; 0–300 m floresta, 300–799,8 m deserto. Largada em s=22 e chegada em s=796,3.
- Largura entre 7 e 14 m.
- Elevação de ±7 m, com pelo menos duas subidas/descidas.
- Dois hairpins (um por cenário).
- Dois saltos, com área de pouso limpa.
- Portal visual na troca de cenário e portal de chegada.
- 2 turbo + 2 grip, fora da linha ideal.
- ~60 obstáculos sólidos entre 1 e 18 m da borda.
- 1 parcial em 400 m com tempo-alvo.

### TrackSampler

API única usada pela física e pela geração de malha:

- `sampleAt(s)` → posição, tangente, normal, largura.
- `project(worldPos, hintS)` → `s`, `u`, distância; busca local com fallback global.
- `heightAt(s, u)` → altura analítica, incluindo ombros e bumpiness.
- `surfaceAt(s, u)` → piso + cenário.

**Regra crítica:** a malha visual e a física leem a mesma função de altura.

Malha em faixas de 1 m. Ombros de 6 m por lado, com relevo off-road; o limite de recuperação fica 5,5 m além da borda. Um backdrop visual suavizado cobre o resto do terreno.

### Cenário

- Floresta: pinheiros, pedras, chão verde-terroso, névoa fria.
- Deserto: cactos, pedras claras, areia, névoa quente.
- `InstancedMesh` + seed fixa.
- Transição visual em ~30 m antes do portal; física troca exatamente em 400 m.
- Sem shadow maps; blob shadow sob o carro, que cresce/clareia no ar.

## 6. Câmera

- Terceira pessoa, ângulo alto (~48–52°), calibrada para portrait.
- Segue a **direção do movimento**, não o heading.
- Suavização: posição ~0,12 s; yaw ~0,35 s. Abaixo de ~2 m/s usa o heading.
- Carro em ~65–68% da altura da tela.
- FOV 60° em portrait; +6° com turbo/velocidade; shake em impacto/piso ruim.
- `cameraY = max(desiredY, groundY + 2 m)`.
- Distância, altura, look-ahead, lag e FOV no painel.

## 7. Controles

### Touch (uma mão)

- Acelerar: qualquer toque no canvas.
- Esterçar: deslocamento horizontal em relação ao ponto inicial; lock total em ~32% da largura (≈128 px em 400 px), deadzone 5 px, suavização 0,08 s.
- Frear: soltar o dedo inicia a rampa.
- Freio de mão: modo padrão por deslocamento além de ~110% do lock; modo botão disponível no painel.
- Reiniciar: botão fixo no topo.

### Mouse / teclado

- Mouse: mesmo esquema.
- Teclado: WASD/setas, Espaço = freio de mão, R = reiniciar, H = telemetria, P = pausa.

### Mobile

- `touch-action: none`, `user-select: none`, `overscroll-behavior: none`.
- `100dvh`, safe-area insets, alvos de toque ≥44 px.
- `pointercancel` tratado como soltar.
- HUD com `pointer-events: none`, exceto botões.
- Resize/reorientação preserva o estado.
- Auto-pause em `visibilitychange`.

## 8. Corrida, HUD e resultados

### Estados

`READY → RUNNING → (RECOVERING) → FINISHED`

- READY: carro na largada, cronômetro zerado, dica "TOQUE E ARRASTE". O primeiro toque inicia.
- RUNNING: cronômetro, parciais e coleta ativos.
- RECOVERING: fade rápido, reposicionamento na pista, fade in; cronômetro continua. Usado no limite do mundo e se o carro ficar preso ~2 s.
- FINISHED: cruza a chegada, desacelera, mostra resultado.

### HUD

- Topo central: cronômetro.
- Topo direito: reiniciar.
- Topo esquerdo: melhor tempo.
- Barra de progresso com parcial e posição.
- Banner de parcial na troca de cenário (tempo + diferença vs. alvo).
- Chips de powerup com tempo restante.
- Telemetria apenas em debug.

### Resultado

- Tempo total, medalha, tempos-alvo e parciais.
- Melhor tempo em `localStorage`.
- Botão "CORRER DE NOVO".
- Se não bateu medalha, mostrar quanto faltou para o bronze.

### Medalhas

Iniciais: ouro 43,0 s / prata 49,0 s / bronze 57,0 s; parcial-alvo 21,0 s. Após 10 corridas, recalibrar: ouro = melhor limpa + 2%; prata = +10%; bronze = +22%, limitado a 60 s.

## 9. Powerups

| Powerup | Efeito | Duração | Visual |
|---|---|---|---|
| Turbo | +30% de velocidade/aceleração, FOV e shake leve | 2,0 s | Anel laranja, rastro |
| Grip extra | Grip ×1,8 | 10 s | Anel azul, aura |

4 no total (2 de cada), fora da linha ideal. Pegar o mesmo tipo renova o timer; tipos diferentes coexistem. Cada pickup é coletado uma vez por corrida e reaparece no reinício.

## 10. Painel de ajuste e telemetria

Acessível por `?debug=1` (e tecla H no desktop):

- Carro: aceleração, velocidade máxima, arrasto, rolamento, freio máximo, curva do freio, guinada máxima, resposta, grip base.
- Pisos: grip/aceleração/arrasto/bump de cada superfície.
- Freio de mão: multiplicador de grip, frenagem, modo, limiar.
- Câmera: distância, altura, look-ahead, lags, FOV, shake.
- Suspensão: rigidez, amortecimento, roll/pitch.
- Powerups: duração e intensidade.
- Input: lock em px, deadzone, suavização.
- Ações: salvar, restaurar padrões, exportar JSON.

Telemetria: FPS, km/h, ângulo de escorregamento, `s/u`, piso, estado, `onGround`, tempo de voo.

## 11. Performance e mobile

- Orçamento: <100 draw calls, <150 mil triângulos, 60 fps em Android médio.
- `InstancedMesh` para vegetação/pedras.
- Sem shadow maps; blob shadow.
- `setPixelRatio(min(dpr, 2))`; queda adaptativa para 1,5 se FPS < 50.
- Névoa para esconder o fim do mundo.
- Pista + ombros em uma malha; sem pós-processamento.
- Teste em Chrome Android e Safari iOS via GitHub Pages (HTTPS).
- Evitar sincronizar `node_modules`/`dist` pelo Nextcloud.

## 12. Deploy — GitHub Pages

- `vite.config.ts` com `base: './'`.
- Workflow `.github/workflows/deploy.yml`: build Node, upload de `dist`, deploy no Pages a cada push na `main`.
- Pages configurado com source **GitHub Actions**.
- URL esperada: `https://rigato.github.io/rally-arcade/`.
- Tuning via `?debug=1`; valores em `localStorage` e exportáveis em JSON.
- Repositório público: o GDD em `Docs/` também fica público.

## 13. Roadmap por marcos

| Marco | Dias | Entrega | Critério de pronto |
|---|---|---|---|
| M0 — Fundação | 2 | Vite + TS + three, canvas portrait, loop fixo, chão liso, câmera provisória, HUD vazio, painel shell, git, Actions/Pages | Roda a 60 fps no desktop e no celular via Pages; `npm run build` limpo |
| M1 — Carro e feeling | 5 | Física de derrapagem, touch/mouse/teclado, rampa de freio, freio de mão, câmera, carro low poly com rodas | Donut, curva normal e hairpin com freio de mão; tuning no celular |
| M2 — Pisos | 2 | Cascalho/areia/fora, troca por zona, cores e respostas distintas | Mesma curva nos dois pisos com sensações claramente diferentes |
| M3 — Pista | 5–6 | Spline, elevação, largura, kickers, malha, sampler, saltos, alinhamento, suspensão visual, cenário | Percorrer 800 m sem buracos/float; dois saltos; portal no lugar |
| M4 — Fora da pista | 4 | Terreno acidentado, grip baixo, obstáculos, colisão/ricochete, limite e recuperação, decoração | Sair, trepidar, bater e voltar; recuperação com penalidade |
| M5 — Corrida completa | 4 | Powerups, cronômetro, distância, parciais, medalhas, reinício, resultado, melhor tempo, polimento | Ciclo completo 3 vezes seguidas |
| Buffer | 3–4 | Tuning com testes, bugs, performance, build final, README | Protótipo jogável e ajustável |

Total estimado: ~25 dias úteis + buffer. Áudio, se entrar, consome 1–2 dias do buffer.

## 14. Validação

- Por marco: checklist manual + build TypeScript limpo. Teste no celular após M1 e M3, não só no fim.
- Validador de pista no boot: autointerseção, raio interno pequeno, kicker sem pouso, obstáculo/powerup fora da faixa, splits fora de ordem.
- Física: 10 voltas, tempos; tunneling na velocidade máxima, pouso, rampa de freio, recuperação.
- Medalhas: 10 corridas, melhor tempo limpo, fórmula, congelar valores no `track01.ts`.
- Dispositivos: Chrome Android, Safari iOS, Chrome desktop. Testar resize, rotação, background/foreground e toque no HUD.
- Playtest final: 3–5 pessoas por 5–10 minutos.

## 15. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Esterço por deslocamento impreciso | Testar no celular no M1; lock/deadzone/suavização no painel |
| Câmera confusa na derrapagem | Seguir direção do movimento com lag ajustável; testar heading como fallback |
| Saltos grudados/exagerados | Kicker + checagem balística + epsilon de pouso |
| Malha e física divergirem | Uma única função `heightAt` |
| Pista autointersectando | Validador no boot e autoria com margem de largura |
| Carro preso em obstáculo | Ricochete + recuperação automática após ~2 s |
| Performance no celular | Instancing, sem sombras, DPR limitado, névoa |
| Escopo crescer | Checklist congelado; áudio/procedural/arte externa só stretch |
| Safari/iOS | `dvh`, safe-area, `touch-action`, pointercancel |
| Nextcloud sincronizando build | Excluir `node_modules`/`dist` da sincronização |

## 16. Defaults para pontos em aberto do GDD

| Ponto | Proposta |
|---|---|
| Freio de mão | Deslocamento > ~110% do lock; modo botão no painel |
| Câmera | Yaw tau 0,35 s; posição 0,12 s |
| Curva do freio | 30% → 100% em 0,55 s |
| Turbo | 2,0 s |
| Tempos-alvo | Ouro 43 / prata 49 / bronze 57 s (recalibrar) |
| Caminhos alternativos | Fora do MVP; seções largas permitem escolher linha |
| Limite do mundo | 5,5 m além da borda da pista; ~1,2 s de penalidade |

## 17. Definition of Done do MVP

| Item do GDD | Verificação |
|---|---|
| Acelerar, esterçar, derrapar, frear, freio de mão em touch e mouse | Uma volta completa em cada dispositivo, sem teclado |
| Painel de ajuste de grip, aceleração, arrasto, esterço e freio | Alterar ao vivo e persistir após reload |
| Suspensão e roll visuais, incluindo pouso | Roll visível; carro afunda e volta no pouso |
| Turbo e grip extra | Coletar, ver HUD, renovar timer, sentir efeito |
| Floresta/cascalho e deserto/areia | Mesma curva nos dois pisos com comportamento distinto |
| Pista fixa de 30–60 s com elevação, largura variável e salto | Completar em 3 faixas de tempo |
| Fora da pista recuperável, obstáculos, ricochete, limite | Sair, bater, voltar; limite recupera com perda de tempo |
| Cronômetro, distância e parcial | Conferir split em 300 m e distância |
| Medalhas e reinício no topo | Fechar com cada medalha e reiniciar em 1 toque |

## 18. Autenticação e publicação

Concluído em Oct 27, 2026:

1. Identidade local: `George Rigato <4633395+Rigato@users.noreply.github.com>`.
2. Autenticação via `gh` (conta `Rigato`, HTTPS) e `gh auth setup-git`.
3. `git push -u origin main` — commits até `37cf79e` publicados.
4. Pages habilitado com **Build type: workflow** (`gh api repos/Rigato/rally-arcade/pages`).
5. Workflow de deploy executado com sucesso; URL validada com HTTP 200 e smoke test headless:
   <https://rigato.github.io/rally-arcade/>

Para publicar novas mudanças, basta `git push` na `main`. A URL de debug é
`https://rigato.github.io/rally-arcade/?debug=1`; o teleporte de inspeção é
`?debug=1&s=780`.

## 19. Como retomar em outra sessão

1. Ler `Docs/Mini GDD - Rally Arcade v2.md` e este plano.
2. `npm install`.
3. `npm run dev -- --host` e abrir no navegador/Pages.
4. Verificar o último marco concluído na seção 13 e seguir para o próximo.
5. Usar o painel `?debug=1` para tuning; exportar os valores e congelar em `src/game/config.ts`/`track01.ts` antes de fechar um marco.

## 20. Status de implementação — Oct 27, 2026

### Concluído

- **M0** — Vite + TypeScript + three.js, loop fixo de 120 Hz, canvas portrait, HUD e deploy workflow.
- **M1** — física de derrapagem, touch/mouse/teclado, freio com rampa, freio de mão, câmera seguindo o movimento, visual do carro com roll/pitch e painel lil-gui com persistência.
- **M2** — pisos cascalho/areia/fora de pista com grip, aceleração, arrasto e resposta diferentes.
- **M3** — pista spline de 799,8 m, dois hairpins, elevação, largura variável, dois kickers, saltos balísticos, suspensão visual, cenário low poly, portais e marcadores.
- **M4** — fora de pista acidentado, trepidação de câmera, limite e recuperação com penalidade, auto-unstick, 54 obstáculos sólidos com ricochete e flash de impacto.
- **M5** — cronômetro, distância, barra de progresso, parcial em s=300, medalhas, melhor tempo em localStorage, tela de resultado e retry.
- **M5b** — powerups turbo (2 s) e grip extra (10 s), 4 pickups na pista, efeitos na física, renovação de timer, chips no HUD e reset.

### Decisões que divergiram do plano original

- Largada em s=22 (não s=4) para a câmera não mostrar o vazio atrás do carro.
- Chegada em s=796,3 (3,5 m antes do fim da malha).
- Ombros de 6 m e limite off-road de 5,5 m além da borda (não 24 m da centerline).
- Backdrop visual suavizado por blend entre pernas paralelas, para evitar paredes no switchback.
- Escala de obstáculos: 54 no total (18 rochas, 18 árvores/cactos, 18 troncos).
- Powerups: turbo em s=120/u=+1,6 e s=600/u=-1,6; grip em s=200/u=-1,2 e s=440/u=+1,2.
- Câmera final: distância 15,5; altura 15,2; lookAhead 7,5; FOV 60.

### Publicado

- Push na `main` feito; Pages habilitado com source **GitHub Actions**; workflow verde.
- URL live: <https://rigato.github.io/rally-arcade/>
- Debug: <https://rigato.github.io/rally-arcade/?debug=1>
- Smoke test headless do build publicado: HTTP 200, carro andando, 54 obstáculos e 4 powerups carregados, 0 erros de console.

### Pendente

- **Teste em dispositivo real:** validar touch, safe-area, performance e sensação no celular; o headless/SwiftShader é apenas smoke test.
- **Calibração final:** rodar 10 voltas, ajustar tempos-alvo/medalhas e exportar o tuning; os valores atuais (43/49/57 s) são provisórios.
- **Powerups:** a duração/efeito está implementada, mas o balanceamento (2 s/10 s) ainda não foi testado em corrida completa.
- **Playtest de feeling:** confirmar lock do esterço, freio de mão por deslocamento vs. botão e atraso da câmera.

### Verificação atual

- `npm run typecheck` passa.
- `npm run build` passa; único aviso é o tamanho do chunk (>650 kB, ~688 kB minificado / ~178 kB gzip), aceitável para o protótipo.
- Validações headless: saltos, colisões, recuperação, parcial, resultado, retry e powerups sem erros de console.

## 21. Revisão pós-playtest — controles (Oct 27, 2026)

O primeiro teste em celular rodou estável, mas o feeling reprovou: o carro demorava a entrar na derrapagem, o centro do esterço era sensível demais (chicote) e não era possível frear e virar ao mesmo tempo.

### O que foi implementado

- **Esquema `drag2d` (novo padrão):** segurar acelera; arrastar na horizontal esterça; arrastar para baixo freia sem soltar o dedo. O freio é analógico (0..1) e corta o motor; o carro continua esterçando.
- **Esquema `release` (antigo):** continua disponível no painel para comparação; soltar o dedo aplica a rampa.
- **Guia de toque:** anel + ponto no encosto do dedo, mostrando X (esterço) e Y (freio); pode ser desligado no painel.
- **Sensibilidade:** deadzone de 12 px, curva exponencial 1,35, lock em 34% da tela, suavização de 0,16 s e resposta de guinada mais lenta (tau 0,16 s, referência 9 m/s).
- **Carro mais solto:** grip de cascalho 5,6 / areia 3,4; queda de grip conforme o slip (`slipGripFalloff` 0,18); redução de grip ao frear na curva (0,12); handbrake 0,24.
- **Carroceria:** roll máximo 12°, 0,014 rad por m/s² lateral + 0,03 rad por esterço; pitch 5°.
- **Câmera:** yaw tau 0,42 para reduzir o efeito de chicote visual.
- **Tuning v2:** `localStorage['rally.tuning.v2']`; novos campos de Input/Carroceria; o v1 é ignorado para não carregar valores antigos.

### O que ainda depende do teste

- Validar no celular se o carro entra na derrapagem cedo o suficiente e se o centro ficou dócil.
- Comparar `drag2d` e `release`; escolher o padrão final.
- Ajustar grip, slip falloff, deadzone, lock e a força do freio vertical com o painel `?debug=1`.
- Aumentar a rolagem se 12° ainda parecer pouco (ou reduzir se exagerar).

## 22. Protótipo procedural — primeiro passo (Oct 27, 2026)

A primeira versão independente está em:

- `src/track/procedural/ProceduralTrack.ts` — `generateProceduralTrack(seed)` e `validateProceduralTrack`.
- `src/track/procedural/rng.ts` — PRNG determinístico.
- `scripts/proc-validate.ts` — 20/100 seeds, estatísticas e preview SVG.

Características: serpentina de 4 pernas e 3 hairpins (raio 25,5–34 m), 4 zonas alternadas, 3 parciais, 1–2 kickers baixos (1,0–1,5 m), 30–60 obstáculos a ≥5 m da borda, 4–6 powerups, 979–1112 m. Validação: **100/100 seeds válidas**, determinismo OK.

A integração de debug está pronta: `?debug=1&track=proc&seed=1` carrega a pista gerada usando os mesmos sistemas multi-zona, splits, powerups, cenário e HUD. O sistema ainda não tem menu de seeds, editor, nem usa a lista de obstáculos autorada pelo gerador (o `Obstacles` atual gera a sua própria lista válida a partir do `Track`); é um protótipo, não o sistema final.

## 23. Pista fixa v2 — concluída (Oct 27, 2026)

- **1034,5 m** em **circuito fechado**, 4 setores alternados: 0–250 floresta, 250–500 deserto, 500–750 floresta, 750–fim deserto.
- Largura **10,5–12,0 m**; raio mínimo **36,5 m**; sem hairpins; quatro curvas de 90° com R≈50 m e S suaves.
- Inclinações longas de ~5% e crista curta de 8,6%; duas rampas de **1,2 m × 6,5 m** com 55,5 m e 120,5 m de pouso/run-out.
- **Ombros de 12 m**, limite off-road de 12 m, **50 obstáculos** a 5–10 m da borda (18 rochas, 15 árvores/cactos, 17 troncos).
- **6 powerups** (3 turbo, 3 grip), turbos depois dos pousos; **3 parciais** em 250/500/750; medalhas 55/62/72 s.
- Multi-zona em `TrackMesh`, `Environment`, `Scenery`, `Gates` e `Obstacles`; `zones.ts` centraliza o blend.
- HUD/Race/Results com 3 parciais; `scripts/validate-track.ts` + `npm run validate:track` validam o layout.
- Validação: comprimento 1034,5 m, raio 36,5 m, sem autointerseção, rampas com pouso, parciais e obstáculos OK.

**Desvio consciente:** o traçado v2 é um **circuito fechado** (chegada geometricamente perto da largada), não uma pista A→B. Foi a forma de caber 4 setores, curvas de 36 m+ e ombros de 12 m no espaço do protótipo. O gerador procedural entrega uma topologia ponto-a-ponto para comparar; se o circuito não agradar, o próximo passo é converter a pista fixa para aberta.

### Integração final

- `?debug=1&track=proc&seed=N` carrega a pista procedural; a pista fixa v2 é o padrão.
- Track id fixo atualizado para `track01-v2`, resetando o melhor tempo antigo.
- `RACE_TUNING.medals` recebe as medalhas da pista no boot; o painel ainda ajusta em runtime.
- Deploy atual: commit `e7d041b`, Pages verde, smoke test live em fixed e `proc seed=1` sem erros de console.

## 24. Revisão pós-playtest PC (Oct 28, 2026)

O teste seguinte foi no PC, com teclado. O controle ficou confortável, mas revelou decisões novas:

### Touch

- A corrida começa com o carro **parado** e um botão **GO!** central; tocar na tela ou no GO inicia o cronômetro.
- Depois do GO, o carro **acelera sozinho sempre**; o jogador só esterça e freia.
- Touch passa a usar **3 botões**: esquerda, direita e freio. Segurar; frear+esterçar exige dois dedos, decisão consciente para manter o controle simples.
- O esquema antigo de arrastar/guia de toque sai do fluxo. O freio de mão fica no teclado (Espaço) por enquanto; não há 4º botão no touch.

### Teclado

- A inversão do esterço precisa ser corrigida: **A/← deve virar para a esquerda na tela**, D/→ para a direita. O sinal atual está trocado pela convenção câmera/mundo.
- O carro acelera sozinho depois do start também no PC; W/↑/Enter iniciam, S/↓ freiam, R reinicia.

### Derrapagem

- O carro ainda está "no trilho". A próxima rodada reduz grip base, aumenta a queda de grip com o slip e adiciona redução de grip com esterço/velocidade, com o objetivo de **20–35° de slip** em esterço cheio e recuperação por contra-esterço/freio. Os parâmetros ficam no painel.

### Pista

- **Circuito fechado reprovado.** A pista fixa passa a ser **A→B**.
- A base será uma seed procedural curada (a linguagem das seeds foi aprovada), congelada em `track01.ts` como pista fixa; a pista deve ter 4 setores, ~1 km, 3 parciais, rampas baixas e curvas amplas.
- O `Obstacles` continua gerando a lista a partir das zonas; a lista autorada do `TrackDef` fica como documentação/validação por enquanto.

### Botão de pista aleatória

- Na pista de teste, um botão no topo gera um seed aleatório **1–100** e carrega a pista procedural; um controle secundário volta à pista fixa.
- O carregamento procedural deve funcionar sem `?debug=1`; o painel de tuning continua opt-in.

### Execução

- Três worktrees em paralelo: controles/GO/botões, física de derrapagem, pista A→B.
- O limite do modelo free continua estourado; fallback combinado para DeepSeek V4.1 Flash do Go, reasoning low.
- Os três trabalhos voltaram e foram integrados na `main` (merges `81c9f85` e `a32d299`, pista em `bd06f45`). A validação e o deploy estão na seção 25.

## 25. Integração v3 — concluída (Oct 28, 2026)

### Controles e HUD

- **READY:** carro parado, cronômetro zerado, overlay **GO!** com “TOQUE PARA LARGAR”. GO, toque no canvas ou W/↑/Enter iniciam; o timer só começa aí.
- **RUNNING:** auto-throttle sempre ligado; o freio corta o motor no `Car`. RECOVERING/FINISHED desligam a auto-aceleração.
- **Touch:** três botões DOM — ◀/▶ no canto inferior esquerdo e FREIO no canto inferior direito — com alvos ≥64 px, safe areas e `pointer capture`. Mapa `pointerId → controle` permite frear e esterçar com dois dedos. O toque nos botões não chega ao canvas.
- **Teclado:** A/← = esquerda na tela (`steer +1`), D/→ = direita; S/↓ freia; Espaço = freio de mão; R reinicia. O sinal antigo estava invertido e foi corrigido.
- **Pista:** `🎲 NOVA` sorteia seed 1–100 e recarrega com `?track=proc&seed=N`, preservando `debug=1`; `FIXA` remove `track/seed`. Ambos removem `s` para não teleportar para um `s` inválido da outra pista. Clique não inicia corrida.
- **Carregamento procedural** funciona sem `?debug=1`; o painel de tuning continua opt-in.
- `TouchGuide`, o drag steering e o botão antigo de freio de mão foram removidos. O CSS morto saiu junto.
- Powerups foram para o topo esquerdo, abaixo da barra de progresso, para não colidir com os controles.

### Derrapagem

| Parâmetro | Valor final |
| --- | ---: |
| Grip cascalho / areia / fora-floresta / fora-deserto | 4,6 / 2,9 / 2,2 / 1,8 |
| `slipGripFalloff` | 0,30 |
| `steerGripReduction` | 0,18 |
| `yawBoost` | 0,10 |
| `maxYawRate` | 2,20 |
| `steerResponseTau` | 0,15 |
| `brakeGripReduction` | 0,15 |
| `handbrakeGripMultiplier` | 0,23 |

- Simulação direta do `Car` a 120 Hz: **33,8° de slip a 20 m/s** com esterço cheio por 1,5 s (35,6° a 10 m/s, 29,3° a 30 m/s). Recuperação para <8° em **0,29–0,40 s** com contra-esterço + freio/acelerador; freio de mão a 18 m/s gera 30,5° e recupera em 0,28 s. Nenhum NaN em 60 s alternando entradas.
- O `yawBoost` só atua com pouco slip (fade até ~28,6°) e respeita o `surface.steerMultiplier`; ele inicia a rotação sem realimentar o pião.
- Fora de pista o carro fica deliberadamente muito solto (areia ~54°, floresta ~62°, deserto ~67° em 1,5 s), exigindo contra-esterço mais cedo.
- Tuning salvo em `localStorage['rally.tuning.v3']`; a chave v2 é ignorada para não mascarar os novos defaults.

### Pista fixa A→B

- Seed procedural **91** congelada em `src/track/track01.ts` como **`track01-v3`**.
- **1096,8 m**, topologia aberta: serpentina de 4 pernas e 3 hairpins; largada e chegada a ~199 m em linha reta.
- 4 setores: floresta 0–250, deserto 250–500, floresta 500–750, deserto 750–1096,8.
- Raio mínimo **30,2 m**, largura 8,6–13,0 m, ombros de 12 m preservados.
- 2 rampas baixas: 1,00 m × 6,76 m em `s=395,6` e 1,38 m × 6,72 m em `s=687,3`, ambas com 40 m+ de pouso reto.
- 3 parciais em 250/500/750; 4 powerups (3 turbo + 1 grip), nenhum imediatamente antes das rampas; 50 obstáculos gerados (16 rochas, 16 árvores, 18 troncos).
- Medalhas **59,3 / 67,6 / 77,1 s**; inclinação máxima 12,3% em 10 m e 12,7% local.
- Congelamento com escala uniforme 1,1235 em x/z e elevação ×0,72, necessário para o raio ≥30 m e a inclinação ≤13% do `validate:track`.
- `scripts/select-track.ts` avalia seeds 1–100 com as regras do B1; `scripts/freeze-track.ts` reproduz o freeze e gera o SVG top-down.

### Testes

- `npm run typecheck`, `npm run build` e `npm run validate:track` passam (só o aviso já existente de chunk >650 kB).
- Headless 390×844: READY com GO e 0 km/h; GO → RUNNING com timer e aceleração automática; ◀/▶ movem o carro para a esquerda/direita **na tela**; FREIO reduz a velocidade; ◀+FREIO com dois pointers; R volta a READY; A/← e D/→ corretos no teclado; `🎲 NOVA` muda para `proc/seed` e `FIXA` volta; `?track=proc&seed=7` sem debug carrega; parcial e chegada disparam; console sem erros.
- Screenshots de capa atualizados: `Docs/screenshots/start-go.png` e `running-controls.png`.

### Pendências de playtest

- Calibrar o feeling da derrapagem no celular e decidir se o carro fora de pista está solto demais.
- Confirmar se os 3 botões são confortáveis em portrait e se frear+virar com dois dedos funciona na prática.
- Recalibrar medalhas e parciais com tempos reais.
- O freio de mão continua só no teclado; um 4º botão touch fica para outra rodada, se necessário.

## 26. Uma mão no touch e variedade procedural (Oct 28, 2026)

O playtest seguinte trouxe três correções: os traçados procedurais estavam todos parecidos (serpentina para um lado), os controles de toque apareciam no PC e o esquema de 3 botões não era confortável para jogar com uma mão.

### Controles touch v4

- **5 botões** no canto inferior direito por padrão:
  - linha 1: ◀ e ▶ puros (só esterço);
  - linha 2: ◀F e ▶F (esterço + freio no mesmo pointer);
  - linha 3: FREIO largo, sozinho.
- O stack mede ~118×184 px em 390×844 (56 px por botão, FREIO 60 px) e ~101×160 px em 320×568 (48 px / 54 px); safe areas respeitadas e sem cobrir o carro.
- O menu **MÃO** fica acima do stack, visível em READY/RUNNING, e escolhe **DIREITA** (padrão) ou **ESQUERDA**. A escolha é aplicada na hora e persistida em `localStorage['rally.controls.side.v1']`; o stack espelha mantendo a ordem das linhas.
- **Desktop:** o stack, o gatilho e o menu ficam ocultos. A detecção é `(pointer: coarse)` OU (`maxTouchPoints > 0` E `(hover: none)`), então notebook com touchscreen + mouse continua desktop. O GO troca o subtítulo para “CLIQUE OU ENTER”. Overrides de QA: `?touch=1` e `?touch=0`.
- **Input:** `InputControlBinding { element, steer, brake }`; cada pointer contribui com seu esterço/freio, então ◀F = `steer +1` + freio e ▶F = `-1` + freio. Pointer capture, multi-touch, blur e cancelamento continuam iguais; teclado intocado.
- O painel de tuning (opt-in) encolhe/desloca em touch para não cobrir a coluna de botões.

### Gerador procedural v2

- A serpentina fixa de 4 pernas foi substituída por uma **gramática de segmentos**: retas de 20–90 m e curvas em cinco categorias — longa (R 70–110 m, sweep 25–70°), média (45–65 m, 35–90°), curta (28–38 m, 45–110°), cotovelo (26–31 m, 75–120°) e hairpin ocasional (26–30 m, 150–180°).
- Cada seed usa **≥3 categorias**, curvas nos **dois sentidos**, no máximo 2 curvas seguidas para o mesmo lado e nenhum sentido com menos de 30% do sweep total.
- Candidatos são rejeitados por:
  - separação < **36 m** entre trechos não vizinhos (spatial hash, amostragem de 1 m, janela de 46 m ao longo da pista);
  - caixa > **450×450 m**;
  - chegada a < **100 m** da largada.
- Kickers são posicionados a partir dos metadados das retas, com 40 m+ de pouso e sem powerup a menos de 20 m antes.
- O gerador antigo continua exportado como `generateLegacyProceduralTrack(seed)` e é usado por `freeze-track.ts`/`select-track.ts` para reproduzir a pista fixa `track01-v3`. **A pista fixa não mudou.**
- Validação: **100/100 seeds (1–100)**, 1014–1148 m, raio mínimo 25,2–29,7 m, separação mínima 37,4 m, A→B 159–584 m, 32–56 obstáculos, 4–6 powerups e 1–2 kickers. Geração de 100 seeds em ~1,8 s.
- `scripts/proc-diversity.ts` gera métricas por seed e um contact sheet top-down; `Docs/screenshots/proc-variety.png` mostra 12 seeds.

### Testes

- 55/55 verificações de touch no headless: geometria em 390×844 e 320×568; ◀ puro sem freio; ◀F/▶F com freio máximo; FREIO puro; dois pointers ◀+FREIO; release zera; menu abre em READY/RUNNING sem iniciar corrida; troca de lado aplica e persiste; desktop sem stack/gatilho/menu, GO “CLIQUE OU ENTER”, Enter inicia e A esterça.
- Integração no jogo: seeds 5/23/61/97 carregam em READY com 50 obstáculos e 1054–1129 m; `🎲 NOVA` carrega `proc-79` (1024,8 m) e `FIXA` volta para `track01-v3` (1096,8 m); sem erros de console.
- `npm run typecheck`, `npm run build` e `npm run validate:track` passam; a pista fixa segue com 1096,8 m e raio 30,2 m.
- Screenshots: `start-go.png`, `running-controls.png`, `touch-hand-menu.png` e `proc-variety.png`.

### Pendências de playtest

- Testar os 5 botões em uma mão: se os combos ◀F/▶F resolvem frear+virar ou se atrapalham; decidir se o layout final fica em 3 ou 5 botões.
- Validar o menu MÃO e a persistência no celular real (incluindo recarregar e trocar de lado no meio da sessão).
- Avaliar se as curvas procedurais novas são variadas o suficiente e se algum raio curto/elbow ficou apertado demais na jogabilidade.
- Recalibrar medalhas/parciais com tempos reais; a pista fixa continua a seed 91 antiga (se o novo gerador agradar, dá para congelar uma nova seed depois).

## 27. Plano de ajustes v5 (Oct 28, 2026)

O playtest aprovou o protótipo e pediu uma segunda camada de variedade e sensação: curvas mais distintas, setores mais longos, relevo mais forte, largura agressiva com choke points, carro mais rápido e poeira na derrapagem.

### Curvas

- **Hairpin mais fechado:** raio **19–23 m**, sweep **160–180°** (antes 26–30 m). O validador procedural passa a aceitar raio mínimo ~16 m; a pista fixa continua com o validador B1 separado.
- **Nova categoria “mudança de rota” (`kink`):** curva muito curta e muito aberta, com raio **140–220 m** e sweep **6–15°** (arco de ~15–58 m). Cada pista tem **1–3**; ela muda levemente a direção de uma reta.
- Cada pista usa **≥4 das 6 categorias**, curvas nos dois sentidos e no máximo 2 curvas seguidas para o mesmo lado.

### Setores e comprimento

- Comprimento-alvo: **1400–1750 m** (antes 1014–1148 m), aumento de ~35–55% no total.
- Cada setor fica **35–65% mais longo** que os ~250–290 m atuais, com jitter de ±8% por setor. Limites de validação: setor **300–500 m**, pista **1300–1800 m**.
- 4 setores, 3 parciais em 25/50/75%, **1–2 kickers**, **6–8 powerups** e **50–75 obstáculos** para acompanhar o comprimento.
- Separação entre trechos sobe para **40 m** e a caixa máxima para **650×650 m**; a chegada continua a ≥100 m da largada.

### Elevação

- Amplitudes **×1,2**: onda longa 4,2–7,2 m, média 1,45–2,9 m, cristas 0,6–1,1 m.
- **2–3 faixas planas** de 70–150 m, totalizando 20–25% da pista, com transições suaves de 25–30 m e |grade| < 2%.
- Grade de construção máxima **30%**; validação aceita até **35%**.

### Largura

- Base **10,5–12 m**; trechos largos **13–15 m** (80–160 m).
- **Longos estreitos 5,5–7 m** (120–220 m) e **choke points 4,6–5,4 m** (50–90 m), com transições de 30–40 m.
- Cada pista tem **2–3 chokes**, ≥1 trecho longo estreito e 1–2 largos; chokes não ficam dentro de hairpin/cotovelo.
- Validação de largura: **4,4–15,2 m**. Powerups e obstáculos se adaptam à largura local.

### Carro e escape

- `engineAcceleration` **10 → 11,5** (+15%), `maxSpeed` **34 → 39,1** (+15%), `brakeMax` **12 → 13,8** (+15%).
- Off-road ganha **limite de velocidade** e **freio extra**: cap de **65%** da velocidade máxima na floresta e **62%** no deserto; desaceleração extra prevista em **6–7 m/s²**, calibrada para **10/8 m/s²** nos resultados para chegar ao cap em ~2,1 s.
- `SurfaceDef` ganha `speedLimit` e `offRoadBrake`; o tuning salvo passa para `rally.tuning.v4` para os novos defaults não serem mascarados pelo v3.
- A física de derrapagem/grip elogiada no playtest não muda.

### Poeira e trepidação

- Rumbling da câmera sobe de **0,10 → 0,15 m** e passa a ser escalado pelo `bump` do piso; fora de pista trepida mais, sem shake em pista lisa.
- Sistema de poeira simples com pool de **64 partículas**: emissão proporcional ao slip (limiar ~6°, cheio ~30°) e à velocidade (>5 m/s); vida 0,45–0,9 s; tamanho 0,25–0,8 m; opacidade 0,25–0,5; cores de cascalho/areia/fora de pista. Reset no retry, teleporte e chegada.

### Execução

- Três worktrees: **curvas/setores** (gerador), **física/off-road** (Car/config/types/store) e **poeira/trepidação** (novo FX + Game/ChaseCamera).
- Testes: 100 seeds válidas, contact sheet, screenshots de 3 seeds; simulação de aceleração/velocidade/freio/off-road; screenshots de poeira com slip baixo/alto; build, typecheck e validate:track.

### Resultados da implementação v5

- **Gerador:** 100/100 seeds válidas; pista **1517,8–1625,7 m**, setores **354,3–437,6 m**, raio mínimo **19,5–22,6 m**, largura **4,6–15,0 m**, separação **40,1 m**, A→B **148,7–804,8 m**, 20,2–24,9% de pista plana, 6–8 powerups e 50–75 obstáculos.
- **Curvas:** hairpin autorado 20–23 m (medido 19,5–22,6 m), kink 140–220 m / 6–15°, 1–2 hairpins e 1–3 kinks por pista. Em 100 seeds, todas usam ≥4 das 6 categorias e os dois sentidos.
- **Largura no jogo:** `Track.ts` ainda clampava 7–14 m; foi ajustado para **4,4–15,2 m**. Sem isso, os chokes de 4,6 m e os largos de 15 m seriam suavizados no render/física. A pista fixa (8,6–13,0 m) não mudou.
- **Pista fixa:** `track01-v3` intocada; `freeze-track.ts` reproduz o arquivo byte a byte pelo perfil legado. `validate:track` continua OK.
- **Física:** 11,5 m/s², 39,1 m/s e 13,8 m/s². Simulação: 0–100 km/h em **2,73 s** (antes 3,21 s), máxima **140,76 km/h**, frenagem de 39,1→0 em 2,49 s / 46,17 m. O freio ficou 15% mais forte, mas a distância aumentou 13,6% porque a energia cinética subiu ~32%.
- **Off-road:** cap de 65% (floresta) e 62% (deserto), com `offRoadBrake` final **10,0/8,0 m/s²** (acima dos 6–7 do plano, para chegar ao cap em ~2,1 s com acelerador mantido). A 39,1 m/s: floresta estabiliza em 25,42 m/s (~91,5 km/h) em 2,13 s; deserto em 24,24 m/s (~87,3 km/h) em 2,41 s. Nenhum corte instantâneo.
- **Rumble:** amplitude 0,15 m; fator de bump `clamp(0.7 + 0.25*bump, 0.7, 1.2)`, com `setRumble` aceitando até 1,2. Em pista lisa continua 0.
- **Poeira:** pool de 64 partículas; emissão só no chão, >5 m/s e >6° de slip. Teste sintético: ~2,5 partículas médias a 10°, ~14,7 a 30°, zero a 0° ou 4 m/s; dissipa em ~0,73 s. No jogo merged, slip 37,8° gerou 13 partículas e voltou a 0 após soltar.
- **Tuning:** chave `rally.tuning.v4`; o painel expõe `Limite vel. ×` e `Freio off-road` em Pisos.
- **Testes:** typecheck, build, validate:track, 100 seeds, 5 botões touch, desktop sem controles, pista fixa e procedural no jogo; console sem erros.

### Pendências do playtest v5

- Testar no celular se os chokes de 4,6–5,4 m são desafiadores ou frustrantes e se os trechos largos de 13–15 m dão a sensação de alívio desejada.
- Avaliar o hairpin de 19–23 m e o kink; talvez o hairpin ainda precise fechar ou abrir.
- Ver se a nova velocidade (141 km/h) e o freio +15% deixam as curvas curtas controláveis; o teste deve ser no celular.
- Validar a poeira e o rumble em movimento, além de confirmar se a poeira alta está sutil o suficiente.
- Recalibrar medalhas/parciais das pistas procedurais de ~1,5 km; os alvos atuais escalam com o comprimento, mas a velocidade +15% mudou o ritmo.
- A pista fixa continua com as medalhas antigas (59,3/67,6/77,1 s) na v5; isso foi resolvido na seção 28 com **36/42/48 s** e parciais 8,2/16,5/24,7.

## 28. Hairpin extremo, medalhas e poeira v6 (Oct 28, 2026)

O playtest aprovou kink, larguras e distâncias. O hairpin normal de 20–23 m ficou fácil demais — quase não exigia frear — e o usuário pediu uma variante extrema. Também pediu medalhas de ouro 36–46 s e poeira um pouco mais densa/subindo mais.

### Hairpin extremo

- **Normal:** 20–23 m / sweep 160–180° (inalterado).
- **Extremo:** **14–15 m / sweep 170–185°**, 1 por pista; normais 0–1 (total 1–2).
- Aproximação reta de **45–60 m**, saída de **35–60 m**, a ≥80 m da largada/chegada.
- Largura local **5,2–6,2 m**; a regra de separação de 40 m é afrouxada só para as duas pernas do próprio extremo (≥26 m).
- O raio ficou no topo da faixa 12–15 m (**14–15 m**) porque os ombros visuais de 12 m se encostam; em 14–15 m o interior vira um apron contínuo, sem costura evidente. Medido após a spline: **13,6–14,8 m**.
- Validação v5: raio mínimo pass **8 m**, warn **10 m**; legado continua 22/25.
- 100/100 seeds com exatamente 1 extremo; 55 à direita / 45 à esquerda; sem autointerseção.

### Medalhas e parciais

- Fórmula procedural: `gold = 36 + 10 * clamp((length - 1300)/350, 0, 1)`; `silver = gold + 6`; `bronze = gold + 12`.
- Nas 100 seeds (1517,7–1625,3 m): **ouro 42,2–45,3 s**, prata 48,2–51,3 s, bronze 54,2–57,3 s. Parciais no ritmo do ouro: `target = gold * s / length`.
- Pista fixa: **ouro 36 / prata 42 / bronze 48 s**; parciais **8,2 / 16,5 / 24,7 s**.
- O gerador legado mantém a fórmula antiga; `freeze-track.ts` aplica os valores fixos novos e reproduz `track01.ts` byte a byte.
- Observação física: 36 s em 1.518 m exigiria 42,2 m/s de média, acima da máxima de 39,1 m/s. Os 36–42 s do usuário provavelmente foram na pista fixa de 1,1 km; o ouro procedural atual é 42,2–45,3 s.

### Poeira v6

- Pool **80**; taxa máxima **34/s**; começa em **5°** e satura em **27°**.
- Subida inicial **1,0–2,0 m/s**; gravidade **0,25 m/s²**; vida 0,50–0,95 s; tamanho 0,30–0,65 m; alpha 0,28–0,55.
- Teste sintético a 20 m/s: 10° → média 3,67 / máx 6; 30° → média 16,3 / regime ~19 / máx 21; altura de pico 0,73 → 1,05 m. Zero a 0°/5°.
- No jogo: reta 0; 11° ≈ 4; 29–30° ≈ 10–12 ativos; dissipa em ~0,6–0,9 s.

### Testes

- `npm run typecheck`, `npm run build`, `npm run validate:track` OK; pista fixa 1096,8 m, 36/42/48.
- 100/100 seeds válidas; 1 hairpin extremo por seed; 4 zonas; 6–8 powerups; 50–75 obstáculos.
- Resultado procedural no jogo (seed 1): ouro **43,5 s**, prata 49,5, bronze 55,5; resultado fixo: 36/42/48.
- Touch 5 botões e desktop oculto; console sem erros.

### Pendências

- Testar se o hairpin de 14–15 m já obriga a frear o suficiente ou se precisa descer para **12–13 m** (aceitando mais sobreposição de ombros ou reduzindo o ombro local).
- Confirmar a experiência de ouro: 42,2–45,3 s nas procedurais e 36 s na fixa; ajustar prata/bronze e parciais depois.
- Avaliar a poeira v6 em movimento; se ainda estiver fraca, subir `MAX_RATE` para ~37–40.

## 29. Default procedural, hairpin 13–14 m, +3 s e poeira ousada v7 (Oct 28, 2026)

O playtest aprovou o hairpin extremo de 14–15 m, mas pediu mais um pouco de aperto; as medalhas ficaram difíceis e o usuário pediu +3 s em cada uma; a poeira ainda estava fraca. Ele também pediu para o jogo abrir direto em uma pista procedural aleatória, deixando a fixa no botão.

### Default procedural

- Abrir `/` (ou `?debug=1`, `?s=...` sem `track`) sorteia uma **procedural 1–100** a cada carregamento; a URL não é reescrita.
- `?track=fixed` carrega a pista fixa; **FIXA** agora navega para `?track=fixed` preservando `debug`/`touch`.
- `?track=proc&seed=N` continua determinística (1–100); `?track=proc` sem seed e seed inválida sorteiam.
- 3 aberturas seguidas: seeds 50, 70 e 85. `FIXA` do default carregou `track01-v3`; `NOVA` do fixo carregou `proc-13`; `proc-7` determinística; console limpo.

### Hairpin extremo

- Raio **13–14 m** (medido 12,7–13,8 m após a spline), sweep 170–185°, 1 por pista, normais 0–1, largura 5,2–6,2 m, aproximação 45–60 m e saída 35–60 m.
- A folga das pernas do próprio extremo caiu de 26 para **24 m**; o resto continua 40 m.
- Os ombros de 12 m formam um apron contínuo no apex; aceito para ganhar o aperto pedido.

### Medalhas +3 s

- Procedurais: `gold = 39 + 10 * clamp((length - 1300)/350, 0, 1)`; nas 100 seeds (1518,3–1623,7 m) fica **45,2–48,2 s**; prata 51,2–54,2; bronze 57,2–60,2.
- Pista fixa: **39/45/51 s**; parciais **8,9/17,9/26,8 s**; parciais procedurais no ritmo do ouro.
- Resultado no jogo: fixa 39/45/51; seed 1 **46,5/52,5/58,5**.
- `freeze-track.ts` reproduz `track01.ts` byte a byte.

### Poeira v7

- Pool **96**; taxa **55/s**; limiar **4°**; saturação **24°**; vida 0,60–1,10 s; tamanho 0,40–0,85 m; crescimento 1,6–2,2×; alpha 0,34–0,65; subida 1,3–2,5 m/s; gravidade 0,20 m/s².
- Sintético a 20 m/s: 10° média **9,03** / máx 13; 30° média **29,76** / máx 38; 0° e 4° zero; dissipação 0,82–1,00 s.
- No jogo: reta 0; 11° ≈ 1–4; 29,9° ≈ **19–26** ativos, rastro contínuo e mais alto; não cobre o carro.

### Testes

- 100/100 seeds válidas; 1 hairpin extremo por seed; raio 12,7–13,8 m.
- `typecheck`, `build`, `validate:track` OK; pista fixa 1096,8 m e medalhas 39/45/51.
- Default random, FIXA, NOVA, `?track=fixed`, `?track=proc&seed=7`, resultados de medalha, dust e touch/desktop no headless; console limpo.

### Pendências

- Testar o hairpin de 13–14 m; se ainda estiver fácil, descer para 12–13 m e reduzir o ombro local.
- Confirmar o ouro +3 s (fixa 39; procedurais 45,2–48,2) e as parciais.
- Avaliar se a poeira v7 está no ponto ou exagerada; ajustar `MAX_RATE`/tamanho.
- Confirmar que abrir `/` em procedural aleatória é o comportamento desejado no uso diário.

## 30. Cenários, bifurcações, menu, velocímetro e hazards v8 (Oct 28, 2026)

Esta rodada implementa o pacote de conteúdo/UX pedido no playtest: novos cenários, poeira por piso, caminhos alternativos, velocímetro, menu de seeds e obstáculos móveis. A pista fixa `track01-v3` permaneceu intocada.

### Cenários e pisos

- `ScenarioId` separado de `SurfaceId`; registro central em `src/game/scenarios.ts` com label, paleta de pista/ombro/borda/terreno, ambiente, poeira, portal, obstáculos e hazards.
- Seis cenários: **floresta/cascalho, deserto/areia, neve, vilarejo/asfalto, estrada de terra e praia/areia de praia**.
- Pistas procedurais usam **4 setores distintos** do pool de 6, sem repetir cenário consecutivo.
- Pisos novos:
  - neve: grip 2,35, aceleração 0,82, arrasto 1,15, bump 0,35, limite 0,95;
  - asfalto: grip 6,1, aceleração 1,08, arrasto 0,90, bump 0,22, limite 1,0;
  - terra: grip 3,55, aceleração 0,92, arrasto 1,15, bump 1,0, limite 0,96;
  - praia: grip 2,55, aceleração 0,82, arrasto 1,30, bump 0,65, limite 0,90.
- Off-roads por cenário com caps de 50–68% e freios extras de 9–12 m/s².
- Scenery ganhou casas/celeiros, cercas, postes, fardos, palmeiras, guarda-sóis, snow pines e montes de neve, todos instanciados; Obstacles ganhou variantes `snowpine` e `palm`. Gates usam o label/cores do registro.
- A pista fixa continua com floresta/deserto e os mesmos visuais.

### Poeira por piso

- `DUST_PROFILES` por `SurfaceId`, com cor primária/secundária, taxa, tamanho, alpha, vida, subida e gravidade.
- `DriftDust` passou a pool 112, escolhe cor primária/secundária por partícula e respeita o perfil do piso; o deserto foi escurecido para contrastar com a areia.
- Painel **Poeira** com `Ativa`, `Taxa ×`, `Tamanho ×` e `Alpha ×`; valores persistem no tuning.

### Bifurcações

- `TrackFork`/`TrackForkBranch` no `TrackDef`; 1–2 por pista procedural, em retas longas e dentro do mesmo setor.
- O ramo é um mini traçado com spline própria: nasce na **borda** da pista principal, corre paralelo por ~12–30 m, abre **28–48 m** e volta a encostar. Tem `TrackBranch` com sample/project/height/surface, `ForkMesh` com asfalto, ombro só no lado externo e borda externa; a borda interna encosta na pista principal.
- `Track.projectNearest` escolhe principal ou ramo com histerese; o Game mantém `activePathId`, `activePathS` e `activeBranchS`, usa a altura/piso/largura do caminho ativo e mapeia o progresso do ramo para o `s` principal.
- `Scenery` e `Obstacles` evitam o corredor dos ramos. Rampas, hazards e powerups também respeitam a bifurcação.
- A pista fixa não tem forks.

### Obstáculos móveis

- `TrackHazard` no `TrackDef`; 1–3 por pista procedural, com chance de 28% por setor, mínimo garantido de 1 e máximo de 3.
- Tipos por cenário: camelo (deserto), cervo (floresta), rena (neve), carro/caminhão (vilarejo), trator/vaca (terra), buggy (praia).
- `Hazards` cria modelos low poly, espera o carro chegar a ~72 m, faz a travessia em velocidade rápida (4,8–10,5 m/s) e resolve colisão com push-out/ricochete. O começo da run (130 m), rampas, hairpin extremo e bifurcações ficam preservados.
- `?hazards=0` desliga; o painel Debug tem **Hazards ativos** e **→ Próximo hazard**; a telemetria mostra total/ativos/ON-OFF e o caminho ativo.
- A pista fixa não tem hazards.

### Menu e velocímetro

- `TrackMenu` (`src/ui/TrackMenu.ts`) com grade 1–100, melhor tempo por seed via `localStorage['rally.best.proc-N.v1']`, campo de seed, **SORTEAR**, **PISTA FIXA** e **FECHAR**.
- Botão **☰ PISTAS** no HUD; **🎲 NOVA** continua como atalho. O menu abre durante a corrida e pausa simulação/cronômetro; `ESCOLHER PISTA` aparece no resultado.
- Navegação preserva `debug`/`touch`, remove `s` e usa `?track=proc&seed=N` ou `?track=fixed`.
- Velocímetro digital em km/h com barra, no canto inferior, espelhado conforme o lado do stack MÃO.

### Testes

- `npm run typecheck`, `npm run build` e `npm run validate:track` passam; pista fixa continua 1096,8 m e 39/45/51.
- 100/100 seeds válidas; comprimento 1518,3–1623,7 m; raio 12,6–13,8 m; largura 4,6–15,0 m; **1–2 bifurcações** e **1–3 hazards** por seed.
- Distribuição de hazards em 100 seeds: 1 → 78, 2 → 15, 3 → 7; todos os 8 tipos aparecem.
- Headless mobile 390×844: GO/auto-throttle, 5 botões, velocímetro, menu abre/fecha, pausa congela o timer e retoma, seed navega, pista fixa navega, resultado abre menu.
- Bifurcação: `__rallyPath.pathId=0` confirmou o carro no ramo; hazard: colisão de 13,1 m/s confirmada com queda de velocidade; `?hazards=0` confirmou `enabled=false`.
- Console limpo nos testes.

### Correções v8b (Oct 29, 2026)

- **Hazards mais rápidos:** camel 5,2 / deer 7,0 / reindeer 6,5 / car 10,5 / truck 9,5 / tractor 6,2 / cow 4,8 / buggy 9,5 m/s. O gatilho continua em 72 m; a travessia ficou 1,5–1,8× mais rápida.
- **Fork como mini traçado:** janela de 150–260 m; o ramo nasce na borda da pista, corre paralelo por ~12–30 m (platô), abre 28–48 m e volta a encostar. O objetivo é o jogador entrar/sair sem cair no vão interno.
- **Sem salto na entrada/saída:** o ramo começava no centro e a física trocava de altura no meio da pista. Agora ele começa/termina na borda, o lado interno é plano (sem ruído de off-road) e o lado externo recebe o ombro; `TrackBranch` também interpola a largura. Testes headless de entrada e saída (`?debug=1&branch=0&bt=0.9`) ficaram com `maxAir=0`.
- **Malha do fork:** `ForkMesh` desenha asfalto + ombro só no lado externo, borda externa e material `DoubleSide`; a borda interna encosta na pista principal.
- **Debug de fork:** `?debug=1&branch=0&bt=0.9` teleporta para 90% do ramo, útil para QA do merge.

### Gerador v2 de bifurcações (Oct 29, 2026)

- Novo módulo `src/track/procedural/ProceduralTrackV2.ts`; a v1 (`ProceduralTrack.ts`) fica intacta como rollback via `?gen=v1`.
- A v1 gera a espinha principal; a v2 substitui `def.forks` com 1–2 ramos planejados em coordenadas de mundo.
- Janela de 170–340 m; 2–3 apexes com deslocamento longitudinal (`-12..18 m`) e lateral (`35–70 / 30–60 / 20–40 m`); lead-in/lead-out de 18–30 m; elevação própria de 0,4–4 m.
- O ramo começa/termina na borda e tem lead-in/lead-out alinhados à tangente; comprimento 3D ~190–345 m; largura 5,5–8 m.
- Validação: mesmo setor, sem encostar na pista principal fora da janela, sem autointerseção grosseira, raio mínimo ≥8 m e inclinação ≤0,40. Se falhar, a v1 é restaurada.
- `Track.projectNearest` ganhou guarda para não continuar no ramo depois de `endS` (a histerese mantinha o carro no ramo e o jogava para o ombro no merge).
- `TrackBranch` mantém o lado interno plano e o ombro só no lado externo; `ForkMesh` foi ajustado para o mesmo desenho.
- `Scenery` agora espalha props e postes de borda ao longo do ramo (lado externo), para o mini traçado não parecer uma faixa vazia.
- Testes: 100/100 seeds válidas; 99 seeds com forks v2 (67 com 1, 32 com 2) e 1 fallback v1 (seed 48); ramos 189,8–344,6 m; `typecheck` e 100 seeds OK. Entrada/saída com `maxAir=0` após a guarda de `projectNearest`.
- Debug: `?gen=v1` (rollback), `?branch=0&bt=0.9` (teleporte para o ramo), scripts `proc-validate --gen v2` e `proc-diversity --gen v2`.

### Gerador v3 por blocos (Oct 29, 2026)

- Novo módulo `src/track/procedural/ProceduralTrackV3.ts`; v1 e v2 ficam intactas para rollback (`?gen=v2`, `?gen=v1`).
- A pista v3 é uma sequência de 5–6 blocos de cenário. Blocos lineares têm uma rota completa; blocos com split têm entrada/saída comuns e duas rotas completas (A e B).
- 1–2 splits por pista; cada rota tem ~612–820 m, curvas, largura/elevação próprias, ombros e bordas dos dois lados, cenário dos dois lados, postes, hazards, obstáculos, powerups e kickers locais.
- Cada pista tem **1–2 hairpins de switchback** (extremo 13–14 m ou normal 20–23 m), chokes de 4,6–5,4 m, trechos largos de 12–15 m, platôs de elevação e **1–5 rampas**; as rotas também recebem alargamentos/estreitamentos e relevo próprio.
- O miolo do Y é paisagem (terreno com relevo + props), não um canteiro plano. `Scenery` passou a considerar todos os caminhos no backdrop e a preencher o miolo; `TrackMesh` encolhe os ombros no split e `ForkMesh` desenha a rota completa com ombros dos dois lados.
- Conteúdo path-aware: `TrackHazard`, `TrackObstacle` e `TrackPowerup` têm `pathId`; hazards só ativam no caminho atual. `TrackBranch` aceita zonas/kickers locais. `Track.sampleAtPath/heightAtPath/...` usam `0 = principal, 1..N = rota`.
- Parciais: 3, somente em fronteiras comuns de blocos. As bandeiras físicas mostram apenas **SPLIT** (sem nome de bioma).
- Validação: 100/100 seeds v3; 50 seeds com 1 split e 50 com 2; comprimento 2.692–3.798 m; rotas 612–820 m; largura 4,6–15,0 m; raio mínimo 9,9 m; 1–2 hairpins em 99/100; 1–5 kickers; 2–4 hazards; 12–16 powerups; sem autointerseção no eixo; `typecheck`, build e pista fixa OK. Entrada/saída de rota com `maxAir=0` no teste headless.
- Debug: `?gen=v3` (padrão), `?gen=v2`, `?gen=v1`, `?branch=0&bt=0.9`; `scripts/proc-validate-v3.ts` gera relatório e SVG top-down.

### Pendências

- Playtest no celular real: sentir grip de neve/asfalto/terra/praia e calibrar valores.
- Avaliar a v3 das bifurcações no playtest: legibilidade, se cada rota parece uma pista normal, se o miolo parece paisagem e se a escolha é divertida. Comparar com `?gen=v2` e `?gen=v1`.
- Calibrar frequência/timing dos hazards e a justiça da colisão.
- Validar poeira em neve/praia em movimento e performance de cenários no celular.
- Recalibrar medalhas/parciais com os novos pisos, se o playtest pedir.
