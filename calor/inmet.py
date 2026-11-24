"""Coleta de avisos meteorológicos do INMET para Porto Alegre.

Adaptado para o runner enxuto do painel (sem Selenium ou módulos externos):
- Consulta a API pública do INMET (apiprevmet3.inmet.gov.br), achatando qualquer
  formato de envelope JSON ({hoje, futuro} ou lista).
- Recorte geográfico em 3 níveis para Porto Alegre:
  1. código IBGE 4314902;
  2. nome da mesorregião ("Metropolitana de Porto Alegre") ou "Porto Alegre - RS";
  3. teste ponto-em-polígono (ray casting) no centro da cidade.
- Distingue explicitamente falha de coleta (consultado=False) de ausência real
  de avisos (consultado=True, alertas=[]).
"""
from __future__ import annotations

from contextlib import contextmanager
import datetime as dt
import json
import re
import socket
import time
from zoneinfo import ZoneInfo

import requests
import urllib3.util.connection as urllib3_cn

_FUSO_POA = ZoneInfo("America/Sao_Paulo")
_ORDEM_SEVERIDADE = {"Amarelo": 1, "Laranja": 2, "Vermelho": 3}

_POA_LAT, _POA_LON = -30.0346, -51.2177
_IBGE_POA = "4314902"

_TERMOS_POA = (
    _IBGE_POA,
    "metropolitana de porto alegre",
    "porto alegre - rs",
    "porto alegre-rs",
    "porto alegre/rs",
    "porto alegre (rs)",
)

_MAPA_SEVERIDADE = {
    "perigo potencial": "Amarelo", "perigo": "Laranja", "grande perigo": "Vermelho",
    "amarelo": "Amarelo", "laranja": "Laranja", "vermelho": "Vermelho",
    "minor": "Amarelo", "moderate": "Amarelo",
    "severe": "Laranja", "extreme": "Vermelho",
}

_URLS_API = (
    "https://apiprevmet3.inmet.gov.br/avisos/ativos",
    "https://apiprevmet3.inmet.gov.br/avisos",
)

_CABECALHOS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://avisos.inmet.gov.br/",
}

_CAMPOS_INICIO = (
    "data_inicio", "dt_inicio", "data_hora_inicio", "inicio",
    "onset", "effective", "start", "data_inicial",
)
_CAMPOS_FIM = (
    "data_fim", "dt_fim", "data_hora_fim", "fim",
    "expires", "end", "data_final",
)
_CAMPOS_HORA = {
    "inicio": ("hora_inicio", "hr_inicio"),
    "fim": ("hora_fim", "hr_fim"),
}


@contextmanager
def _apenas_ipv4():
    """Força resolução IPv4 apenas durante a consulta ao INMET."""
    orig = urllib3_cn.allowed_gai_family
    urllib3_cn.allowed_gai_family = lambda: socket.AF_INET
    try:
        yield
    finally:
        urllib3_cn.allowed_gai_family = orig


def _quando(av: dict, campos: tuple, ponta: str = "inicio") -> tuple[str | None, dt.datetime | None]:
    formatos = (
        "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y",
    )
    quando = None
    for campo in campos:
        bruto = av.get(campo)
        if bruto in (None, "", "null"):
            continue
        txt = str(bruto).strip()
        for fmt in formatos:
            try:
                quando = dt.datetime.strptime(txt, fmt)
                break
            except ValueError:
                continue
        if quando is not None:
            break
    if quando is None:
        return None, None

    for campo_hora in _CAMPOS_HORA.get(ponta, ()):
        h = str(av.get(campo_hora) or "").strip()
        m = re.match(r"^(\d{1,2})[:h](\d{2})", h)
        if m:
            quando = quando.replace(hour=int(m.group(1)), minute=int(m.group(2)))
            break

    return quando.strftime("%Y-%m-%d %H:%M"), quando


def _vigente_hoje(inicio: dt.datetime | None, fim: dt.datetime | None) -> bool:
    if inicio is None and fim is None:
        return True
    hoje = dt.datetime.now(_FUSO_POA).date()
    abre = dt.datetime.combine(hoje, dt.time.min)
    fecha = dt.datetime.combine(hoje, dt.time.max)
    if inicio is not None and inicio > fecha:
        return False
    if fim is not None and fim < abre:
        return False
    return True


def _achatar_avisos(obj) -> list[dict]:
    marcas = ("descricao", "severidade", "aviso_cor", "id_aviso", "data_inicio", "descricao_aviso")
    achados, pilha, visto = [], [obj], 0
    while pilha and visto < 20000:
        item = pilha.pop()
        visto += 1
        if isinstance(item, dict):
            if any(k in item for k in marcas):
                achados.append(item)
            else:
                pilha.extend(item.values())
        elif isinstance(item, (list, tuple)):
            pilha.extend(item)
    return achados


def _severidade(av: dict) -> str:
    for campo in ("aviso_cor", "severidade", "severity", "grau", "nivel"):
        bruto = str(av.get(campo) or "").strip().lower()
        if not bruto:
            continue
        if bruto in _MAPA_SEVERIDADE:
            return _MAPA_SEVERIDADE[bruto]
        for chave, cor in _MAPA_SEVERIDADE.items():
            if chave in bruto:
                return cor
    return "Amarelo"


def _pontos_do_poligono(bruto) -> list[tuple[float, float]]:
    numeros = []
    if isinstance(bruto, str):
        numeros = [float(n) for n in re.findall(r"-?\d+\.\d+", bruto)]
    elif isinstance(bruto, (list, tuple)):
        pilha = [bruto]
        while pilha:
            it = pilha.pop(0)
            if isinstance(it, (list, tuple)):
                pilha[0:0] = list(it)
            elif isinstance(it, (int, float)):
                numeros.append(float(it))
    if len(numeros) < 6:
        return []
    pares = list(zip(numeros[0::2], numeros[1::2]))
    primeiros = [p[0] for p in pares]
    if sum(1 for v in primeiros if v < -40) > len(primeiros) * 0.6:
        pares = [(b, a) for a, b in pares]
    return pares


def _ponto_no_poligono(lat: float, lon: float, pares: list[tuple[float, float]]) -> bool:
    dentro, n = False, len(pares)
    if n < 3:
        return False
    for i in range(n):
        y1, x1 = pares[i]
        y2, x2 = pares[(i + 1) % n]
        if (y1 > lat) != (y2 > lat):
            corte = x1 + (lat - y1) * (x2 - x1) / ((y2 - y1) or 1e-12)
            if lon < corte:
                dentro = not dentro
    return dentro


def _abrange_poa(av: dict) -> str | None:
    texto = json.dumps(av, ensure_ascii=False, default=str).lower()
    if _IBGE_POA in texto:
        return "município (IBGE 4314902)"
    for termo in _TERMOS_POA[1:]:
        if termo in texto:
            return "área do aviso"
    for campo in ("poligono", "poligonos", "geometry", "area_poligono", "polygon"):
        pares = _pontos_do_poligono(av.get(campo))
        if pares and _ponto_no_poligono(_POA_LAT, _POA_LON, pares):
            return "polígono do aviso contém Porto Alegre"
    return None


def _texto_util(valor) -> str:
    if not isinstance(valor, str):
        return ""
    v = " ".join(valor.split()).strip()
    if not (30 <= len(v) <= 800):
        return ""
    baixo = v.lower()
    if baixo.startswith(("data:", "http://", "https://", "<svg", "<?xml")) or "base64" in baixo:
        return ""
    if v.count(" ") < 4 or max((len(p) for p in v.split(" ")), default=0) > 30:
        return ""
    letras = sum(1 for c in v if c.isalpha() or c == " ")
    return v if (letras / len(v)) >= 0.7 else ""


def _descricao(av: dict) -> tuple[str, str]:
    tipo = str(
        av.get("descricao_aviso") or av.get("tipo")
        or av.get("evento") or av.get("event") or ""
    ).strip()
    desc = str(av.get("descricao") or av.get("description") or "").strip()
    if not tipo and desc:
        m = re.match(r"aviso de ([^.]+)", desc, flags=re.I)
        tipo = m.group(1).strip() if m else (desc if len(desc) < 60 else "")

    detalhe = ""
    for chave in (
        "riscos", "instrucoes", "descricao", "instrucao",
        "aviso_texto", "texto", "description", "instruction",
        "headline", "observacao",
    ):
        detalhe = _texto_util(av.get(chave))
        if detalhe:
            break
    if not detalhe:
        candidatos = [
            _texto_util(v) for k, v in av.items()
            if k not in ("municipios", "estados")
        ]
        candidatos = [c for c in candidatos if c]
        detalhe = min(candidatos, key=len) if candidatos else ""

    detalhe = re.sub(r"^aviso de [^.]+\.\s*", "", detalhe, flags=re.I).strip()
    return (tipo or "Aviso meteorológico"), detalhe


def _deduplicar(lista: list[dict]) -> list[dict]:
    unicos, chaves = [], set()
    for a in lista:
        chave = (a["severidade"], a["tipo"], a["inicio"], a["fim"])
        if chave not in chaves:
            chaves.add(chave)
            unicos.append(a)
    return sorted(unicos, key=lambda a: _ORDEM_SEVERIDADE.get(a["severidade"], 0), reverse=True)


def coletar_alertas_inmet() -> dict:
    """Coleta avisos do INMET para Porto Alegre via API pública."""
    dados = None
    with _apenas_ipv4():
        for url in _URLS_API:
            for tentativa in (1, 2):
                try:
                    r = requests.get(url, headers=_CABECALHOS, timeout=(8, 20))
                    r.raise_for_status()
                    dados = r.json()
                    break
                except Exception as exc:
                    print(f"[INMET] tentativa {tentativa}/2 em {url} falhou: {str(exc)[:90]}")
                    if tentativa == 1:
                        time.sleep(3)
            if dados is not None:
                break

    if dados is None:
        return {
            "alertas": [],
            "alertas_futuros": [],
            "max_severidade": None,
            "fonte": "api",
            "consultado": False,
        }

    encontrados, futuros = [], []
    for av in _achatar_avisos(dados):
        criterio = _abrange_poa(av)
        if not criterio:
            continue
        tipo, detalhe = _descricao(av)
        txt_ini, dt_ini = _quando(av, _CAMPOS_INICIO, "inicio")
        txt_fim, dt_fim = _quando(av, _CAMPOS_FIM, "fim")
        registro = {
            "severidade": _severidade(av),
            "tipo": tipo,
            "descricao": tipo,
            "detalhe": detalhe,
            "inicio": txt_ini,
            "fim": txt_fim,
            "criterio": criterio,
        }
        if _vigente_hoje(dt_ini, dt_fim):
            encontrados.append(registro)
        else:
            futuros.append(registro)

    unicos = _deduplicar(encontrados)
    futuros_unicos = _deduplicar(futuros)
    max_sev = unicos[0]["severidade"] if unicos else None

    return {
        "alertas": unicos,
        "alertas_futuros": futuros_unicos,
        "max_severidade": max_sev,
        "fonte": "api",
        "consultado": True,
    }
