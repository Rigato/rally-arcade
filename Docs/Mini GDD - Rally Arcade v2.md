# Mini GDD - Rally Arcade v2.4

Oct 29, 2026 · @George

> **Revisão 2.4 (Oct 29, 2026).** O gerador procedural ganhou uma **v3 por blocos de cenário**: a pista é uma sequência de 5–6 blocos, e 1–2 deles já nascem com um split entre duas rotas completas (~600–790 m cada), com cenário, largura, elevação, postes, hazards, obstáculos e powerups próprios. A v2 e a v1 continuam intactas em `?gen=v2` e `?gen=v1`. O restante do documento reflete o protótipo v8: seis cenários, poeira por piso, obstáculos móveis, menu de pistas/seeds e velocímetro. O GDD v2.3 está no histórico; o v2 original continua em [`bak_old/Mini GDD - Rally Arcade v2.md`](bak_old/Mini%20GDD%20-%20Rally%20Arcade%20v2.md); a v1 está em [`old_Mini GDD - Rally Arcade v1.md`](old_Mini%20GDD%20-%20Rally%20Arcade%20v1.md).

## Ficha e High Concept

Rally Arcade é um jogo de corrida arcade para celular, jogável com uma mão, em que o jogador leva um carro derrapante de A a B por terrenos diferentes, atrás do menor tempo e da melhor medalha.

- **Stack:** Three.js + Vite (TypeScript estrito), sem engine; física do carro própria.
- **Escopo / Complexidade:** pequeno (1 mês) para chegar ao MVP.
- **Gênero:** arcade, corrida.
- **Plataforma alvo:** web, celular em orientação portrait jogado com o polegar; PC como plataforma secundária, com teclado (mouse ainda não implementado para direção).
- **Público / Vibe:** casual, relaxante.
- **Estado:** protótipo jogável em playtest; MVP do GDD quase completo, com duas lacunas de controle: freio de mão no touch e mouse no PC.

**High Concept:** jogo relaxante de corrida de rally em que o jogador percorre uma pista aberta, do ponto A ao B, por diversos tipos de terreno com um carro deslizante, desviando de obstáculos e pegando powerups. O objetivo é fazer o menor tempo possível e conquistar medalhas de ouro, prata ou bronze.

## 1. Pilares de Design

O jogo se sustenta em três sensações: dirigir gostoso, viver o rally e rejogar sempre uma pista nova.

1. **Gostoso de dirigir e fácil de jogar.** Dá para jogar com uma mão só, com o polegar, com o celular de pé. O carro é solto de traseira e derrapa. Os terrenos mudam o comportamento do carro, principalmente o grip. O esquema atual usa **GO + auto-aceleração + 5 botões** (◀/▶, ◀F/▶F e FREIO), com menu para escolher o lado da mão.
2. **Elementos importantes de rally.** Saltos, curvas de vários tipos (incluindo hairpin normal e extremo) e cenários diferentes. Implementados: **floresta/cascalho, deserto/areia, neve, vilarejo/asfalto, estrada de terra e praia/areia de praia**. Cada cenário tem piso, paleta, poeira e obstáculos próprios.
3. **Pista procedural para alta rejogabilidade.** Já implementada como protótipo e agora é o **modo padrão**: abrir `/` sorteia uma seed 1–100. A pista fixa continua como test track no botão **FIXA**.

## 2. O Diferencial (The Hook)

O jogo é leve e divertido, e errar não condena a corrida: dá para sair da pista, trepidar, quase voar e ainda "salvar" o carro, como acontece nos pilotos de rally reais.

- **Recuperar o erro é parte da graça.** O fora da pista é um terreno a atravessar, não uma punição imediata. Só bater num obstáculo sólido é o erro de verdade.
- **Medalhas graduais e reinício quase instantâneo.** Quem estourou o ouro ainda luta pela prata ou pelo bronze, e um botão no topo da tela reinicia a corrida na hora.
- **Dúvida até o fim do trecho.** O jogador não vê a diferença para o tempo-alvo no meio do trecho, só nas paradas parciais.
- **Desafio crescente.** A dificuldade aumenta a cada X tempos ou X mudanças de cenário — **ainda não implementado**; é um dos próximos pilares.

## 3. Core Gameplay Loop

A corrida dura de 30 a 60 s e termina em uma medalha, o que leva o jogador a tentar de novo. Nas pistas procedurais atuais (~1,5 km), as corridas ficam mais perto de 45–60 s; a pista fixa de ~1,1 km tem ouro em 39 s.

**Loop da corrida**

1. Acelerar, esterçar e derrapar pela pista, escolhendo a linha e o quanto desacelerar antes de cada curva.
2. Enfrentar o risco do momento: curva fechada, pista que estreita, obstáculo, piso ruim fora da pista, salto.
3. Receber feedback imediato: powerup pego, carro salvo fora da pista, tempo parcial a cada troca de cenário.
4. Chegar ao fim, ver o tempo contra os tempos-alvo e a medalha, e reiniciar na hora para melhorar.

**Loop de progressão (fora do MVP)**

Correr, ganhar medalha, receber dinheiro, tunar ou comprar carros, e liberar fases e mundos que exigem determinado carro. **Ainda não implementado.**

## 4. Mecânicas Principais

### Controles e movimento (touch)

O controle é pensado para o celular em portrait e para uma mão só. O esquema de **drag + soltar para frear** do GDD v2 foi substituído após playtest.

- **Início:** o carro fica parado em READY. **GO!** central, toque no canvas ou W/↑/Enter inicia o cronômetro.
- **Aceleração:** automática depois do GO. O freio corta o motor.
- **Esterço:** stack de 5 botões no canto inferior, por padrão à direita:
  - linha 1: **◀** e **▶** puros;
  - linha 2: **◀F** e **▶F** (esterço + freio no mesmo dedo);
  - linha 3: **FREIO** largo.
  Segurar; multi-touch permite dois dedos. Não há drag steering.
- **Lado da mão:** o menu **MÃO** alterna DIREITA/ESQUERDA e persiste em `localStorage['rally.controls.side.v1']`.
- **Freio de mão:** disponível **somente no teclado (Espaço)**. Ainda não há botão no touch; é uma lacuna conhecida e um ponto para a próxima fase.
- **Reiniciar:** botão no topo ou R.
- **PC:** teclado A/← esquerda, D/→ direita, S/↓ freio, Espaço handbrake, R reset, H telemetria. O mouse ainda só clica no GO/canvas; o esquema de mouse do GDD v2 não foi implementado.
- **Desktop:** os controles touch ficam ocultos; o GO mostra “CLIQUE OU ENTER”.
- **Menu de pistas:** **☰ PISTAS** abre uma grade de seeds 1–100 com melhor tempo, campo para digitar seed, **SORTEAR** e **PISTA FIXA**. Abrir durante a corrida pausa simulação e cronômetro; no resultado há **ESCOLHER PISTA**.
- **Velocímetro:** km/h e barra de velocidade no canto inferior, espelhado conforme o lado do stack MÃO.

### Derrapagem

A direção para onde o carro aponta é diferente da direção em que ele se move. O grip puxa o movimento em direção ao que o carro aponta; quanto menos grip, mais o carro escorrega. O modelo atual tem slip visível (~30° com esterço cheio em velocidade), grip que cai com o slip e recuperação por contra-esterço/freio. O Polygon Drift é inspiração, sem cópia.

### Suspensão e rolagem

No MVP é só visual: a carroceria rola conforme o movimento lateral e amortece o pouso dos saltos. A influência no comportamento físico do carro continua **fora do MVP**.

### Câmera

Terceira pessoa, por trás do carro, em ângulo alto, quase top-down, para mostrar cenário e possíveis caminhos alternativos. A câmera acompanha o carro com folga e aponta para a **direção do movimento**, não para a direção do carro. O carro quase não se move na tela e, ao derrapar, gira em relação à câmera. O atraso foi calibrado no protótipo.

### Terrenos

- Cada cenário tem um tipo principal de piso: **floresta/cascalho, deserto/areia, neve, vilarejo/asfalto, estrada de terra e praia/areia de praia**.
- Fora da pista há pisos próprios por cenário, mais soltos, com mais arrasto e trepidação.
- O terreno muda **grip**, aceleração, frenagem, arrasto, resposta do esterço, bump e limite de velocidade.
- A neve solta mais a traseira, o asfalto do vilarejo agarra mais, a terra fica entre cascalho e areia e a praia puxa para fora.
- **Poeira por cenário:** cor, densidade, tamanho, vida, subida e gravidade variam por piso; o deserto usa tom mais escuro para contraste e a neve um spray branco-azulado.

### Pista e fora da pista

- **Pista fixa:** `track01-v3`, A→B, **1096,8 m**, 4 setores, raio mínimo 30,2 m, 2 rampas, 4 powerups, 50 obstáculos. Acessível por **FIXA** / `?track=fixed`.
- **Pistas procedurais:** A→B, **1518–1625 m**, 4 setores de ~354–438 m sorteados do pool de seis cenários, 7 tipos de curva (incluindo **hairpin extremo 13–14 m** e **kink**), largura 4,6–15,0 m, chokes de 4,6–5,4 m, 6–8 powerups, 50–75 obstáculos, 1–2 bifurcações, 1–3 obstáculos móveis e 2–3 platôs planos. Seed 1–100.
- **Default:** abrir `/` sorteia uma procedural; **NOVA** gera outra; o menu **PISTAS** escolhe seed ou pista fixa.
- A pista tem subidas e descidas; pontos íngremes criam saltos.
- **Bifurcações (v3):** 1–2 por pista. Cada split é um bloco de cenário mais longo com entrada/saída comuns e **duas rotas completas** de ~600–790 m. Cada rota tem spline, largura, elevação, ombros/bordas dos dois lados, cenário dos dois lados, postes, hazards, obstáculos e powerups próprios. O miolo é paisagem (morro, mata ou vale); a escolha pode ser simétrica (linha) ou assimétrica (distância/velocidade/dificuldade). As parciais ficam só nas fronteiras comuns dos blocos. A pista fixa continua sem bifurcação. Rollback em `?gen=v2`/`?gen=v1`.
- **Obstáculos móveis:** 1–3 por pista procedural, com chance por setor. Cada evento é um animal/veículo do cenário que atravessa a pista quando o carro se aproxima e colide. A travessia é rápida (4,8–10,5 m/s) para exigir uma reação curta. O começo da run fica preservado.
- **Fora da pista dá para se recuperar.** O piso acidentado desacelera, trepida e pode tirar o carro do chão; obstáculos sólidos dão ricochete. Se não bater, o jogador pode voltar à pista.
- **Limite do mundo:** além de ~12 m da borda, o carro é recuperado automaticamente perdendo tempo.
- **Caminhos alternativos/linhas de risco-recompensa:** a bifurcação v1 implementa a escolha de caminho sem recompensa assimétrica; linhas de risco/recompensa continuam em aberto.

### Saltos

No MVP o carro salta, tem tempo de voo e pousa, com a suspensão amortecendo o pouso. **Não há controle no ar.** Manobras e mecânicas de salto/aterrissagem ficam para depois.

### Powerups

O powerup é pego e ativa na hora; nada fica guardado. Pegar o mesmo powerup de novo só renova o tempo.

| Powerup | Efeito | Duração |
| --- | --- | --- |
| Turbo | Velocidade temporária e boost de FOV | ~2 s |
| Grip extra | Mais grip para virar melhor | 10 s |

### Vitória e derrota

- **Vitória:** chegar ao fim da pista. A medalha vem do tempo.
  - **Pista fixa:** ouro **39 s**, prata **45 s**, bronze **51 s**; parciais **8,9 / 17,9 / 26,8 s**.
  - **Procedurais:** ouro **45,2–48,2 s**, prata +6 s, bronze +12 s; parciais no ritmo do ouro.
- **Tempos parciais:** marcados a cada troca de cenário; a diferença para o alvo aparece nas parciais.
- **Derrota:** não há game over. Errar custa tempo. As medalhas graduais e o reinício instantâneo permitem que quem errou ainda ganhe alguma coisa.
- **Ideia a explorar:** público ajudando a "salvar" um carro que saiu da pista, ao custo de tempo parado. **Não implementado.**

## 5. Direção de Arte e Áudio

O visual é low poly 3D e nada realista; o som planejado mistura rally house com detalhes do carro e do piso.

- **Estilo visual:** low poly 3D implementado. Vista em terceira pessoa por trás do carro, em ângulo alto, mais próximo de um top-down.
- **Referência visual:** [Just Another Racing Game](https://play.google.com/store/apps/details?id=com.carona.project_carona).
- **Tom sonoro planejado:** Rally House, com deep house enérgico, vocal loops de phonk, UK garage e estética retrô de jogos de corrida.
- **Detalhes de som planejados:** motor, estouros/pops do escapamento e derrapagem diferente por piso/cenário.
- **Estado do áudio:** **não implementado** no MVP; fica para uma fase de polimento.
- **Poeira:** implementada e proporcional ao slip, com perfis por piso: cor primária/secundária, taxa, tamanho, alpha, vida, subida e gravidade. O deserto foi escurecido para contrastar com a areia; a neve usa spray branco-azulado.

## 6. Benchmarks e Inspirações

As referências são dois jogos de Android, um para a derrapagem e outro para o visual.

- **Polygon Drift (Android):** inspiração para a derrapagem, sem cópia.
- **Just Another Racing Game (Android):** look and feel visual.
- **O que não fazer:** visual realista.

## 7. Escopo Mínimo Viável (MVP do Protótipo)

O MVP existe para testar se dirigir é gostoso, antes de investir em arte e fases completas.

- [x] Mecânica principal funcional: acelerar, esterçar, derrapar e frear em touch portrait com uma mão; GO + auto-aceleração + 5 botões.
- [ ] **Freio de mão no touch** — existe só no teclado.
- [ ] **Mouse no PC para direção** — PC usa teclado; o mouse só inicia.
- [x] Painel de ajuste dos parâmetros do carro e da pista para acertar a sensação testando.
- [x] Suspensão e rolagem só visuais da carroceria, incluindo o pouso dos saltos.
- [x] Dois powerups: turbo temporário e grip extra.
- [x] Dois cenários com pisos diferentes: floresta com cascalho e deserto com areia.
- [x] **Além do MVP:** mais quatro cenários (neve, vilarejo, estrada de terra e praia) com pisos, paletas, poeira e obstáculos próprios.
- [x] **Além do MVP:** 1–2 bifurcações procedurais v3 por pista, com duas rotas completas de cenário/conteúdo próprios.
- [x] **Além do MVP:** 1–3 obstáculos móveis por pista, com tipo por cenário e toggle de debug.
- [x] **Além do MVP:** menu de pistas/seeds e velocímetro.
- [x] Uma pista fixa de 30–60 s com subidas, descidas, largura variável e ao menos um salto.
- [x] Fora da pista recuperável, com obstáculos, piso acidentado, ricochete e limite do mundo.
- [x] Cronômetro, distância percorrida e tempo parcial a cada troca de cenário.
- [x] Medalhas de ouro, prata e bronze e botão de reinício no topo.
- [x] **Além do MVP:** gerador procedural determinístico, pista procedural aleatória por default, 7 tipos de curva, hairpin extremo, poeira dinâmica e menu de lado dos controles.

**Ordem dos marcos**

1. Carro em plano liso, com toque, freio e freio de mão no teclado; painel de ajuste. ✅ (handbrake no touch pendente)
2. Superfícies de cascalho e areia trocáveis. ✅
3. Pista por spline com elevação, largura variável e salto, com suspensão visual. ✅
4. Fora da pista, obstáculos e piso acidentado. ✅
5. Powerups, cronômetro, parciais, medalhas e reinício. ✅
6. Pista procedural, default aleatório, hairpin extremo e polish de poeira. ✅ (protótipo)

## 8. Fora do MVP

Depois de validar o feeling, a ideia é crescer em progressão, variedade e profundidade de mecânicas.

- **Progressão fora da corrida:** cada medalha rende dinheiro para tunar o carro e comprar outros, com vários modelos de rally. Certas fases/mundos só abrem com determinado carro. **Não iniciado.**
- **Mais cenários:** neve, vilarejo, estrada de terra e praia **implementados no protótipo v8**; asfalto/variações adicionais continuam possíveis.
- **Dificuldade crescente:** mais mudanças de cenário e composições mais difíceis, com desafios a cada X tempos. **Não iniciado.**
- **Suspensão** influenciando o comportamento lateral do carro, além do visual. **Não iniciado.**
- **Saltos:** manobras e controle no ar/aterrissagem. **Não iniciado.**
- **Público** ajudando a recolocar o carro na pista. **Não iniciado.**
- **Áudio completo** (Rally House, motor, escapamento, derrapagem por piso). **Não iniciado.**
- **Procedural como produto:** menu de seeds **implementado**; histórico/favoritos, compartilhar seed, daily challenge e editor continuam pendentes.
- **Caminhos alternativos/linhas de risco-recompensa:** bifurcação v1 implementada sem recompensa assimétrica; linhas de risco/recompensa continuam em aberto.
- **Obstáculos móveis:** 1–3 por pista com tipo por cenário **implementados**; variedade de modelos e comportamento por cenário podem crescer.

## 9. Pontos em aberto para testar

- **Freio de mão no touch:** 6º botão, gesto, combo ou manter teclado-only? O hairpin extremo atual exige freio normal.
- **Medalhas:** o +3 s melhorou; continuar testando ouro/prata/bronze e as parciais, agora com pisos variados.
- **Poeira:** perfis por piso implementados; validar contraste em neve/praia em movimento.
- **Hairpin extremo:** 13–14 m foi aprovado; se ainda estiver fácil, testar 12–13 m com ombro local menor.
- **Bifurcações:** a v3 usa blocos com duas rotas completas; testar se a escolha é legível, se o miolo parece paisagem e se cada rota parece uma pista normal. Comparar com `?gen=v2` e `?gen=v1`. Caminhos com recompensas assimétricas ficam para depois.
- **Obstáculos móveis:** testar frequência (1–3), timing de travessia e se a colisão é justa; ajustar por cenário.
- **Cenários:** calibrar grip/aceleração de neve, asfalto, terra e praia no celular.
- **Default procedural:** o menu PISTAS mostra a seed e permite repetir a pista.
- **Limite do mundo:** calibrar os 12 m e o tempo perdido na recuperação.
- **Áudio e progressão:** definir o próximo grande pilar antes de investir.
- **Performance:** validar partículas/cenários/hazards em celular real; FPS de headless não representa.

## 10. Documentos relacionados

- [`../README.md`](../README.md) — quickstart, comandos, controles, deploy.
- [`Implementation Plan - Rally Arcade MVP.md`](Implementation%20Plan%20-%20Rally%20Arcade%20MVP.md) — decisões de implementação e histórico v1–v8.
- [`Handoff - Rally Arcade.md`](Handoff%20-%20Rally%20Arcade.md) — estado atual, gaps do GDD e agenda da próxima sessão de plan.
- [`bak_old/Mini GDD - Rally Arcade v2.md`](bak_old/Mini%20GDD%20-%20Rally%20Arcade%20v2.md) — backup do GDD v2 antes da revisão v2.1.
- [`old_Mini GDD - Rally Arcade v1.md`](old_Mini%20GDD%20-%20Rally%20Arcade%20v1.md) — GDD v1 original.
- [`screenshots/`](screenshots/) — capturas de referência (GO, controles, menu de mão, cenários, pista, choke, hairpin extremo, contact sheet procedural).
