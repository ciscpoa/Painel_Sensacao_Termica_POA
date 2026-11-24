# Protocolo de Calor — Porto Alegre

Painel público com a previsão diária do PoaClima/Catavento e os alertas de calor para os próximos
5 dias, pelos gatilhos do Protocolo de Calor de Porto Alegre (Temporada 2026/2027). A página fica
em `docs/` e é publicada pelo GitHub Pages. Uma automação (GitHub Actions) refaz a coleta a cada
3 horas.

## O que o painel mostra

- **Calor Nível 1 a 5**, com o motivo centralizado em negrito, o horário mais crítico e o que fazer.
  A mesma nomenclatura aparece no alerta principal, nos cartões, na explicação e nos detalhes técnicos.
- **Imagem compartilhável:** selo ampliado e, em um único quadro branco, horário crítico, sensação
  térmica, UV e máxima do dia em quatro linhas com marcadores circulares.
- **Próximos 5 dias:** nível, condição do tempo, máxima e mínima, sensação térmica, chuva e vento.
- **Condições do dia:** tempo, temperaturas, chuva, umidade e vento do PoaClima, centralizados e
  empilhados. A madrugada não aparece nesse card, mas continua no Open-Meteo e nas regras do protocolo.
- **Hora a hora:** sensação térmica (UTCI) e temperatura, com as faixas do protocolo e a diferença
  entre os modelos; chuva por hora.
- **Detalhes técnicos:** valores diários do PoaClima e comparação ECMWF × GFS, UTCI, IBUTG, chuva,
  probabilidade de chuva forte na vizinhança (NMEP), vento e gatilho.

## Fontes e separação dos cálculos

- **PoaClima / Catavento Meteorologia:** condição do tempo e respectivo ícone, temperaturas máxima
  e mínima, chuva diária, umidade máxima/mínima, velocidade e direção do vento. São os dados dos
  cartões públicos e dos totais diários sobre o gráfico de chuva.
- **Open-Meteo (ECMWF/IFS e NOAA/GFS):** Coleta das variáveis necessárias para o cálculo da sensação térmica (UTCI), IBUTG, madrugada, séries horárias,
  índice UV e todos os gatilhos dos alertas. A previsão do PoaClima não entra no cálculo de sensação térmica e dos níveis.

A coleta do PoaClima está em `calor/poaclima.py`. Ela reproduz no GitHub Actions a chamada JSON
pública usada pela aba “Previsão do tempo” do aplicativo, com o cabeçalho `x-timezone`, três
tentativas e validação de esquema, datas e valores. Não exige Selenium nem uma requisição do
navegador de quem abre o painel. Se a fonte falhar ou não cobrir os cinco dias, a geração é
interrompida e a publicação anterior permanece no ar, em vez de misturar fontes sem aviso.

## Página

- Layout fluido (CSS grid e `clamp()`), testado de 320 px (celular) a 2560 px (monitor): 1, 2 ou 3 colunas. Tema claro e escuro.
- A sensação térmica (UTCI), que aciona os gatilhos: quadro próprio com régua das faixas
  do protocolo e horas acima de 28, 34 e 38 °C; destaque nos cartões dos dias e no gráfico hora a hora.
- Gráfico hora a hora com seletor de modelo (Média, ECMWF, GFS) e legenda clicável para mostrar ou
  esconder linhas; fundo com as faixas: < 10 °C (azul), 10–28 °C (verde) e os limites do protocolo.
- Chuva por hora dos dois modelos lado a lado e a estimativa diária do Poaclima.
- Na publicação (GitHub Actions), `gerar_painel.py` carimba a versão nos endereços dos scripts
  (`app.js?v=AAAAMMDDHHMM`), para o navegador não usar arquivos antigos guardados na memória.
- Botão "Compartilhar este alerta" (WhatsApp ou menu de compartilhamento do celular) e imagem de prévia
  (`docs/img/compartilhar.png`) para links enviados em aplicativos.
- Logos em `docs/img/`: barra institucional (DVS/SMS, SUS, Prefeitura de Porto Alegre) e marca do CISC.
- Sem frameworks de CSS: HTML, CSS próprio e D3 (gráficos), sem dependências externas na hora de abrir.

## Versão anterior (cópia de segurança)

A primeira versão do painel (09/11/2026) está guardada de três formas:
- marca de versão `v1` e ramo `painel-v1` no repositório;
- cópia navegável, com dados congelados, em `docs/versao-anterior/`
  (https://ciscpoa.github.io/protocolo_de_calor_Porto_Alegre/versao-anterior/).

Para voltar à versão anterior: `git checkout v1 -- docs/index.html docs/app.js` e enviar (push).

## Como o nível é calculado

Sensação térmica (UTCI) do ensemble multimodelo (média do ECMWF IFS e do NOAA GFS) no centro de Porto
Alegre (−30,08; −51,21):

| Nível | Gatilho diário |
|---|---|
| 5 Emergência | UTCI ≥ 48 °C por mais de 1 h |
| 4 Perigo | UTCI ≥ 38 °C por mais de 2 h |
| 3 Alerta | UTCI ≥ 34 °C por mais de 2 h |
| 2 Atenção | UTCI ≥ 32 °C por 4 h ou ≥ 28 °C por 7 h: no 1º dia se a madrugada (0h–6h) for ≥ 22 °C; com madrugada de 20–22 °C, a partir do 2º dia seguido |
| 1 Normalidade | abaixo disso, ou calor com madrugada < 20 °C |

Regras entre dias: **persistência** (N2 com madrugada amena só a partir do 2º dia), **rampa** (N1 com UTCI
máx. ≥ 30 °C vira N2 se o dia seguinte for N3+), **acúmulo** (N2 > 3 dias → N3; N3 > 2 dias → N4; N4 ≥ 2 dias
→ N5) e **rescaldo** (depois de N3+, um dia que cairia para N1 fica em N2). Essas regras olham também os
3 dias anteriores à previsão. O horário crítico é o do nível final do dia. Os testes em `tests/` cobrem cada regra.

## Rodar localmente

```bash
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pytest -q tests     # testes dos gatilhos
.venv/bin/python gerar_painel.py        # baixa a previsão e grava docs/dados/
```

Depois, abra `docs/index.html` no navegador.

| Arquivo | Conteúdo |
|---|---|
| `calor/indices.py` | Geometria solar, Tmrt (ERA5-HEAT), UTCI e IBUTG |
| `calor/protocolo.py` | Gatilhos diários, rampa, acúmulo, rescaldo, estabilidade do tempo e textos para o público |
| `calor/previsao.py` | Download (Open-Meteo), vizinhança de 55 km e probabilidade de chuva (NMEP) |
| `calor/poaclima.py` | Coleta, rótulos e validação da previsão diária do PoaClima/Catavento |
| `gerar_painel.py` | Junta as duas fontes, preserva os alertas e grava `docs/dados/previsao.js` e `previsao.json` |
| `docs/` | Página do painel (HTML + D3, sem servidor) |
| `.github/workflows/atualizar_painel.yml` | Atualização automática a cada 3 horas |

## Observações sobre o código de origem

- **UTCI:** usa a implementação de referência da biblioteca pythermalcomfort
- **Tmrt no esquema ERA5-HEAT completo** Di Napoli et al., 2020


## Dados

Previsão diária do [PoaClima](https://prefeitura.poa.br/poaclima/) / Catavento Meteorologia e
previsões ECMWF IFS 0,25° e NOAA GFS (determinísticas e ensembles), via
[Open-Meteo](https://open-meteo.com/) (CC BY 4.0). O painel é informativo e não substitui os avisos
oficiais da Defesa Civil e da Saúde.
