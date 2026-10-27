# Rally Arcade

Engine Pretendida: Sem Engine
Escopo / Complexidade: 🌱 Pequeno (1 mês)
Gênero: Arcade
Plataforma Alvo: Web
Público / Vibe: Casual / Relaxante
Status: 💡 Ideia Bruta

## 💡 High Concept (Elevator Pitch)

Jogo relaxante de corrida arcade onde o jogador percorre uma pista aberta (ponto A ao B) passando por diversos tipos de terrenos, com um carro deslizante, desviando de obstaculos e pegando powerups com o objetivo de fazer o menor tempo possível (?)

## 1. Pilares de Design (Sensações-Chave)

- **Pilar 1:** Gostoso de dirigir e fácil de jogar. Carro se sente levemente solto do controle, derrapando. Diferentes tipos de terrenos mudam levemente o comportamento do carro.
- **Pilar 2:** Trazer elementos importantes de rally como saltos, diferentes tipos de curvas, diferentes cenários (neve, floresta, vilarejos, deserto, estrada de terra, cascalho, asfalto)
- **Pilar 3:** Pista gerada proceduralmente para garantir alta rejogabilidade

## 2. O Diferencial (The Hook)

- **O que torna este jogo único?** Leve e divertido. Desafios aumentam a cada X tempos ou X mudanças de cenários.

## 3. Core Gameplay Loop

```
[Ação Primária / Loop Básico]
       ↓
[Desafio / Risco do Momento]
       ↓
[Recompensa / Feedback Imediato]
       ↓
[Progressão / Upgrade / Retorno ao Loop]
```

*Exemplo prático: Entrar na sala → Desviar de projéteis e posicionar armadilhas → Coletar sucatas dos inimigos derrotados → Comprar peças melhores na bancada.*

## 4. Mecânicas Principais

- **Controles & Movimento:** Controle touch: Toque na tela faz o carro acelerar. Deslizar o dedo para os lados faz o carro ir virando e derrapando. Soltar o dedo freia o carro, porem o freio tem uma curva a ser aplicado pelo tempo sem o dedo na tela. Mover o dedo mais proximo das laterais da tela ativa o modo freio de mão, para fazer curvas cotovelo/hairpin, inspirado na curva real de rally quando o carro entra meio de lado na curva derrapando. Controle PC: A principio tentar simular mesmo controle com o mouse. Seria interessante testar desenvolver um sistema simples de suspensão para os carros, que exerça alguma influencia sobre o comportamento dinamico lateral do carro em termos de movimentação e derrapagem, mas também que movimente levemente a carroceria do carro larealmente (uma rolagem), para dar mais vida esensação de movimento ao jogador. Nada muito elaborado e complexo, e sim algo que adicione ao look and feel divertido do jogo. Pista deve ter sobes e desces em diferentes inclinações. Pontos ingremes em distancia curta criam saltos.
- **Ações Principais:** Acelerar, virar, derrapar, frear.
- **Condição de Vitória:** *Cada partida ter um numero de mudanças de cenário? Dificuldades maiores propoe mais mudanças de cenário e uma composição de cenários mais difíceis. Vence ao chegar no fim. Talvez chegar ao fim abaixo de um tempo X?*
- **Condição de Derrota:** Não sei ao certo. Teriamos que testar algumas ideias, como bater/sair da pista mas talvez ter 3 vidas/chances? É legal quando no rally o publico que assiste ajuda a “salvar” um carro que sai da pista. Mas qual penalidade isso implicaria? Perder tempo com as “paradas” e não conseguir terminar o trecho abaixo do tempo alvo?

## 5. Direção de Arte & Áudio

- **Estilo Visual:** Low Poly 3D. Vista do jogo é terceira pessoa por trás do carro em um ângulo mais alto. Mais próximo de um top-down.
- **Referências Visuais:** Just Another Racing Game ([https://play.google.com/store/apps/details?id=com.carona.project_carona](https://play.google.com/store/apps/details?id=com.carona.project_carona))
- **Tom Sonoro:** Rally House is an emerging electronic music subgenre that blends energized 90s deep house with phonk vocal loops, UK garage elements, and the retro audio-visual aesthetics of classic racing video games. Também detalhe importante to som do motor, escapamento pops & bangs e diferentes sons de derrapagem a depender do tipo de pavimento/cenário

## 6. Benchmarks & Inspirações

- **Jogo A:** Polygon Drift para android - inspiração de derrapagem dos carros.
- **Jogo B:** Just another racing game para android - look and feel visual
- **O que NÃO fazer:** Visual realista.

## 7. Escopo Mínimo Viável (MVP do Protótipo)

Liste estritamente o que é obrigatório para testar se o jogo é divertido, antes de investir meses criando arte e fases completas:

- [ ]  Mecânica principal funcional - Acelerar, virar, derrapar, modo freio de mão, frear
- [ ]  Dois Powerups - Turbo temporário e mais grip para virar melhor
- [ ]  Dois tipos de cenário para diferenciar a dinâmica da interação do carro com pavimentos diferentes (Floresta com estrada de cascalho e Deserto com Areia).
- [ ]  Um ciclo completo curto de teste (início → Troca de cenário → Fim - se sai pra fora da pista, bate e perde?).
- [ ]  Marcar tempo e distância percorrida. Tempo parcial também, marcado a cada troca de cenário.