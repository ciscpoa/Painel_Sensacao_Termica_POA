// Painel público do Protocolo de Calor de Porto Alegre. Lê window.PREVISAO (dados/previsao.js),
// gerado por gerar_painel.py, e desenha com D3. Todos os números vêm desse arquivo.
"use strict";
(() => {
  const P = window.PREVISAO;
  const $ = (id) => document.getElementById(id);
  if (!P) { $("alerta").textContent = "Não foi possível carregar a previsão. Recarregue a página."; return; }

  // ------------------------------------------------------------------ formatação
  const LOC = d3.formatLocale({ decimal: ",", thousands: ".", grouping: [3], currency: ["R$", ""], minus: "−" });
  const f0 = LOC.format(".0f"), f1 = LOC.format(".1f");
  const grau = (v) => (v == null ? "—" : `${f0(v)} °C`);
  const grauC = (v) => (v == null ? "—" : `${f1(v)} °C`);
  const pct = (v) => (v == null ? "—" : `${f0(v)}%`);
  const SEM = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  // Horários são "hora de Porto Alegre" e ficam como UTC no navegador, para não depender do fuso de quem vê.
  const dataDe = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +(s.slice(11, 13) || 0), +(s.slice(14, 16) || 0)));
  const ddmm = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const ddmmaaaa = (s) => `${ddmm(s)}/${s.slice(0, 4)}`;
  function agoraPOA() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { data: `${p.year}-${p.month}-${p.day}`, quando: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) };
  }
  const AGORA = agoraPOA();
  const rotuloDia = (d) => {
    const amanha = new Date(Date.UTC(+AGORA.data.slice(0, 4), +AGORA.data.slice(5, 7) - 1, +AGORA.data.slice(8, 10) + 1)).toISOString().slice(0, 10);
    return d.data === AGORA.data ? "Hoje" : d.data === amanha ? "Amanhã" : d.dia_semana;
  };

  // Categorias de estresse térmico da UTCI adaptados para Porto Alegre (Bröde et al., 2012).
  // São distintas dos níveis do Protocolo de Calor, cujas regras permanecem inalteradas.
  const FAIXAS = [
    { de: -99, ate: -40, cor: "#08306b", texto: "#fff", nome: "Frio extremo", rotulo: "estresse extremo por frio" },
    { de: -40, ate: -27, cor: "#08519c", texto: "#fff", nome: "Frio muito forte", rotulo: "estresse muito forte por frio" },
    { de: -27, ate: 0, cor: "#0d80bf", texto: "#fff", nome: "Frio forte", rotulo: "estresse forte por frio" },
    { de: 0, ate: 6, cor: "#3182bd", texto: "#111", nome: "Frio moderado", rotulo: "estresse moderado por frio" },
    { de: 6, ate: 11, cor: "#6baed6", texto: "#fff", nome: "Frio leve", rotulo: "estresse leve por frio" },
    { de: 11, ate: 28, cor: "#74c476", texto: "#111", nome: "Sem estresse térmico", rotulo: "sem estresse térmico" },
    { de: 28, ate: 34, cor: "#facc15", texto: "#111", nome: "Estresse moderado por calor", rotulo: "estresse moderado por calor" },
    { de: 34, ate: 38, cor: "#ea580c", texto: "#fff", nome: "Estresse forte por calor", rotulo: "estresse forte por calor" },
    { de: 38, ate: 46, cor: "#dc2626", texto: "#fff", nome: "Estresse muito forte por calor", rotulo: "estresse muito forte por calor" },
    { de: 46, ate: 99, cor: "#6b21a8", texto: "#fff", nome: "Estresse extremo por calor", rotulo: "estresse extremo por calor" },
  ];
  const faixa = (u) => FAIXAS.find((f) => u >= f.de && u < f.ate) || FAIXAS.find((f) => f.nome === "Sem estresse térmico");
  const rotuloFaixa = (f) => (f.de < -50 ? `${f.nome} (<${f.ate} °C)` : f.ate > 90 ? `${f.nome} (≥${f.de} °C)` : `${f.nome} (${f.de}–${f.ate} °C)`);
  function contrasteCor(a, b) {
    const lum = (hex) => {
      const canais = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
    };
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  const textoFaixa = (f) => (contrasteCor(f.cor, "#0b0b0b") >= contrasteCor(f.cor, "#ffffff") ? "#0b0b0b" : "#ffffff");

  // ------------------------------------------------------------------ DOM
  function el(tag, attrs = {}, ...filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const f of filhos) if (f != null && f !== false) e.append(f);
    return e;
  }
  // replaceChildren escreveria "null" para um filho vazio; por isso o filtro
  const trocar = (alvo, ...filhos) => alvo.replaceChildren(...filhos.filter((f) => f != null && f !== false));
  const svgEl = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };

  // Ícones determinados pela condição diária do PoaClima. São SVGs locais:
  // o painel não depende da fonte de emojis do aparelho de quem o abre.
  function icone(tipo, tam = 40) {
    const nuvem = `<path d="M14 30h17a7 7 0 0 0 0-14 9 9 0 0 0-17 2 6 6 0 0 0 0 12z" fill="var(--nuvem2)" stroke="var(--nuvem)" stroke-width="1.2"/>`;
    const escura = nuvem.replace("var(--nuvem2)", "var(--nuvem)");
    const sol = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--sol)"/>` + Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4, r1 = r + 2.5, r2 = r + 5.5;
      return `<line x1="${cx + r1 * Math.cos(a)}" y1="${cy + r1 * Math.sin(a)}" x2="${cx + r2 * Math.cos(a)}" y2="${cy + r2 * Math.sin(a)}" stroke="var(--sol)" stroke-width="2" stroke-linecap="round"/>`;
    }).join("");
    const gotas = (n) => [12, 19, 26].slice(0, n).map((x) => `<line x1="${x}" y1="33" x2="${x - 2}" y2="38" stroke="var(--gota)" stroke-width="2" stroke-linecap="round"/>`).join("");
    const raio = `<path d="M21 29l-5 7h4l-2 6 7-9h-4l2-4z" fill="var(--raio)"/>`;
    const geada = `<g stroke="var(--gota)" stroke-width="1.5" stroke-linecap="round"><line x1="20" y1="31" x2="20" y2="41"/><line x1="15.7" y1="33.5" x2="24.3" y2="38.5"/><line x1="15.7" y1="38.5" x2="24.3" y2="33.5"/></g>`;
    const nevoeiro = `<g stroke="var(--nuvem)" stroke-width="2" stroke-linecap="round"><line x1="8" y1="34" x2="32" y2="34"/><line x1="12" y1="39" x2="28" y2="39"/></g>`;
    const corpos = {
      "sol": sol(20, 20, 8),
      "sol-poucas-nuvens": sol(27, 13, 6) + nuvem,
      "sol-nuvens": sol(28, 12, 6) + escura,
      "nublado": escura,
      "chuvisco": nuvem + gotas(2),
      "chuva": escura + gotas(3),
      "chuva-raios": escura + gotas(2) + raio,
      "sol-chuva": sol(27, 13, 6) + nuvem + gotas(3),
      "sol-chuva-raios": sol(28, 12, 6) + escura + gotas(2) + raio,
      "geada": nuvem + geada,
      "nevoeiro": nuvem + nevoeiro,
    };
    const corpo = corpos[tipo] || escura;
    return svgEl(`<svg width="${tam}" height="${tam}" viewBox="0 0 40 42" aria-hidden="true">${corpo}</svg>`);
  }

  // ------------------------------------------------------------------ tooltip e tabelas
  const tip = $("tooltip");
  function mostrarTip(x, y, titulo, linhas) {
    trocar(tip, el("div", { class: "t" }, titulo), ...linhas.map((l) => el("div", { class: "l" },
      l.cor ? el("i", { class: "k-linha", style: `background:${l.cor}` }) : null, el("strong", {}, l.valor), el("span", {}, l.rotulo || ""))));
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    tip.style.left = `${Math.max(8, left)}px`; tip.style.top = `${Math.max(8, top)}px`;
  }
  const esconderTip = () => { tip.hidden = true; };
  const tabela = (colunas, linhas) => el("table", {}, el("thead", {}, el("tr", {}, ...colunas.map((c) => el("th", { scope: "col" }, c)))),
    el("tbody", {}, ...linhas.map((l) => el("tr", {}, ...l.map((v) => el("td", {}, v))))));
  const TABELAS = {};
  function vistaTabela(id) {
    const btn = document.querySelector(`[data-tabela="${id}"]`), graf = $(id);
    let vt = $(`${id}-tabela`);
    if (btn.getAttribute("aria-pressed") !== "true") { if (vt) vt.hidden = true; graf.hidden = false; return; }
    if (!vt) { vt = el("div", { id: `${id}-tabela`, class: "vista-tabela" }); graf.after(vt); }
    trocar(vt, tabela(TABELAS[id].colunas, TABELAS[id].linhas));
    vt.hidden = false; graf.hidden = true;
  }
  document.querySelectorAll(".btn-tabela").forEach((b) => b.addEventListener("click", () => {
    const ativo = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(ativo)); b.textContent = ativo ? "Gráfico" : "Tabela";
    if (!ativo) { $(b.dataset.tabela).hidden = false; desenharGraficos(); } else vistaTabela(b.dataset.tabela);
  }));

  // ------------------------------------------------------------------ estado
  const DIAS = P.dias;
  let selecionado = Math.max(0, DIAS.findIndex((d) => d.data === AGORA.data));
  const H = P.horario;
  const T = H.tempo.map(dataDe);
  const UMA_HORA = 3600000;
  const niveisUV = P.niveis_uv || [];
  const apresentarUV = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.floor(Number(v) + 0.5)));
  const nivelUV = (v) => {
    const n = apresentarUV(v);
    return n == null ? null : niveisUV.find((f) => n >= f.min && (f.max == null || n <= f.max)) || null;
  };
  function indiceHoraAtual(data) {
    if (data !== AGORA.data) return -1;
    let encontrado = -1;
    for (let i = 0; i < T.length; i += 1) {
      if (+T[i] > AGORA.quando) break;
      if (H.tempo[i].startsWith(data)) encontrado = i;
    }
    return encontrado;
  }
  function sensacaoAgora(d) {
    const i = indiceHoraAtual(d.data);
    return i < 0 ? null : { valor: H.sensacao[i], hora: H.tempo[i].slice(11, 16) };
  }
  const MODELOS = { consenso: "Média (ensemble)", ecmwf: "ECMWF/IFS", gfs: "NOAA/GFS" };
  const CORES_MODELOS = { consenso: "var(--modelo-consenso)", ecmwf: "var(--modelo-ecmwf)", gfs: "var(--modelo-gfs)" };
  const CORES_TEMP = { consenso: "var(--modelo-consenso-temp)", ecmwf: "var(--modelo-ecmwf-temp)", gfs: "var(--modelo-gfs-temp)" };
  const SERIE = {
    sensacao: { consenso: H.sensacao, ecmwf: H.sensacao_ecmwf, gfs: H.sensacao_gfs },
    temp: { consenso: H.temp, ecmwf: H.temp_ecmwf, gfs: H.temp_gfs },
  };
  const estadoCalor = { modelos: { consenso: true, ecmwf: false, gfs: false }, sensacao: true, temp: true, diferenca: true, picos: true };
  const estadoChuva = { ecmwf: true, gfs: true };
  const CHUVA = [{ id: "ecmwf", nome: "ECMWF/IFS", cor: "var(--s1)", dados: H.chuva_ecmwf }, { id: "gfs", nome: "NOAA/GFS", cor: "var(--s2)", dados: H.chuva_gfs }];
  const chuvaDia = (d) => d.poaclima ? d.poaclima.chuva_mm : null;

  // ------------------------------------------------------------------ cabeçalho e aviso
  const gerado = P.gerado_em;
  $("atualizado").textContent = `Atualizado às ${gerado.slice(11, 16)} de ${ddmm(gerado)}`;
  const horasDesde = (AGORA.quando - dataDe(gerado)) / UMA_HORA;
  if (horasDesde > 12) {
    const aviso = $("aviso-dados");
    aviso.hidden = false;
    aviso.textContent = `Atenção: esta previsão foi gerada há ${Math.round(horasDesde)} horas. A atualização automática pode ter falhado; confira também os avisos da Defesa Civil.`;
  }

  // ------------------------------------------------------------------ compartilhar
  const URL_PAINEL = "https://ciscpoa.github.io/Painel_Sensacao_Termica_POA/";
  const textoCompartilhamento = (d) => `${rotuloDia(d)}, ${ddmmaaaa(d.data)}: Calor Nível ${d.nivel}. `
    + `Sensação térmica máxima ${grau(d.sensacao.max)} às ${d.sensacao.h_max}. ${d.motivo} Acesse o painel: ${URL_PAINEL}`;

  function desenharTexto(ctx, texto, x, y, largura, alturaLinha, maxLinhas = 3, centralizar = false) {
    const posX = centralizar ? x + largura / 2 : x;
    ctx.textAlign = centralizar ? "center" : "left";
    let linha = "", linhas = 0;
    for (const palavra of texto.split(" ")) {
      const teste = linha ? `${linha} ${palavra}` : palavra;
      if (ctx.measureText(teste).width > largura && linha) {
        linhas += 1;
        if (linhas >= maxLinhas) { ctx.fillText(`${linha}…`, posX, y); return y + alturaLinha; }
        ctx.fillText(linha, posX, y); y += alturaLinha; linha = palavra;
      } else { linha = teste; }
    }
    if (linha) { ctx.fillText(linha, posX, y); y += alturaLinha; }
    return y;
  }

  function caixa(ctx, x, y, w, h, r = 16) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  function criarImagemAlerta(d) {
    const canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 630;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = d.cor_bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = d.cor_fg;
    ctx.font = '700 24px "Public Sans", sans-serif';
    ctx.fillText("PAINEL DE CALOR DE PORTO ALEGRE", 60, 58);
    ctx.textAlign = "right";
    ctx.font = '500 24px "Public Sans", sans-serif';
    ctx.fillText(`${rotuloDia(d)}, ${ddmmaaaa(d.data)}`, 1140, 58);

    // Mais 20% sobre o selo anterior, mantendo texto e contorno na mesma caixa.
    const nivel = `CALOR NÍVEL ${d.nivel}`;
    ctx.font = '800 54.6px "Public Sans", sans-serif';
    const larguraNivel = ctx.measureText(nivel).width + 100;
    ctx.fillStyle = d.cor_fg;
    caixa(ctx, (1200 - larguraNivel) / 2, 60, larguraNivel, 108, 54);
    ctx.fillStyle = d.cor_bg; ctx.textAlign = "center"; ctx.fillText(nivel, 600, 138);

    // Motivo centralizado e em negrito, imediatamente abaixo do selo.
    ctx.fillStyle = d.cor_fg; ctx.font = '700 29px "Public Sans", sans-serif';
    let y = desenharTexto(ctx, d.motivo, 60, 198, 1080, 34, 2, true);
    ctx.textAlign = "left";

    const atual = sensacaoAgora(d), temUV = d.uv && apresentarUV(d.uv.max) != null;
    const janela = d.janela_ini != null ? `${d.janela_ini}h às ${d.janela_fim}h` : "sem janela crítica ativa";
    const sensacao = atual ? `Sensação térmica agora: ${grau(atual.valor)} (${atual.hora})`
      : `Sensação térmica: previsão para ${rotuloDia(d).toLowerCase()}`;
    const uv = temUV ? `UV máx.: ${apresentarUV(d.uv.max)} · ${nivelUV(d.uv.max).nome}` : "UV máx.: indisponível nesta atualização";
    const linhasInfo = [
      `Horário mais crítico: ${janela}`,
      sensacao,
      uv,
      `Máxima do dia: ${grau(d.sensacao.max)} às ${d.sensacao.h_max}`,
    ];

    // Um único quadro branco, quatro linhas e um círculo preenchido por linha.
    const compacto = y > 240, quadroTopo = y + 8, alturaQuadro = 180;
    ctx.fillStyle = "rgba(255,255,255,.45)"; caixa(ctx, 50, quadroTopo, 1100, alturaQuadro, 16);
    ctx.fillStyle = d.cor_fg; ctx.font = `650 ${compacto ? 23 : 25}px "Public Sans", sans-serif`;
    linhasInfo.forEach((texto, i) => {
      const baseline = quadroTopo + 34 + i * 39;
      ctx.beginPath(); ctx.arc(78, baseline - 8, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(texto, 98, baseline);
    });
    y = quadroTopo + alturaQuadro;

    ctx.font = '700 24px "Public Sans", sans-serif';
    ctx.fillText(d.nivel > 1 ? "O que fazer" : "Recomendações", 60, y + (compacto ? 24 : 32));
    ctx.font = `400 ${compacto ? 20 : 23}px "Public Sans", sans-serif`;
    y += compacto ? 50 : 64;
    d.publico.slice(0, 2).forEach((texto) => {
      y = desenharTexto(ctx, `• ${texto}`, 60, y, 1080, compacto ? 22 : 29, 2) + (compacto ? 4 : 7);
    });
    ctx.fillStyle = d.cor_fg; ctx.font = '500 19px "Public Sans", sans-serif';
    ctx.textAlign = "right"; ctx.fillText("ciscpoa.github.io/protocolo_de_calor_Porto_Alegre", 1140, 606);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  async function compartilhar(d) {
    const botao = document.querySelector(".compartilhar");
    botao.disabled = true; botao.textContent = "Gerando imagem…";
    try {
      const blob = await criarImagemAlerta(d);
      const arquivo = new File([blob], `alerta-calor-${d.data}.png`, { type: "image/png" });
      const texto = textoCompartilhamento(d);
      if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
        await navigator.share({ title: "Painel de Calor de Porto Alegre", text: texto, files: [arquivo] });
      } else if (navigator.share) {
        await navigator.share({ title: "Painel de Calor de Porto Alegre", text: texto });
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
      }
    } catch (erro) {
      if (erro.name !== "AbortError") window.open(`https://wa.me/?text=${encodeURIComponent(textoCompartilhamento(d))}`, "_blank", "noopener");
    } finally {
      botao.disabled = false; botao.textContent = "Compartilhar alerta";
    }
  }

  async function baixarImagemAlerta(d) {
    const botao = document.querySelector(".baixar-png");
    botao.disabled = true; botao.textContent = "Gerando…";
    try {
      const blob = await criarImagemAlerta(d), url = window.URL.createObjectURL(blob);
      const a = el("a", { href: url, download: `alerta-calor-${d.data}.png` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } finally {
      botao.disabled = false; botao.textContent = "Baixar PNG";
    }
  }

  // ------------------------------------------------------------------ dia escolhido: alerta, sensação e tempo
  function renderAlerta() {
    const d = DIAS[selecionado], a = $("alerta");
    a.style.background = d.cor_bg; a.style.color = d.cor_fg;
    trocar(a,
      el("div", { class: "nivel-nome" },
        el("div", { class: "nivel" }, el("span", { class: "num", style: `background:${d.cor_fg};color:${d.cor_bg}` }, `Calor Nível ${d.nivel}`))),
      el("p", { class: "motivo" }, d.motivo),
      d.janela_ini != null ? el("div", { class: "janela" }, `Horário mais crítico: ${d.janela_ini}h às ${d.janela_fim}h`) : null,
      el("h3", {}, d.nivel > 1 ? "O que fazer" : "Recomendações"),
      el("ul", {}, ...d.publico.map((t) => el("li", {}, t))),
      el("div", { class: "rodape-alerta" },
        el("div", { class: "compartilhar-grupo" },
          el("button", { class: "compartilhar", type: "button", style: `background:${d.cor_fg};color:${d.cor_bg};border:1px solid ${d.cor_fg}`, onclick: () => compartilhar(d) }, "Compartilhar alerta"),
          el("button", { class: "baixar-png", type: "button", onclick: () => baixarImagemAlerta(d) }, "Baixar PNG")),
        el("span", { class: "quando" }, `${rotuloDia(d)}, ${ddmmaaaa(d.data)}`)),
    );
  }

  function regua(valor, atual = false) {
    const MIN = -10, MAX = 50, pos = (v) => ((Math.max(MIN, Math.min(MAX, v)) - MIN) / (MAX - MIN)) * 100;
    const segs = FAIXAS.map((f) => ({ ...f, a: Math.max(f.de, MIN), b: Math.min(f.ate, MAX) })).filter((s) => s.b > s.a);
    const barra = el("div", { class: "barra" }, ...segs.map((s) => el("span", { title: rotuloFaixa(s), style: `flex:${s.b - s.a};background:${s.cor}` })),
      el("i", { class: "marcador", style: `left:${pos(valor)}%` }));
    const marcas = FAIXAS.map((f) => f.de).filter((v) => v > MIN && v < MAX);
    const ticks = el("div", { class: "ticks" }, ...marcas.map((t) => el("span", {
    style: `left:${pos(t)}%;top:${t === 6 || t === 34 ? "16px" : "3px"}` }, `${t}°C`)));
    return el("div", { class: "regua", role: "img", "aria-label": `${atual ? "Sensação térmica atual" : "Sensação térmica máxima"} de ${f0(valor)} °C, faixa ${faixa(valor).nome}` }, barra, ticks);
  }

  function segmentosFaixa(d, f) {
    const grupos = [];
    let inicio = -1, fim = -1;
    const fechar = () => { if (inicio >= 0) grupos.push({ inicio, fim }); inicio = fim = -1; };
    H.sensacao.forEach((v, i) => {
      if (!H.tempo[i].startsWith(d.data)) { fechar(); return; }
      const dentro = v >= f.de && v < f.ate;
      if (dentro && inicio < 0) { inicio = fim = i; }
      else if (dentro && i === fim + 1) { fim = i; }
      else if (dentro) { fechar(); inicio = fim = i; }
      else { fechar(); }
    });
    fechar();
    return grupos;
  }

  const textoPeriodo = (g) => {
    const a = H.tempo[g.inicio].slice(11, 13), b = H.tempo[g.fim].slice(11, 13);
    return g.inicio === g.fim ? `${a}h` : `${a}h às ${b}h`;
  };
  const textoPeriodos = (grupos) => grupos.map(textoPeriodo).join(" · ");
  const listaPeriodos = (grupos) => el("ul", { class: "lista-periodos" }, ...grupos.map((g) => el("li", {}, textoPeriodo(g))));

  function renderSensacao() {
    const d = DIAS[selecionado], atual = sensacaoAgora(d), ehAtual = atual !== null;
    const valor = ehAtual ? atual.valor : d.sensacao.max;
    const hora = ehAtual ? atual.hora : d.sensacao.h_max;
    const fx = faixa(valor);
    const grupos = FAIXAS.map((f) => ({ f, periodos: segmentosFaixa(d, f) })).filter((g) => g.periodos.length)
      .sort((a, b) => a.f.de - b.f.de);
    trocar($("sensacao"),
      el("h2", { class: "rotulo" }, ehAtual ? "Sensação térmica atual" : "Sensação térmica máxima",
        el("small", {}, ehAtual ? "" : "pico previsto para o dia selecionado")),
      el("div", { class: "valor" }, el("strong", {}, grau(valor)),
        el("span", { class: "pilula-faixa", style: `background:${fx.cor};color:${textoFaixa(fx)}` }, fx.nome),
        el("span", { class: "hora" }, `às ${hora}`)),
      ehAtual ? el("p", { class: "maximo" }, `Máxima prevista hoje: ${grau(d.sensacao.max)} às ${d.sensacao.h_max}`) : null,
      regua(valor, ehAtual),
      el("div", { class: "rotulo-grupo" }, "Horas e períodos por faixa de estresse térmico"),
      el("div", { class: "horas", "aria-label": "Horas e períodos em cada faixa de estresse térmico" }, ...grupos.map(({ f, periodos }) => {
        const total = periodos.reduce((n, g) => n + g.fim - g.inicio + 1, 0), periodo = textoPeriodos(periodos);
        const rotulo = f.nome === "Sem estresse térmico"
  ? "Sem estresse térmico"
  : `Estresse térmico ${f.rotulo.replace(/^estresse\s+/, "")}`;
        return el("div", { class: "faixa-horas", style: `background:${f.cor};color:${textoFaixa(f)}`, title: `${total} h · ${f.rotulo} · ${periodo}` },
          el("div", { class: "resumo-faixa" }, el("b", {}, `${total} h`), el("span", { class: "texto-resumo" }, " do dia")),
          listaPeriodos(periodos),
          el("span", { class: "rotulo-estresse" }, rotulo));
      })),
      el("p", { class: "explica" }, "A sensação térmica é calculada a partir da junção da temperatura do ar, radiação solar, umidade e vento. Os níveis de alerta também consideram a duração do calor e o acúmulo entre dias."),
    );
  }

  function renderTempo() {
    const d = DIAS[selecionado], p = d.poaclima;
    const setas = { N: "↓", NE: "↙", L: "←", E: "←", SE: "↖", S: "↑", SO: "↗", SW: "↗", O: "→", W: "→", NO: "↘", NW: "↘" };
    const dir = p?.vento_dir ? String(p.vento_dir).toUpperCase() : null;
    const seta = dir && setas[dir] ? ` ${setas[dir]}` : "";

    trocar($("tempo-dia"),
      el("h2", { class: "rotulo" }, "Previsão do Tempo"),
      el("div", { class: "linha1" },
        icone(d.icone, 52),
        el("div", {},
          el("div", { class: "cond" }, d.condicao),
          el("div", { class: "estab" }, d.tempo),
        ),
      ),
      el("div", { class: "numeros" },
        el("div", {}, el("span", {}, "Temperatura máxima"), el("strong", {}, grau(d.temp?.max))),
        el("div", {}, el("span", {}, "Temperatura mínima"), el("strong", {}, grau(d.temp?.min))),
        el("div", {}, el("span", {}, "Chuva prevista"), el("strong", {}, p?.chuva_mm == null ? "—" : `${f1(p.chuva_mm)} mm`)),
        el("div", {}, el("span", {}, "Umidade máxima / mínima"), el("strong", {}, p?.umidade_max_pct == null || p?.umidade_min_pct == null ? "—" : `${f0(p.umidade_max_pct)}% / ${f0(p.umidade_min_pct)}%`)),
        el("div", {}, el("span", {}, "Velocidade do vento"), el("strong", {}, p?.vento_kmh == null ? "—" : `${f0(p.vento_kmh)} km/h`)),
        el("div", {}, el("span", {}, "Direção do vento"), el("strong", {}, dir ? `${dir}${seta}` : "—")),
      ),
    );
  }

  function renderUV() {
    const d = DIAS[selecionado], info = d.uv, alvo = $("uv");
    if (!info || apresentarUV(info.max) == null) {
      trocar(alvo, el("h2", { class: "rotulo" }, "Índice ultravioleta (UV)", el("small", {}, "radiação solar e proteção")),
        el("p", { class: "indisponivel" }, "Índice UV indisponível nesta atualização. Consulte novamente na próxima atualização da previsão."));
      return;
    }
    const maximo = apresentarUV(info.max), iAtual = indiceHoraAtual(d.data);
    const uvAtual = iAtual >= 0 && H.uv ? apresentarUV(H.uv[iAtual]) : null;
    const ehAtual = uvAtual != null, valor = ehAtual ? uvAtual : maximo;
    const fx = ehAtual ? nivelUV(H.uv[iAtual]) : nivelUV(info.max);
    const hora = ehAtual ? H.tempo[iAtual].slice(11, 16) : info.h_max;
    trocar(alvo,
      el("h2", { class: "rotulo" }, "Índice ultravioleta (UV)", el("small", {}, ehAtual ? "valor da hora mais recente" : "máximo previsto no dia")),
      el("div", { class: "valor-uv" }, el("strong", { "aria-label": `${ehAtual ? "Índice UV atual" : "Índice UV máximo"} ${valor}`, style: `color:${fx.cor_fg}` }, String(valor)),
        el("span", { class: "pilula-faixa", style: `background:${fx.cor_bg};color:${fx.cor_fg}` }, fx.nome),
        el("span", { class: "hora" }, `às ${hora}`)),
      ehAtual ? el("p", { class: "maximo-uv" }, `Máxima prevista hoje: UV ${maximo} · ${nivelUV(info.max).nome} às ${info.h_max}`) : null,
      el("div", { class: "escala-uv", role: "img", "aria-label": `Escala UV: ${fx.nome}, valor ${valor}` }, ...niveisUV.map((f) =>
        el("span", { style: `--cor-uv:${f.cor_fg}`, title: f.nome, "aria-current": f.nome === fx.nome ? "true" : null }, `${f.min}${f.max == null ? "+" : `–${f.max}`}`))),
      !ehAtual && info.max_ceu_limpo != null ? el("p", { class: "agora-uv" }, `Céu limpo: UV máx. ${apresentarUV(info.max_ceu_limpo)}`) : null,
      el("p", { class: "cuidado-uv" }, fx.cuidado),
      el("p", { class: "explica" }, "Referência: ", el("a", { href: "https://www.who.int/publications/i/item/9241590076", target: "_blank", rel: "noopener" }, "Global Solar UV Index — OMS")),
    );
  }

  // ------------------------------------------------------------------ cartões dos dias
  function renderDias() {
    trocar($("dias"), ...DIAS.map((d, i) => {
      const fx = faixa(d.sensacao.max), chuva = chuvaDia(d), p = d.poaclima;
      const uvMax = d.uv ? apresentarUV(d.uv.max) : null, uvNivel = d.uv ? nivelUV(d.uv.max) : null;
      return el("button", {
        class: "dia", type: "button", "aria-pressed": String(i === selecionado),
        "aria-label": `${rotuloDia(d)} ${ddmm(d.data)}: Calor Nível ${d.nivel}; sensação térmica até ${f0(d.sensacao.max)} °C`,
        onclick: () => { selecionado = i; renderTudo(); },
      },
        el("div", { class: "cab" }, el("b", {}, rotuloDia(d)), el("span", {}, ddmm(d.data))),
        el("span", { class: "chip", style: `background:${d.cor_bg};color:${d.cor_fg}` }, `Calor Nível ${d.nivel}`),
        el("div", { class: "sens", title: "Sensação térmica calculada pelo CISC" }, el("span", {}, "Sensação térmica máxima"),
          el("div", {}, el("i", { class: "pt", style: `background:${fx.cor}` }), el("strong", {}, grau(d.sensacao.max)))),
        el("div", { class: "cond" }, icone(d.icone, 28), d.condicao),
        el("div", { class: "info", title: "Previsão diária do PoaClima / Catavento" }, `Temp. ${grau(d.temp.max)} / ${grau(d.temp.min)}`, el("br"),
          `Chuva ${f1(chuva)} mm`, el("br"), `Vento ${f0(p.vento_kmh)} km/h · ${p.vento_dir}`),
        uvMax != null && uvNivel ? el("div", { class: "uv-dia", style: `background:${uvNivel.cor_bg};color:${uvNivel.cor_fg}` }, `UV máx. ${uvMax} · ${uvNivel.nome}`) : null,
        d.noite_quente ? el("span", { class: "marca-noite" }, "Madrugada quente") : null,
      );
    }));
  }

  // ------------------------------------------------------------------ peças dos gráficos
  const largura = (div) => Math.max(280, Math.floor(div.clientWidth || 600));
  const linhaH = (g, x1, x2, y, cor) => g.append("line").attr("x1", x1).attr("x2", x2).attr("y1", y).attr("y2", y).style("stroke", cor).style("stroke-width", 1).attr("shape-rendering", "crispEdges");
  const linhaV = (g, x, y1, y2, cor) => g.append("line").attr("x1", x).attr("x2", x).attr("y1", y1).attr("y2", y2).style("stroke", cor).style("stroke-width", 1).attr("shape-rendering", "crispEdges");
  const texto = (g, x, y, t, { ancora = "start", cor = "var(--muda)", tam = 11.5, peso = 400 } = {}) =>
    g.append("text").attr("x", x).attr("y", y).attr("dy", "0.32em").attr("text-anchor", ancora).style("fill", cor).style("font-size", `${tam}px`).style("font-weight", peso).text(t);
  const dominioX = [T[0], new Date(+T[T.length - 1] + UMA_HORA)];
  const meio = (i) => new Date(+T[i] + UMA_HORA / 2);
  const rotuloHora = (i) => `${SEM[T[i].getUTCDay()]} ${String(T[i].getUTCDate()).padStart(2, "0")}/${String(T[i].getUTCMonth() + 1).padStart(2, "0")}, ${T[i].getUTCHours()}h`;

  function eixoDias(svg, x, m, h, comChuva = false) {
    const fundo = svg.append("g").attr("class", "eixo");
    DIAS.forEach((d, i) => {
      const x0 = x(dataDe(`${d.data}T00:00`)), x1 = x(new Date(+dataDe(`${d.data}T00:00`) + 24 * UMA_HORA));
      if (i === selecionado) fundo.append("rect").attr("x", x0).attr("y", m.t).attr("width", x1 - x0).attr("height", h - m.t - m.b)
        .style("fill", "var(--tinta)").style("fill-opacity", 0.05);
      if (i > 0) linhaV(fundo, x0, m.t - 6, h - m.b, "var(--eixo)");
      const cx = (x0 + x1) / 2, larguraDia = x1 - x0;
      const rotulo = larguraDia > 70 ? `${SEM[dataDe(d.data).getUTCDay()]} ${ddmm(d.data)}` : ddmm(d.data);
      const estilo = { ancora: "middle", cor: i === selecionado ? "var(--tinta)" : "var(--muda)", peso: i === selecionado ? 650 : 400 };
      if (!comChuva) {
        texto(fundo, cx, m.t - 14, rotulo, estilo);
        return;
      }
      const quadro = (centroX, centroY) => {
        const w = 58, h = 18, q = fundo.append("g").attr("class", "mini-quadro");
        q.append("rect").attr("x", centroX - w / 2).attr("y", centroY - h / 2).attr("width", w).attr("height", h).attr("rx", 5)
          .style("fill", "var(--superficie)").style("stroke", "var(--borda)");
        const chuvaPoa = d.poaclima?.chuva_mm;
        texto(q, centroX, centroY, chuvaPoa == null ? "—" : `${f1(chuvaPoa)} mm`,
          { ancora: "middle", cor: "var(--tinta2)", tam: 10, peso: 650 });
      };
      if (larguraDia < 115) {
        texto(fundo, cx, m.t - 28, rotulo, estilo);
        quadro(cx, m.t - 10);
      } else {
        texto(fundo, cx - 4, m.t - 14, rotulo, { ...estilo, ancora: "end" });
        quadro(cx + 33, m.t - 14);
      }
    });
  }
  // Horas no eixo X: 6h, 12h e 18h em telas largas; só 12h nas estreitas
  function eixoHoras(svg, x, h, m, w) {
    const g = svg.append("g").attr("class", "eixo"), marcas = w > 720 ? [6, 12, 18] : [12];
    T.forEach((t, i) => { if (marcas.includes(t.getUTCHours())) texto(g, x(meio(i)), h - m.b + 14, `${t.getUTCHours()}h`, { ancora: "middle" }); });
  }
  function linhaAgora(svg, x, m, h) {
    if (AGORA.quando < +dominioX[0] || AGORA.quando > +dominioX[1]) return;
    const xa = x(new Date(AGORA.quando));
    linhaV(svg, xa, m.t, h - m.b, "var(--tinta2)");
    texto(svg, xa + 4, h - m.b - 8, "agora", { cor: "var(--tinta2)" });
  }
  function cruz(svg, x, m, w, h, aoMostrar) {
    const linha = svg.append("line").style("stroke", "var(--tinta2)").style("stroke-width", 1).style("display", "none");
    const pontos = svg.append("g");
    let atual = 0;
    const mostrar = (i, cx, cy) => {
      atual = i;
      const px = x(meio(i));
      linha.attr("x1", px).attr("x2", px).attr("y1", m.t).attr("y2", h - m.b).style("display", null);
      pontos.selectAll("*").remove();
      const r = aoMostrar(i, pontos, px);
      if (cx == null) { const b = svg.node().getBoundingClientRect(); cx = b.left + px; cy = b.top + m.t; }
      mostrarTip(cx, cy, r.titulo, r.linhas);
    };
    const esconder = () => { linha.style("display", "none"); pontos.selectAll("*").remove(); esconderTip(); };
    const indice = (px) => Math.max(0, Math.min(T.length - 1, Math.floor((+x.invert(px) - +T[0]) / UMA_HORA)));
    const selecionarPorHora = (i) => {
      const j = DIAS.findIndex((d) => d.data === H.tempo[i].slice(0, 10));
      if (j >= 0 && j !== selecionado) { selecionado = j; renderTudo(); }
    };
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", w - m.l - m.r).attr("height", h - m.t - m.b).style("fill", "transparent").style("cursor", "crosshair")
      .on("pointermove", (ev) => mostrar(indice(d3.pointer(ev)[0]), ev.clientX, ev.clientY))
      .on("pointerleave", esconder)
      .on("click", (ev) => selecionarPorHora(indice(d3.pointer(ev)[0])));
    svg.attr("tabindex", 0).on("focus", () => mostrar(atual)).on("blur", esconder).on("keydown", (ev) => {
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") { ev.preventDefault(); mostrar(Math.max(0, Math.min(T.length - 1, atual + (ev.key === "ArrowLeft" ? -1 : 1)))); }
    });
  }
  // Botão de legenda que mostra/esconde uma série
  const botaoSerie = (rotulo, chave, ligado, aoClicar) => el("button", { type: "button", "aria-pressed": String(ligado), onclick: aoClicar }, chave, rotulo);

  // ------------------------------------------------------------------ gráfico de sensação térmica
  function controlesCalor() {
    const c = estadoCalor;
    trocar($("modelo-calor"), ...Object.entries(MODELOS).map(([k, r]) => el("button", {
      type: "button", "aria-pressed": String(c.modelos[k]), title: `${c.modelos[k] ? "Ocultar" : "Mostrar"} ${r}`,
      onclick: () => { c.modelos[k] = !c.modelos[k]; desenharGraficos(); } },
      el("i", { class: "k-linha", style: `background:${CORES_MODELOS[k]};height:3px` }), r)));
    const alternar = (k) => () => { c[k] = !c[k]; desenharGraficos(); };
    trocar($("legenda-calor"),
      botaoSerie("Sensação térmica", el("i", { class: "k-linha", style: "background:var(--tinta);height:3px" }), c.sensacao, alternar("sensacao")),
      botaoSerie("Temperatura do ar", el("i", { class: "k-linha k-tracejada", style: "color:var(--tinta2)" }), c.temp, alternar("temp")),
      c.sensacao && c.modelos.ecmwf && c.modelos.gfs ? botaoSerie("Diferença entre os modelos", el("i", { class: "k-caixa", style: "background:var(--tinta);opacity:.18" }), c.diferenca, alternar("diferenca")) : null,
      botaoSerie("Pico de cada dia", el("i", { class: "k-caixa", style: "background:var(--tinta);border-radius:50%;width:10px;height:10px" }), c.picos, alternar("picos")),
    );
  }

  function graficoCalor() {
    controlesCalor();
    const c = estadoCalor, ativos = Object.keys(c.modelos).filter((k) => c.modelos[k]);
    const div = $("graf-calor"), w = largura(div), h = Math.round(Math.max(300, Math.min(440, w * 0.36)));
    const m = { t: 34, r: w < 640 ? 12 : 28, b: 26, l: 48 };
    div.replaceChildren();
    const nomesAtivos = ativos.map((k) => MODELOS[k]).join(", ") || "nenhum modelo selecionado";
    const svg = d3.select(div).append("svg").attr("width", w).attr("height", h).attr("role", "img")
      .attr("aria-label", `Sensação térmica e temperatura do ar hora a hora: ${nomesAtivos}`);
    const x = d3.scaleUtc().domain(dominioX).range([m.l, w - m.r]);
    const minM = H.sensacao_ecmwf.map((v, i) => Math.min(v, H.sensacao_gfs[i])), maxM = H.sensacao_ecmwf.map((v, i) => Math.max(v, H.sensacao_gfs[i]));
    // Eixo estável: considera todas as séries, mesmo as escondidas.
    const lo = Math.floor(Math.min(d3.min(H.temp_ecmwf), d3.min(H.temp_gfs), d3.min(minM)) - 2);
    const hi = Math.ceil(Math.max(d3.max(maxM), d3.max(H.temp_ecmwf), d3.max(H.temp_gfs), 30) + 3);
    const y = d3.scaleLinear().domain([lo, hi]).nice(6).range([h - m.b, m.t]);
    const [y0, y1] = y.domain();
    trocar($("faixas-calor"), ...FAIXAS.filter((f) => f.ate > y0 && f.de < y1).map((f) =>
      el("span", {}, el("i", { style: `background:${f.cor}` }), f.nome)));
    const fundo = svg.append("g");
    FAIXAS.forEach((f) => {
      const a = Math.max(f.de, y0), b = Math.min(f.ate, y1);
      if (b <= a) return;
      fundo.append("rect").attr("x", m.l).attr("width", w - m.l - m.r).attr("y", y(b)).attr("height", y(a) - y(b)).style("fill", f.cor).style("fill-opacity", "var(--faixa-op)");
    });
    eixoDias(svg, x, m, h);
    const eixo = svg.append("g").attr("class", "eixo");
    y.ticks(6).forEach((t) => { linhaH(eixo, m.l, w - m.r, y(t), "var(--grade)"); texto(eixo, m.l - 6, y(t), `${f0(t)} °C`, { ancora: "end" }); });
    eixoHoras(svg, x, h, m, w);
    const plot = svg.append("g").attr("class", "series"), idx = T.map((_, i) => i);
    if (c.sensacao && c.modelos.ecmwf && c.modelos.gfs && c.diferenca) {
      plot.append("path").datum(idx).attr("d", d3.area().x((i) => x(meio(i))).y0((i) => y(minM[i])).y1((i) => y(maxM[i])))
        .style("fill", "var(--tinta)").style("fill-opacity", 0.08);
    }
    const linha = (arr, cor, larg, tracejada = false, classe = "") => plot.append("path").datum(idx)
      .attr("class", classe)
      .attr("d", d3.line().x((i) => x(meio(i))).y((i) => y(arr[i])))
      .style("fill", "none").style("stroke", cor).style("stroke-width", larg)
      .style("stroke-dasharray", tracejada ? "7 5" : null).style("stroke-linejoin", "round").style("stroke-linecap", "round");
    // Temperatura: tracejada e fina. UTCI: contínua e mais espessa, sempre por cima.
    ativos.forEach((mod) => { if (c.temp) linha(SERIE.temp[mod], CORES_TEMP[mod], mod === "consenso" ? 2.1 : 1.9, true, `serie-temp serie-${mod}`); });
    ativos.forEach((mod) => { if (c.sensacao) linha(SERIE.sensacao[mod], CORES_MODELOS[mod], mod === "consenso" ? 3.3 : 2.7, false, `serie-utci serie-${mod}`); });
    if (!ativos.length || (!c.sensacao && !c.temp)) {
      texto(plot, (m.l + w - m.r) / 2, (m.t + h - m.b) / 2,
        !ativos.length ? "Escolha pelo menos um modelo acima" : "Ative sensação térmica ou temperatura do ar", { ancora: "middle", cor: "var(--tinta2)", tam: 14, peso: 600 });
    }
    if (c.sensacao && c.picos) ativos.forEach((mod, imodelo) => {
      const U = SERIE.sensacao[mod];
      DIAS.forEach((d) => {
        let im = -1;
        H.tempo.forEach((t, i) => { if (t.startsWith(d.data) && (im < 0 || U[i] > U[im])) im = i; });
        if (im < 0) return;
        const px = x(meio(im)), py = y(U[im]);
        plot.append("circle").attr("class", "pico-utci").attr("cx", px).attr("cy", py).attr("r", 4.5).style("fill", CORES_MODELOS[mod]).style("stroke", "var(--superficie)").style("stroke-width", 2);
        texto(plot, px, py - 12 - imodelo * 12, `${f0(U[im])} °C`, { ancora: "middle", cor: CORES_MODELOS[mod], tam: ativos.length > 1 ? 10.5 : 11.5, peso: 700 });
      });
    });
    if (c.temp && c.picos) ativos.forEach((mod, imodelo) => {
      const TA = SERIE.temp[mod];
      DIAS.forEach((d) => {
        let im = -1;
        H.tempo.forEach((t, i) => { if (t.startsWith(d.data) && (im < 0 || TA[i] > TA[im])) im = i; });
        if (im < 0) return;
        const px = x(meio(im)), py = y(TA[im]);
        plot.append("path").attr("class", "pico-temp").attr("d", `M${px},${py - 5}L${px + 5},${py}L${px},${py + 5}L${px - 5},${py}Z`)
          .style("fill", CORES_TEMP[mod]).style("stroke", "var(--superficie)").style("stroke-width", 1.5);
        texto(plot, px, py + 17 + imodelo * 10, `${f0(TA[im])} °C`, { ancora: "middle", cor: CORES_TEMP[mod], tam: ativos.length > 1 ? 10 : 11, peso: 650 });
      });
    });
    linhaAgora(svg, x, m, h);
    cruz(svg, x, m, w, h, (i, g, px) => {
      const linhas = [];
      ativos.forEach((mod) => {
        const cor = CORES_MODELOS[mod];
        if (c.sensacao) {
          const v = SERIE.sensacao[mod][i];
          g.append("circle").attr("cx", px).attr("cy", y(v)).attr("r", 4).style("fill", cor).style("stroke", "var(--superficie)").style("stroke-width", 2);
          linhas.push({ valor: grauC(v), rotulo: `Sensação térmica · ${MODELOS[mod]} · ${faixa(v).nome}`, cor });
        }
        if (c.temp) {
          const v = SERIE.temp[mod][i], corTemp = CORES_TEMP[mod];
          g.append("circle").attr("cx", px).attr("cy", y(v)).attr("r", 3.5).style("fill", corTemp).style("stroke", "var(--superficie)").style("stroke-width", 2);
          linhas.push({ valor: grauC(v), rotulo: `temperatura · ${MODELOS[mod]}`, cor: corTemp });
        }
      });
      linhas.push({ valor: `${f0(H.umidade[i])}%`, rotulo: `umidade · vento ${f0(H.vento[i])} km/h${H.rajadas ? ` · rajadas ${f0(H.rajadas[i])} km/h` : ""}` });
      return { titulo: rotuloHora(i), linhas };
    });
    TABELAS["graf-calor"] = { colunas: ["Hora", "Sensação, média (ensemble) (°C)", "Faixa de estresse", "Sensação ECMWF/IFS", "Sensação NOAA/GFS", "Temp., média (ensemble) (°C)", "Temp. ECMWF/IFS", "Temp. NOAA/GFS", "Umidade (%)", "Vento (km/h)", "Rajadas (km/h)", "UV (NOAA/GFS)"],
      linhas: T.map((_, i) => [rotuloHora(i), f1(H.sensacao[i]), faixa(H.sensacao[i]).nome, f1(H.sensacao_ecmwf[i]), f1(H.sensacao_gfs[i]),
        f1(H.temp[i]), f1(H.temp_ecmwf[i]), f1(H.temp_gfs[i]), f0(H.umidade[i]), f0(H.vento[i]), H.rajadas ? f0(H.rajadas[i]) : "—", H.uv ? apresentarUV(H.uv[i]) ?? "—" : "—"]) };
  }

  // ------------------------------------------------------------------ gráfico de chuva (os dois modelos, sem média)
  function graficoChuva() {
    trocar($("legenda-chuva"), ...CHUVA.map((s) => botaoSerie(s.nome, el("i", { class: "k-caixa", style: `background:${s.cor}` }), estadoChuva[s.id],
      () => { estadoChuva[s.id] = !estadoChuva[s.id]; desenharGraficos(); })));
    const div = $("graf-chuva"), w = largura(div), h = 190;
    const m = { t: w < 640 ? 50 : 38, r: w < 640 ? 12 : 88, b: 26, l: 38 };
    div.replaceChildren();
    const svg = d3.select(div).append("svg").attr("width", w).attr("height", h).attr("role", "img").attr("aria-label", "Chuva prevista por hora, ECMWF/IFS e NOAA/GFS");
    const x = d3.scaleUtc().domain(dominioX).range([m.l, w - m.r]);
    const max = Math.max(d3.max(H.chuva_ecmwf) || 0, d3.max(H.chuva_gfs) || 0);
    const y = d3.scaleLinear().domain([0, Math.max(1, max * 1.1)]).nice(3).range([h - m.b, m.t]);
    eixoDias(svg, x, m, h, true);
    const eixo = svg.append("g").attr("class", "eixo");
    y.ticks(3).forEach((t) => { linhaH(eixo, m.l, w - m.r, y(t), t === 0 ? "var(--eixo)" : "var(--grade)"); texto(eixo, m.l - 6, y(t), f1(t), { ancora: "end" }); });
    eixoHoras(svg, x, h, m, w);
    const visiveis = CHUVA.filter((s) => estadoChuva[s.id]);
    const passo = x(new Date(+T[0] + UMA_HORA)) - x(T[0]);
    const larg = Math.max(1, Math.min(12, (passo - 2) / Math.max(1, visiveis.length)));
    visiveis.forEach((s, j) => s.dados.forEach((v, i) => {
      if (!(v > 0.05)) return;
      const x0 = x(T[i]) + (passo - larg * visiveis.length) / 2 + j * larg, topo = y(v), base = y(0), r = Math.min(2, larg / 2, base - topo);
      svg.append("path").attr("d", `M${x0},${base}V${topo + r}Q${x0},${topo} ${x0 + r},${topo}H${x0 + larg - r}Q${x0 + larg},${topo} ${x0 + larg},${topo + r}V${base}Z`).style("fill", s.cor);
    }));
    const semChuva = visiveis.every((s) => !(d3.max(s.dados) > 0.05));
    if (semChuva) texto(svg, (m.l + w - m.r) / 2, (m.t + h - m.b) / 2, visiveis.length ? "Sem chuva prevista no período" : "Escolha um modelo acima", { ancora: "middle", cor: "var(--tinta2)", tam: 13 });
    linhaAgora(svg, x, m, h);
    cruz(svg, x, m, w, h, (i) => ({ titulo: rotuloHora(i), linhas: CHUVA.map((s) => ({ valor: `${f1(s.dados[i])} mm`, rotulo: s.nome, cor: s.cor })) }));
    TABELAS["graf-chuva"] = { colunas: ["Hora", "ECMWF/IFS (mm)", "NOAA/GFS (mm)"], linhas: T.map((_, i) => [rotuloHora(i), f1(H.chuva_ecmwf[i]), f1(H.chuva_gfs[i])]) };
  }
  function desenharGraficos() { esconderTip(); graficoCalor(); graficoChuva(); ["graf-calor", "graf-chuva"].forEach(vistaTabela); }

  // ------------------------------------------------------------------ níveis
  function renderNiveis() {
    trocar($("niveis"), ...[1, 2, 3, 4, 5].map((n) => {
      const c = P.niveis[n];
      return el("div", { class: "nivel-linha" },
        el("span", { class: "chip", style: `background:${c.cor_bg};color:${c.cor_fg}` }, `Calor Nível ${n}`),
        el("p", {}, el("strong", {}, "Quando: "), c.quando),
        el("ul", {}, ...c.publico.map((t) => el("li", {}, t))));
    }));
  }

  // ------------------------------------------------------------------ detalhes técnicos (sem PET e sem índice de calor)
  // Escala do protocolo para as tabelas técnicas (frio detalhado abaixo de 12 °C)
  const corBio = (v) => (v >= 48 ? ["#6b21a8", "#fff"] : v >= 38 ? ["#dc2626", "#fff"] : v >= 34 ? ["#ea580c", "#fff"] : v >= 28 ? ["#facc15", "#111"]
    : v >= 12 ? ["#74c476", "#111"] : v >= 6 ? ["#6baed6", "#111"] : v >= 0 ? ["#3182bd", "#fff"] : ["#08519c", "#fff"]);
  const pilula = (v, hora, cor) => { const [bg, fg] = cor(v); return el("span", { class: "pilula", style: `background:${bg};color:${fg}` }, `${f1(v)} °C (${hora})`); };
  const minMax = (x, cor) => el("span", {}, pilula(x.min, x.h_min, cor), " – ", pilula(x.max, x.h_max, cor));
  let modeloTec = "gfs";
  function renderTecnico() {
    trocar($("modelo-tec"), ...[["ecmwf", "ECMWF/IFS"], ["gfs", "NOAA/GFS"]].map(([k, r]) =>
      el("button", { type: "button", "aria-pressed": String(k === modeloTec), onclick: () => { modeloTec = k; renderTecnico(); } }, r)));
    const linhas = [
      ["PoaClima · condição", (d) => d.condicao],
      ["PoaClima · temperatura máx. / mín.", (d) => `${grau(d.temp.max)} / ${grau(d.temp.min)}`],
      ["PoaClima · chuva", (d) => `${f1(d.poaclima.chuva_mm)} mm`],
      ["PoaClima · umidade máx. / mín.", (d) => `${f0(d.poaclima.umidade_max_pct)}% / ${f0(d.poaclima.umidade_min_pct)}%`],
      ["PoaClima · vento / direção", (d) => `${f0(d.poaclima.vento_kmh)} km/h · ${d.poaclima.vento_dir}`],
      ["Condição do modelo selecionado", (d, x) => x.condicao],
      ["Estabilidade do modelo selecionado", (d, x) => el("span", { class: "pilula", style: `background:${x.estabilidade.bg};color:${x.estabilidade.fg}` }, x.estabilidade.texto)],
      ["Sensação térmica (UTCI)", (d, x) => minMax(x.utci, corBio)],
      ["Temperatura do ar", (d, x) => minMax(x.t2m, corBio)],
      ["Chuva NOAA/GFS, centro / máx. vizinhança", (d) => `${f1(d.modelos.gfs.chuva_mm)} / ${f1(d.modelos.gfs.chuva_max_grade_mm)} mm`],
      ["NMEP NOAA/GFS ≥10 / ≥25 / ≥50 mm", (d) => `${pct(d.modelos.gfs.nmep_10)} / ${pct(d.modelos.gfs.nmep_25)} / ${pct(d.modelos.gfs.nmep_50)}`],
      ["Umidade relativa", (d, x) => `${f0(x.ur_min)}–${f0(x.ur_max)}%`],
      ["Vento / rajada", (d, x) => `${f0(x.vento_min)}–${f0(x.vento_max)} km/h ${x.vento_dir} ${x.vento_seta} · ${f0(x.rajada_max)}`],
      ["Índice UV máximo (NOAA/GFS)", (d) => d.uv && apresentarUV(d.uv.max) != null ? `UV ${apresentarUV(d.uv.max)} · ${nivelUV(d.uv.max).nome} (${d.uv.h_max})` : "—"],
      ["Índice UV, céu limpo (NOAA/GFS)", (d) => d.uv && apresentarUV(d.uv.max_ceu_limpo) != null ? `UV ${apresentarUV(d.uv.max_ceu_limpo)} (${d.uv.h_max_ceu_limpo})` : "—"],
      ["Nível do protocolo · média (ensemble)", (d) => el("span", { class: "pilula", style: `background:${d.cor_bg};color:${d.cor_fg}` }, `Calor Nível ${d.nivel}`)],
      ["Gatilho", (d) => d.gatilho],
      ["Janela crítica", (d) => d.janela],
      ["Mínima da madrugada (0h–6h)", (d) => `${f1(d.tmin_noite)} °C`],
      ["Horas com UTCI ≥28 / ≥32 / ≥34 / ≥38", (d) => `${d.horas_utci_28} / ${d.horas_utci_32} / ${d.horas_utci_34} / ${d.horas_utci_38} h`],
    ];
    trocar($("tabela-tec"), el("table", {}, el("thead", {}, el("tr", {}, el("th", { scope: "col" }, ""), ...DIAS.map((d) => el("th", { scope: "col" }, `${d.dia_semana} ${ddmm(d.data)}`)))),
      el("tbody", {}, ...linhas.map(([rot, f]) => el("tr", {}, el("td", {}, rot), ...DIAS.map((d) => el("td", {}, f(d, d.modelos[modeloTec]))))))));
  }

  // ------------------------------------------------------------------ tema, redimensionamento e início
  const raiz = document.documentElement;
  const escuro = () => (raiz.dataset.theme ? raiz.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  const rotularTema = () => { $("tema").textContent = escuro() ? "Tema claro" : "Tema escuro"; };
  try { const t = localStorage.getItem("calor-tema"); if (t === "dark" || t === "light") raiz.dataset.theme = t; } catch (e) { /* sem armazenamento */ }
  rotularTema();
  $("tema").addEventListener("click", () => {
    raiz.dataset.theme = escuro() ? "light" : "dark";
    try { localStorage.setItem("calor-tema", raiz.dataset.theme); } catch (e) { /* sem armazenamento */ }
    rotularTema();
  });

  function renderTudo() { renderAlerta(); renderSensacao(); renderTempo(); renderUV(); renderDias(); desenharGraficos(); }
  let espera, larguraAnterior = document.querySelector("main").clientWidth;
  new ResizeObserver(() => {
    const w = document.querySelector("main").clientWidth;
    if (w === larguraAnterior) return;
    larguraAnterior = w; clearTimeout(espera); espera = setTimeout(desenharGraficos, 150);
  }).observe(document.querySelector("main"));
  renderNiveis(); renderTecnico(); renderTudo();
})();
