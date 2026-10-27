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

Ainda **não está integrado ao jogo**: falta generalizar as visuais/HUD para multi-zona (em andamento na pista fixa v2) e adicionar um carregador de debug tipo `?track=proc&seed=1`. O objetivo é um protótipo, não o sistema final.

## 23. Pista fixa v2 — em andamento

Em uma worktree separada, um subagente está refazendo a pista fixa com 4 setores alternados, ~1 km, curvas de 30–70 m, ombros de 12 m, obstáculos a 5–10 m da borda, rampas de 1,0–1,5 m com 40 m de pouso, 3 parciais e ambientes multi-zona. A integração será feita depois do retorno desse trabalho, junto com o gerador procedural.
