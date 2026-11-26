"""Gera os dados do painel público do Protocolo de Calor de Porto Alegre.

Coleta a previsão diária pública do PoaClima/Catavento, as séries ECMWF/IFS e NOAA/GFS via
Open-Meteo e os avisos meteorológicos do INMET para Porto Alegre. O PoaClima alimenta os cartões
de tempo, temperatura, chuva, umidade e vento (com contingência automática pelo consenso Open-Meteo
caso fique indisponível); o Open-Meteo alimenta a sensação térmica, o IBUTG, o índice UV e todos os
gatilhos do protocolo (gatilhos diários + persistência + rampa + acúmulo + rescaldo); e o INMET
alimenta os avisos meteorológicos exibidos abaixo do UV.
Grava:
  docs/dados/previsao.js      lido pela página (window.PREVISAO)
  docs/dados/previsao.json    os mesmos dados, para reutilização
  docs/img/compartilhar.png   cartão 1200x630 de Hoje para prévia em links (og:image)
No GitHub Actions (variável GITHUB_ACTIONS) ou com --carimbar, também carimba a versão nos
endereços de docs/index.html (?v=AAAAMMDDHHMM), incluindo img/compartilhar.png.
Uso: python gerar_painel.py
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont

from calor import inmet, poaclima, previsao, protocolo

AQUI = Path(__file__).resolve().parent
SAIDA = AQUI / "docs" / "dados"
DIAS_SEMANA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]

_MAPA_ICONE = {
    0: "sol", 1: "sol-poucas-nuvens", 2: "sol-poucas-nuvens",
    3: "nublado", 51: "chuvisco", 63: "chuva", 95: "chuva-raios",
}


def limpar(x):
    """Converte para tipos do JSON (NaN vira null)."""
    if isinstance(x, dict):
        return {str(k): limpar(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [limpar(v) for v in x]
    if isinstance(x, (np.floating, float)):
        return None if not math.isfinite(float(x)) else round(float(x), 2)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, np.bool_):
        return bool(x)
    return x


def extremos(dia: pd.DataFrame, coluna: str) -> dict:
    s = dia[coluna].dropna()
    if s.empty:
        return {"min": None, "h_min": None, "max": None, "h_max": None}
    return {"min": s.min(), "h_min": dia.loc[s.idxmin(), "time"].strftime("%H:%M"),
            "max": s.max(), "h_max": dia.loc[s.idxmax(), "time"].strftime("%H:%M")}


def resumo_uv(dia_gfs: pd.DataFrame) -> dict:
    """Máximos diários do UVI já calculado pelo NOAA/GFS, com nuvens e para céu limpo."""
    com_nuvens, ceu_limpo = extremos(dia_gfs, "uv_index"), extremos(dia_gfs, "uv_index_clear_sky")
    return {"max": com_nuvens["max"], "h_max": com_nuvens["h_max"],
            "max_ceu_limpo": ceu_limpo["max"], "h_max_ceu_limpo": ceu_limpo["h_max"]}


def resumo_modelo(dia: pd.DataFrame, nmep: dict | None) -> dict:
    p_cen, p_max = float(dia["precip_center"].sum()), float(dia["precip_grid_max"].sum())
    codigo = protocolo.codigo_representativo(dia["weather_code"], p_cen)
    n = nmep or {10.0: None, 25.0: None, 50.0: None}
    est = protocolo.estabilidade(p_cen, p_max, codigo, n[10.0] or 0.0, n[25.0] or 0.0, n[50.0] or 0.0)
    seta, direcao = protocolo.vento_predominante(dia["wind_kmh"], dia["wind_dir"])
    return {
        "codigo": codigo, "condicao": protocolo.DESCRICAO_CODIGO[codigo], "estabilidade": est,
        "chuva_mm": p_cen, "chuva_max_grade_mm": p_max, "nmep_10": n[10.0], "nmep_25": n[25.0], "nmep_50": n[50.0],
        "ur_min": dia["rh2m"].min(), "ur_max": dia["rh2m"].max(),
        "vento_min": dia["wind_kmh"].min(), "vento_max": dia["wind_kmh"].max(), "rajada_max": dia["wind_gust_kmh"].max(),
        "vento_dir": direcao, "vento_seta": seta,
        "t2m": extremos(dia, "t2m"), "utci": extremos(dia, "utci"), "ibutg": extremos(dia, "wbgt"),
    }


def _carregar_fonte(tamanho: int, negrito: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidatas = (
        [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        ]
        if negrito
        else [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "C:/Windows/Fonts/arial.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        ]
    )
    for caminho in candidatas:
        if Path(caminho).exists():
            return ImageFont.truetype(caminho, tamanho)
    return ImageFont.load_default(size=tamanho)


def _quebrar_linhas(draw: ImageDraw.ImageDraw, texto: str,
                    fonte: ImageFont.ImageFont, largura_max: int,
                    max_linhas: int = 2) -> list[str]:
    linhas, atual = [], ""
    for palavra in str(texto).split():
        teste = f"{atual} {palavra}".strip()
        if draw.textlength(teste, font=fonte) <= largura_max or not atual:
            atual = teste
        else:
            linhas.append(atual)
            if len(linhas) >= max_linhas:
                linhas[-1] = linhas[-1].rstrip(".,;:") + "…"
                return linhas
            atual = palavra
    if atual:
        linhas.append(atual)
    return linhas[:max_linhas]


def gerar_imagem_compartilhar(dia_hoje: dict, horario: dict, agora: datetime) -> None:
    """Gera docs/img/compartilhar.png (1200x630) com o alerta de Hoje (saida_dias[0])."""
    LARGURA, ALTURA = 1200, 630
    bg = dia_hoje["cor_bg"]
    fg = dia_hoje["cor_fg"]

    img = Image.new("RGBA", (LARGURA, ALTURA), bg)
    draw = ImageDraw.Draw(img)

    f_cab = _carregar_fonte(23, negrito=True)
    f_data = _carregar_fonte(23, negrito=False)
    f_selo = _carregar_fonte(50, negrito=True)
    f_motivo = _carregar_fonte(27, negrito=True)
    f_info = _carregar_fonte(23, negrito=True)
    f_sec = _carregar_fonte(22, negrito=True)
    f_item = _carregar_fonte(20, negrito=False)
    f_rodape = _carregar_fonte(18, negrito=False)

    # Cabeçalho
    data_br = datetime.fromisoformat(dia_hoje["data"]).strftime("%d/%m/%Y")
    draw.text((60, 34), "PAINEL DE CALOR DE PORTO ALEGRE", fill=fg, font=f_cab)
    draw.text((1140, 34), f"Hoje, {data_br}", fill=fg, font=f_data, anchor="ra")

    # Selo CALOR NÍVEL X
    selo_txt = f"CALOR NÍVEL {dia_hoje['nivel']}"
    larg_selo = draw.textlength(selo_txt, font=f_selo) + 96
    x0_selo = (LARGURA - larg_selo) / 2
    draw.rounded_rectangle([x0_selo, 76, x0_selo + larg_selo, 174], radius=49, fill=fg)
    draw.text((600, 125), selo_txt, fill=bg, font=f_selo, anchor="mm")

    # Motivo centralizado
    y = 194
    for linha in _quebrar_linhas(draw, dia_hoje["motivo"], f_motivo, 1080, max_linhas=2):
        draw.text((600, y), linha, fill=fg, font=f_motivo, anchor="ma")
        y += 34

    # Sensação térmica atual (última hora fechada <= agora)
    agora_str = agora.strftime("%Y-%m-%dT%H:%M")
    utci_atual = hora_atual = None
    for t_str, val in zip(horario["tempo"], horario["sensacao"]):
        if t_str.startswith(dia_hoje["data"]) and t_str <= agora_str and val is not None:
            utci_atual, hora_atual = float(val), t_str[11:16]

    janela = (
        f"{dia_hoje['janela_ini']}h às {dia_hoje['janela_fim']}h"
        if dia_hoje.get("janela_ini") is not None
        else "sem janela crítica ativa"
    )
    utci_max = dia_hoje["sensacao"].get("max")
    h_max = dia_hoje["sensacao"].get("h_max") or "—"
    max_str = f"{round(utci_max)} °C" if utci_max is not None else "—"

    sens_txt = (
        f"Sensação térmica ({hora_atual}): {round(utci_atual)} °C"
        if utci_atual is not None
        else f"Sensação térmica máxima: {max_str}"
    )
    uv_raw = (dia_hoje.get("uv") or {}).get("max")
    uv_int = protocolo.apresentar_indice_uv(uv_raw)
    uv_niv = protocolo.nivel_indice_uv(uv_raw)
    uv_txt = (
        f"UV máx.: {uv_int} · {uv_niv['nome']}"
        if uv_int is not None and uv_niv is not None
        else "UV máx.: indisponível nesta atualização"
    )
    max_txt = f"Máxima do dia: {max_str} às {h_max}"
    linhas_info = [f"Horário mais crítico: {janela}", sens_txt, uv_txt, max_txt]

    # Quadro translúcido central
    quadro_topo = y + 10
    altura_quadro = 172
    overlay = Image.new("RGBA", (LARGURA, ALTURA), (0, 0, 0, 0))
    d_over = ImageDraw.Draw(overlay)
    d_over.rounded_rectangle(
        [50, quadro_topo, 1150, quadro_topo + altura_quadro],
        radius=16,
        fill=(255, 255, 255, 118),
    )
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)

    for idx_l, texto_l in enumerate(linhas_info):
        cy = quadro_topo + 32 + idx_l * 36
        draw.ellipse([72, cy - 6, 84, cy + 6], fill=fg)
        draw.text((98, cy), texto_l, fill=fg, font=f_info, anchor="lm")

    # Recomendações
    y = quadro_topo + altura_quadro + 18
    titulo_rec = "O que fazer" if dia_hoje["nivel"] > 1 else "Recomendações"
    draw.text((60, y), titulo_rec, fill=fg, font=f_sec)
    y += 30
    for rec in dia_hoje.get("publico", [])[:2]:
        for j, linha in enumerate(_quebrar_linhas(draw, f"• {rec}", f_item, 1080, max_linhas=2)):
            txt = linha if j == 0 else f"  {linha}"
            draw.text((60, y), txt, fill=fg, font=f_item)
            y += 26
        y += 3

    draw.text(
        (1140, 608),
        "ciscpoa.github.io/Painel_Sensacao_Termica_POA/",
        fill=fg,
        font=f_rodape,
        anchor="rs",
    )

    destino = AQUI / "docs" / "img" / "compartilhar.png"
    destino.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(destino, format="PNG", optimize=True)
    print(f"Imagem de compartilhamento salva em: {destino}")


def carimbar_versao(versao: str) -> None:
    """Troca ?v=... nos endereços de app.js, dados/previsao.js, lib/d3.min.js e img/compartilhar.png do index.html."""
    pagina = AQUI / "docs" / "index.html"
    html = pagina.read_text(encoding="utf-8")
    novo, n = re.subn(
        r'((?:app\.js|dados/previsao\.js|lib/d3\.min\.js|img/compartilhar\.png)\?v=)[^"]*"',
        rf'\g<1>{versao}"',
        html,
    )
    pagina.write_text(novo, encoding="utf-8")
    print(f"versão {versao} carimbada em {n} endereços de docs/index.html")


def main() -> None:
    om = previsao.cliente(str(AQUI / ".cache_openmeteo"))
    pontos, centro = previsao.pontos_vizinhanca()
    print(f"Vizinhança: {len(pontos)} pontos num raio de {previsao.RAIO_KM:.0f} km")
    det = previsao.baixar_deterministico(om, pontos)
    print("Calculando índices (UTCI e IBUTG)...")
    ec, gf = previsao.processar_modelo(det["ecmwf"], centro), previsao.processar_modelo(det["gfs"], centro)
    if not ec["time"].equals(gf["time"]):
        raise SystemExit("os horários do ECMWF/IFS e do NOAA/GFS não coincidem")

    mme = pd.DataFrame({"time": ec["time"]})
    for nome, col in [("T2M", "t2m"), ("UTCI", "utci"), ("WBGT", "wbgt")]:
        mme[f"{nome}_MME"] = (ec[col] + gf[col]) / 2.0
    for df in (ec, gf, mme):
        df["date"] = df["time"].dt.date
    agora = datetime.now(ZoneInfo(previsao.FUSO))
    todos_dias = list(dict.fromkeys(ec["date"]))          # inclui os dias anteriores (contexto das regras)
    dias = [d for d in todos_dias if d >= agora.date()]  # o painel mostra de hoje em diante

    print("Coletando a previsão diária do PoaClima/Catavento...")
    try:
        clima_poa = poaclima.coletar_previsao(hoje=agora.date())
        poa_por_data = {x["data"]: x for x in clima_poa["dias"]}
        poaclima_ok = True
    except Exception as erro:
        print(f"Aviso: PoaClima indisponível ({erro}); usando consenso Open-Meteo como contingência.", file=sys.stderr)
        clima_poa = {"atualizado_em": None, "coletado_em": agora.isoformat(timespec="minutes"), "dias": []}
        poa_por_data = {}
        poaclima_ok = False

    try:
        cubos = previsao.baixar_ensemble(om, pontos)
        nmep = {k: previsao.nmep_diario(c["cubo"], c["datas"], dias) for k, c in cubos.items()}
        ensemble_ok = True
    except Exception as erro:  # o painel sai sem as probabilidades
        print(f"Aviso: ensemble indisponível ({erro})", file=sys.stderr)
        nmep, ensemble_ok = {"ecmwf": {}, "gfs": {}}, False

    print("Coletando avisos meteorológicos do INMET para Porto Alegre...")
    try:
        avisos_inmet = inmet.coletar_alertas_inmet()
    except Exception as erro:  # falha do INMET não derruba a geração do painel de calor
        print(f"Aviso: coleta do INMET indisponível ({erro})", file=sys.stderr)
        avisos_inmet = {
            "alertas": [],
            "alertas_futuros": [],
            "max_severidade": None,
            "fonte": "api",
            "consultado": False,
        }

    diag_todos = protocolo.aplicar_regras_multidiarias([protocolo.avaliar_dia(mme[mme["date"] == d]) for d in todos_dias])
    anteriores = [{"data": d.isoformat(), "nivel": x["nivel"], "gatilho": x["gatilho"]}
                  for d, x in zip(todos_dias, diag_todos) if d < agora.date()]
    diagnosticos = [x for d, x in zip(todos_dias, diag_todos) if d >= agora.date()]

    saida_dias = []
    for d, diag in zip(dias, diagnosticos):
        dia_ec, dia_gf, dia_m = ec[ec["date"] == d], gf[gf["date"] == d], mme[mme["date"] == d]
        r_ec, r_gf = resumo_modelo(dia_ec, nmep["ecmwf"].get(d)), resumo_modelo(dia_gf, nmep["gfs"].get(d))
        seta, direcao = protocolo.vento_predominante(pd.concat([dia_ec["wind_kmh"], dia_gf["wind_kmh"]]),
                                                     pd.concat([dia_ec["wind_dir"], dia_gf["wind_dir"]]))
        nivel = diag["nivel"]
        poa = poa_por_data.get(d.isoformat())
        t_mme = extremos(dia_m, "T2M_MME")

        if poa is not None:
            fonte_tempo = "PoaClima · Catavento"
        else:
            print(f"Aviso: dia {d.isoformat()} sem dados do PoaClima; aplicando contingência Open-Meteo.", file=sys.stderr)
            cod = r_gf["codigo"]
            poa = {
                "data": d.isoformat(),
                "temp_min_c": t_mme["min"],
                "temp_max_c": t_mme["max"],
                "chuva_mm": round((r_ec["chuva_mm"] + r_gf["chuva_mm"]) / 2.0, 1),
                "umidade_min_pct": round((r_ec["ur_min"] + r_gf["ur_min"]) / 2.0),
                "umidade_max_pct": round((r_ec["ur_max"] + r_gf["ur_max"]) / 2.0),
                "vento_kmh": round((r_ec["vento_max"] + r_gf["vento_max"]) / 2.0),
                "vento_dir": direcao,
                "clima": r_gf["condicao"],
                "icone": _MAPA_ICONE.get(cod, "nublado"),
                "condicao": r_gf["condicao"],
            }
            fonte_tempo = "ECMWF/IFS + NOAA/GFS (PoaClima indisponível)"

        saida_dias.append({
            "data": d.isoformat(), "dia_semana": DIAS_SEMANA[d.weekday()],
            "nivel": nivel, **{k: protocolo.NIVEIS[nivel][k] for k in ("nome", "cor_fg", "cor_bg", "acao", "publico")},
            "motivo": diag["motivo"], "gatilho": diag["gatilho"], "janela": diag["janela"],
            "janela_ini": diag["janela_ini"], "janela_fim": diag["janela_fim"],
            "tmin_noite": diag["tmin_noite"], "noite_quente": diag["noite_quente"], "noite_fresca": diag["recuperacao_plena"],
            "pico_ibutg": diag["pico_ibutg"],
            "horas_utci_28": diag["horas_n2"], "horas_utci_32": diag["horas_32"], "horas_utci_34": diag["horas_n3"],
            "horas_utci_38": diag["horas_n4"], "horas_utci_48": diag["horas_n5"],
            # Previsão pública diária: PoaClima (ou contingência Open-Meteo). Os extremos do
            # consenso ficam separados para rastreabilidade e não alteram nenhum gatilho.
            "temp": {"min": poa["temp_min_c"], "h_min": None, "max": poa["temp_max_c"], "h_max": None},
            "temp_openmeteo": t_mme,
            "sensacao": extremos(dia_m, "UTCI_MME"), "uv": resumo_uv(dia_gf),
            "clima": poa["clima"], "icone": poa["icone"], "condicao": poa["condicao"],
            "tempo": fonte_tempo,
            "vento_max": poa["vento_kmh"], "vento_dir": poa["vento_dir"],
            "vento_openmeteo": {"max": max(r_ec["vento_max"], r_gf["vento_max"]),
                                "rajada_max": max(r_ec["rajada_max"], r_gf["rajada_max"]),
                                "dir": direcao, "seta": seta},
            "poaclima": poa,
            "modelos": {"ecmwf": r_ec, "gfs": r_gf},
        })

    f = (ec["date"] >= agora.date()).to_numpy()
    horario = {
        "tempo": [t.strftime("%Y-%m-%dT%H:%M") for t in ec["time"][f]],
        "temp": mme["T2M_MME"].to_numpy()[f], "sensacao": mme["UTCI_MME"].to_numpy()[f],
        "sensacao_ecmwf": ec["utci"].to_numpy()[f], "sensacao_gfs": gf["utci"].to_numpy()[f],
        "temp_ecmwf": ec["t2m"].to_numpy()[f], "temp_gfs": gf["t2m"].to_numpy()[f],
        "chuva_ecmwf": ec["precip_center"].to_numpy()[f], "chuva_gfs": gf["precip_center"].to_numpy()[f],
        "umidade": ((ec["rh2m"] + gf["rh2m"]) / 2.0).to_numpy()[f],
        "vento": ((ec["wind_kmh"] + gf["wind_kmh"]) / 2.0).to_numpy()[f],
        "rajadas": ((ec["wind_gust_kmh"] + gf["wind_gust_kmh"]) / 2.0).to_numpy()[f],
        "ibutg": mme["WBGT_MME"].to_numpy()[f],
        "uv": gf["uv_index"].to_numpy()[f], "uv_ceu_limpo": gf["uv_index_clear_sky"].to_numpy()[f],
    }
    dados = limpar({
        "gerado_em": agora.isoformat(timespec="minutes"), "local": "Porto Alegre (RS)",
        "centro": [previsao.LAT_CENTRAL, previsao.LON_CENTRAL], "raio_km": previsao.RAIO_KM, "pontos": len(pontos),
        "ensemble": ensemble_ok, "niveis": protocolo.NIVEIS, "niveis_uv": protocolo.NIVEIS_UV,
        "fontes": {
            "previsao_diaria": poaclima.FONTE if poaclima_ok else "ECMWF/IFS e NOAA/GFS (contingência)",
            "sensacao_alertas_e_series": "ECMWF/IFS e NOAA/GFS, via Open-Meteo",
            "uv": "NOAA/GFS, via Open-Meteo",
            "avisos_meteorologicos": "INMET (apiprevmet3.inmet.gov.br)",
        },
        "poaclima": {"url": poaclima.URL_PAINEL, "atualizado_em": clima_poa["atualizado_em"],
                     "coletado_em": clima_poa["coletado_em"], "disponivel": poaclima_ok},
        "inmet": avisos_inmet,
        "uv_fonte": "NOAA/GFS, via Open-Meteo", "dias": saida_dias, "dias_anteriores": anteriores,
        "horario": {k: list(v) for k, v in horario.items()},
    })
    SAIDA.mkdir(parents=True, exist_ok=True)
    texto = json.dumps(dados, ensure_ascii=False, separators=(",", ":"))
    (SAIDA / "previsao.json").write_text(texto, encoding="utf-8")
    (SAIDA / "previsao.js").write_text(f"window.PREVISAO={texto};\n", encoding="utf-8")

    if dados["dias"]:
        try:
            gerar_imagem_compartilhar(dados["dias"][0], dados["horario"], agora)
        except Exception as erro:
            print(f"Aviso: falha ao gerar imagem de compartilhamento ({erro})", file=sys.stderr)

    if os.environ.get("GITHUB_ACTIONS") or "--carimbar" in sys.argv:
        carimbar_versao(agora.strftime("%Y%m%d%H%M"))

    print(f"\nPrevisão gerada em {agora:%d/%m/%Y %H:%M} (ensemble: {'sim' if ensemble_ok else 'não'})")
    if avisos_inmet.get("consultado"):
        print(f"  INMET: {len(avisos_inmet.get('alertas', []))} aviso(s) hoje "
              f"(máx: {avisos_inmet.get('max_severidade') or 'nenhum'})")
    else:
        print("  INMET: indisponível nesta atualização")
    for x in anteriores:
        print(f"  (anterior) {x['data']}  N{x['nivel']}  | {x['gatilho']}")
    for x in saida_dias:
        tmax = f"{x['temp']['max']:4.1f}" if x["temp"]["max"] is not None else "  — "
        ch_poa = f"{x['poaclima']['chuva_mm']:4.1f}" if x["poaclima"]["chuva_mm"] is not None else "  — "
        print(f"  {x['dia_semana']:<8} {x['data']}  N{x['nivel']} {x['nome']:<11} Tmáx PoaClima {tmax}  "
              f"sensação máx {x['sensacao']['max']:4.1f}  chuva PoaClima {ch_poa} mm  | {x['gatilho']}")


if __name__ == "__main__":
    main()
