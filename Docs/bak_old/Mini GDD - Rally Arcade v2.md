# Mini GDD - Rally Arcade v2

Oct 27, 2026 · @George

## Ficha e High Concept

Rally Arcade é um jogo de corrida arcade para celular, jogável com uma mão, em que o jogador leva um carro derrapante de A a B por terrenos diferentes, atrás do menor tempo e da melhor medalha.

- **Stack:** Three.js + Vite (JavaScript ou TypeScript), sem engine; física do carro própria.
- **Escopo / Complexidade:** pequeno (1 mês) para chegar ao MVP.
- **Gênero:** arcade, corrida.
- **Plataforma alvo:** web, celular em orientação portrait jogado com o polegar; PC como plataforma secundária, com mouse.
- **Público / Vibe:** casual, relaxante.
- **Status:** ideia em definição, com o MVP mapeado.

**High Concept:** jogo relaxante de corrida de rally em que o jogador percorre uma pista aberta, do ponto A ao B, por diversos tipos de terreno com um carro deslizante, desviando de obstáculos e pegando powerups. O objetivo é fazer o menor tempo possível e conquistar medalhas de ouro, prata ou bronze.

## 1. Pilares de Design

O jogo se sustenta em três sensações: dirigir gostoso, viver o rally e rejogar sempre uma pista nova.

1. **Gostoso de dirigir e fácil de jogar.** Dá para jogar com uma mão só, com o polegar, com o celular de pé. O carro é levemente solto do controle e derrapa. Os terrenos mudam o comportamento do carro, principalmente o grip.
2. **Elementos importantes de rally.** Saltos, diferentes tipos de curva (incluindo hairpin feito com freio de mão) e diferentes cenários: neve, floresta, vilarejos, deserto, estrada de terra, cascalho e asfalto.
3. **Pista procedural para alta rejogabilidade.** Fica fora do primeiro MVP, que usa uma pista fixa para validar o controle primeiro.

## 2. O Diferencial (The Hook)

O jogo é leve e divertido, e errar não condena a corrida: dá para sair da pista, trepidar, quase voar e ainda "salvar" o carro, como acontece nos pilotos de rally reais.

- **Recuperar o erro é parte da graça.** O fora da pista é um terreno a atravessar, não uma punição imediata. Só bater num obstáculo sólido é o erro de verdade.
- **Medalhas graduais e reinício quase instantâneo.** Quem estourou o ouro ainda luta pela prata ou pelo bronze, e um botão no topo da tela reinicia a corrida na hora.
- **Dúvida até o fim do trecho.** O jogador não vê a diferença para o tempo-alvo no meio do trecho, só nas paradas parciais. Essa incerteza faz querer acertar para ver como ficou.
- **Desafio crescente.** A dificuldade aumenta a cada X tempos ou X mudanças de cenário.

## 3. Core Gameplay Loop

A corrida dura de 30 a 60 s no MVP e termina em uma medalha, o que leva o jogador a tentar de novo.

**Loop da corrida**

1. Acelerar, esterçar e derrapar pela pista, escolhendo a linha e o quanto desacelerar antes de cada curva.
2. Enfrentar o risco do momento: curva fechada, pista que estreita, obstáculo, piso ruim fora da pista, salto.
3. Receber feedback imediato: powerup pego, carro salvo fora da pista, tempo parcial a cada troca de cenário.
4. Chegar ao fim, ver o tempo contra os tempos-alvo e a medalha, e reiniciar na hora para melhorar.

**Loop de progressão (fora do MVP)**

Correr, ganhar medalha, receber dinheiro, tunar ou comprar carros, e liberar fases e mundos que exigem determinado carro.

## 4. Mecânicas Principais

O controle é pensado para o celular em portrait e para uma mão só; o carro desliza, a câmera acompanha o movimento e o terreno muda principalmente o grip.

### Controles e movimento (touch)

- **Acelerar:** tocar na tela. O carro fica fixo na parte de baixo da tela, visto por trás.
- **Esterçar e derrapar:** o esterço depende do **deslocamento** do dedo em relação ao ponto de toque inicial. Se o dedo vai para a direita, o carro gira e derrapa para a direita.
- **Frear:** soltar o dedo é freio ativo. A frenagem começa na hora e cresce em intensidade com o tempo sem o dedo na tela.
- **Freio de mão:** serve para jogar o carro de lado no início de uma curva em cotovelo (hairpin), como no rally real. Em cada hairpin o jogador escolhe entre desacelerar bastante e curvar sem freio de mão, ou desacelerar menos e usar o freio de mão para ganhar tempo.
- **Ativação do freio de mão (a testar):** por deslocamento acima de um limite do dedo, ou por um botão dedicado. Toque com dois dedos foi descartado, por ser difícil com o polegar.
- **Reiniciar:** botão no topo da tela reinicia a corrida na hora.
- **PC:** a princípio, o mesmo esquema simulado com o mouse.

### Derrapagem

A direção para onde o carro aponta é diferente da direção em que ele se move. O grip puxa o movimento em direção ao que o carro aponta; quanto menos grip, mais o carro escorrega. O Polygon Drift é inspiração para essa mecânica, sem copiar.

### Suspensão e rolagem

No MVP é só visual: a carroceria rola conforme o movimento lateral e amortece o pouso dos saltos, para dar vida e sensação de movimento. A influência no comportamento do carro fica para depois.

### Câmera

Terceira pessoa, por trás do carro, em ângulo alto, quase top-down, para mostrar mais cenário e possíveis caminhos alternativos. A câmera acompanha o carro com uma leve folga e aponta para a **direção do movimento**, não para a direção do carro. O carro quase não se move na tela e, ao derrapar, gira em relação à câmera. O atraso da câmera será definido testando.

### Terrenos

- Cada cenário tem um único tipo de piso, sem mistura dentro do cenário: cascalho na floresta, areia no deserto.
- O terreno muda principalmente o **grip**, isto é, o quanto o carro escorrega ao esterçar.
- Também muda levemente a aceleração, a frenagem, o arrasto e a resposta do esterço (quão rápido o carro passa a se mover para onde aponta).

### Pista e fora da pista

- A pista tem subidas e descidas em inclinações diferentes. Pontos íngremes em distância curta criam saltos.
- A largura varia: estreita e alarga. Cenários mais fáceis têm uma faixa de largura maior.
- **Fora da pista dá para se recuperar.** Há obstáculos espalhados em distâncias diferentes da borda, e o piso acidentado desacelera, trepida e pode tirar o carro do chão. Se não bater em um obstáculo sólido, o jogador pode "salvar" o carro e voltar à pista.
- **Bater** em um obstáculo sólido tira muita velocidade e dá um leve ricochete, sem teletransporte.
- **Limite do mundo:** além de certo ponto o carro volta para a pista, perdendo tempo.

### Saltos

No MVP o carro salta, tem tempo de voo e pousa, com a suspensão amortecendo o pouso. Não há controle no ar. Manobras e mecânicas de salto e aterrissagem ficam para depois.

### Powerups

O powerup é pego e ativa na hora; nada fica guardado. Pegar o mesmo powerup de novo só renova o tempo.

| Powerup | Efeito | Duração |
| --- | --- | --- |
| Turbo | Velocidade temporária | cerca de 2 s (a confirmar) |
| Grip extra | Mais grip para virar melhor | 10 s |

### Vitória e derrota

- **Vitória:** chegar ao fim da pista. A medalha vem do tempo: abaixo do tempo X é ouro, abaixo de Y é prata e abaixo de Z é bronze. Os valores serão ajustados depois do protótipo.
- **Tempos parciais:** marcados a cada troca de cenário. A diferença para o tempo-alvo aparece só nas paradas parciais, não no meio do trecho.
- **Derrota:** não há game over. Errar custa tempo. As medalhas graduais e o reinício instantâneo permitem que quem errou ainda ganhe alguma coisa.
- **Ideia a explorar:** como no rally, o público ajudar a "salvar" um carro que saiu da pista, ao custo de tempo parado.

## 5. Direção de Arte e Áudio

O visual é low poly 3D e nada realista, e o som mistura rally house com detalhes do carro e do piso.

- **Estilo visual:** low poly 3D. Vista em terceira pessoa por trás do carro, em ângulo alto, mais próximo de um top-down.
- **Referência visual:** [Just Another Racing Game](https://play.google.com/store/apps/details?id=com.carona.project_carona).
- **Tom sonoro:** Rally House, um subgênero emergente de música eletrônica que mistura deep house enérgico dos anos 90 com vocal loops de phonk, elementos de UK garage e a estética audiovisual retrô dos jogos clássicos de corrida.
- **Detalhes de som importantes:** som do motor, estouros e pops do escapamento, e sons de derrapagem diferentes para cada tipo de pavimento e cenário.

## 6. Benchmarks e Inspirações

As referências são dois jogos de Android, um para a derrapagem e outro para o visual.

- **Polygon Drift (Android):** inspiração para a derrapagem dos carros, uma mecânica parecida com a que se quer. Serve de inspiração, não de cópia.
- **Just Another Racing Game (Android):** look and feel visual.
- **O que não fazer:** visual realista.

## 7. Escopo Mínimo Viável (MVP do Protótipo)

O MVP existe para testar se dirigir é gostoso, antes de investir em arte e fases completas.

- [ ] Mecânica principal funcional: acelerar, esterçar, derrapar, frear e freio de mão, em touch portrait com uma mão e com mouse no PC.
- [ ] Painel de ajuste dos parâmetros do carro (grip, aceleração, arrasto, resposta do esterço, curva do freio) para acertar a sensação testando.
- [ ] Suspensão e rolagem só visuais da carroceria, incluindo o pouso dos saltos.
- [ ] Dois powerups: turbo temporário e grip extra.
- [ ] Dois cenários com pisos diferentes: floresta com cascalho e deserto com areia.
- [ ] Uma pista fixa de 30 a 60 s com subidas, descidas, largura variável e ao menos um salto, cobrindo o ciclo completo: início, troca de cenário, fim.
- [ ] Fora da pista recuperável, com obstáculos espalhados, piso acidentado, ricochete ao bater e limite do mundo.
- [ ] Cronômetro, distância percorrida e tempo parcial a cada troca de cenário.
- [ ] Medalhas de ouro, prata e bronze por tempo-alvo, e botão de reinício no topo da tela.

**Ordem dos marcos**

1. Carro em plano liso, com toque, freio, freio de mão e painel de ajuste.
2. Superfícies de cascalho e areia trocáveis.
3. Pista por spline com elevação, largura variável e salto, com suspensão visual.
4. Fora da pista, obstáculos e piso acidentado.
5. Powerups, cronômetro, parciais, medalhas e reinício.

## 8. Fora do MVP

Depois de validar o feeling, a ideia é crescer em progressão, variedade e profundidade de mecânicas.

- **Progressão fora da corrida:** cada medalha rende dinheiro para tunar o carro e comprar outros, com vários modelos "reais" de rally para explorar. Certas fases ou mundos só abrem com determinado carro.
- **Pista procedural** para alta rejogabilidade, com mais cenários: neve, vilarejos, asfalto, estrada de terra.
- **Dificuldade crescente:** mais mudanças de cenário e composições mais difíceis nas dificuldades maiores, com desafios que aumentam a cada X tempos.
- **Suspensão** influenciando o comportamento lateral do carro, além do efeito visual.
- **Saltos:** manobras e mecânicas de controle no ar e na aterrissagem.
- **Público** que ajuda a recolocar na pista o carro que saiu.

## 9. Pontos em aberto para testar

Estes itens dependem de jogar o protótipo e ajustar.

- Acionamento do freio de mão: deslocamento acima de um limite ou botão dedicado.
- Atraso e folga da câmera ao seguir a direção do movimento.
- Curva de crescimento do freio ao soltar o dedo.
- Duração do turbo: ficou "2-2 segundos", a confirmar o valor.
- Tempos-alvo de ouro, prata e bronze da pista fixa.
- Caminhos alternativos na pista (linhas de risco e recompensa): entram no MVP ou depois?
- Limite do mundo: onde fica e quanto tempo se perde ao voltar para a pista.
