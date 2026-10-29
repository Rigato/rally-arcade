# Gerador v3 — pistas por blocos de cenário

Oct 29, 2026 · Rally Arcade

## Decisão

O v2 ainda era uma pista principal com um desvio pendurado. O v3 muda a unidade de geração: a pista passa a ser uma **sequência de blocos de cenário**, e alguns blocos já nascem com um split.

```
[bloco linear] → [bloco com split] → [bloco linear] → [bloco com split] → [bloco linear]
                         │
                  entrada comum
                  ┌── rota A completa ──┐
                  │                     │
                  └── rota B completa ──┘
                         saída comum
```

- Um bloco = um bioma (`forest`, `desert`, `snow`, `village`, `dirt`, `beach`).
- Bloco linear: uma rota completa.
- Bloco com split: entrada comum + **duas rotas completas** + saída comum.
- O bloco fica mais longo (720–900 m de eixo) para caber as duas rotas e a paisagem central.
- 5–6 blocos por pista; 1–2 blocos com split; 2,5–3,8 km no total.

## O que é uma “rota completa”

Cada rota tem:

- spline própria, gerada pela gramática de segmentos da v1;
- perfil de largura próprio (5,5–10 m, com chokes/trechos largos);
- elevação própria (morro/ondulação de até 6–9 m);
- ombros e bordas dos dois lados;
- postes de borda dos dois lados;
- cenário dos dois lados;
- hazards, obstáculos, powerups e kickers próprios;
- validação de raio mínimo, inclinação, autointerseção e comprimento.

O miolo entre as rotas é uma paisagem (morro, mata, vale), não um canteiro plano. As rotas não são arcos espelhados: cada uma tem perfil e curvatura próprios.

## Split simétrico ou assimétrico

Cada bloco com split escolhe um estilo:

- **Simétrico:** as duas rotas têm comprimento e dificuldade parecidos. A escolha é de linha.
- **Assimétrico:** uma rota é mais curta e técnica; a outra é mais longa e rápida. A escolha envolve distância, velocidade e dificuldade.

A escolha é por bloco, então uma pista pode misturar os dois estilos.

## Progresso e parciais

- O eixo lógico continua sendo a rota A (trunk) apenas para cronômetro, parciais e medalhas.
- A rota B mapeia seu progresso normalizado para o mesmo intervalo `startS..endS`.
- As parciais ficam somente nas fronteiras comuns dos blocos, nunca dentro de um split.
- As bandeiras físicas de parcial mostram apenas **SPLIT**, sem o nome do bioma.

## Runtime

- `TrackBranch` virou uma rota completa quando `kind === 'route'`: zonas locais, kickers e altura dos dois lados.
- `ForkMesh` desenha estrada + ombros + bordas dos dois lados; o ombro interno desaparece perto da entrada/saída.
- `Scenery` decora as duas rotas dos dois lados e o miolo do Y; o backdrop de terreno considera todas as rotas.
- `TrackHazard`, `TrackObstacle` e `TrackPowerup` têm `pathId`; hazards só ativam no caminho atual.
- Parciais e ambiente continuam no `s` lógico; o bloco tem um bioma só.

## Rollback

- `ProceduralTrackV3.ts` é novo; `ProceduralTrackV2.ts` e `ProceduralTrack.ts` ficam intactos.
- Padrão: v3.
- `?gen=v2` e `?gen=v1` voltam às versões anteriores.
- Pista fixa continua congelada.

## Validação

- 100 seeds sem throw.
- 5–6 blocos, 1–2 splits.
- Rotas de 600–790 m, largura mínima ≥ 5,5 m, raio mínimo ≥ 11 m, inclinação base ≤ 0,40 (kickers até ~1,0).
- Sem autointerseção grosseira; sem encostar na pista principal fora da janela do split.
- Entrada/saída alinhadas à tangente; sem salto (`maxAir = 0`).
- Parciais apenas em fronteiras comuns.
- `scripts/proc-validate-v3.ts` gera relatório e SVG top-down.
