"""Coleta e validação da previsão diária exibida pelo PoaClima.

O endereço público https://prefeitura.poa.br/poaclima/ contém um iframe da
Helper Tecnologia. A aba "Previsão do tempo" desse aplicativo consulta o
endpoint JSON abaixo, com dados fornecidos pela Catavento Meteorologia.
A coleta reproduz essa chamada pública no GitHub Actions, sem navegador,
Selenium ou requisição do navegador de quem abre o painel.

Somente os campos públicos da previsão diária vêm desta fonte. A UTCI, o
IBUTG, a madrugada e todos os gatilhos do protocolo continuam no Open-Meteo.
"""
from __future__ import annotations

import math
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo

import requests

URL_PAINEL = "https://prefeitura.poa.br/poaclima/"
URL_APLICATIVO = "https://clima.helpertecnologia.com.br/poadc"
URL_API = "https://api.helpertecnologia.com.br/defesa-civil/bff/climate/previsions/poadc"
FUSO = "America/Sao_Paulo"
FONTE = "PoaClima / Catavento Meteorologia"

# Rótulos idênticos aos apresentados pelo próprio PoaClima. O segundo valor
# identifica o desenho usado pelo painel, sem depender de emojis do sistema.
CONDICOES = {
    "rain_thunder": ("Chuva e raios", "chuva-raios"),
    "rain_sun": ("Chuva e sol", "sol-chuva"),
    "rain": ("Chuva", "chuva"),
    "scattered_rain_thunder_sun": ("Chuvas esparsas com raios e sol", "sol-chuva-raios"),
    "scattered_rain_sun": ("Chuvas esparsas e sol", "sol-chuva"),
    "isolated_rain_sun": ("Chuvas isoladas e sol", "sol-chuva"),
    "drizzle": ("Chuviscos", "chuvisco"),
    "overcast_rain": ("Encoberto e chuva", "chuva"),
    "overcast_drizzle": ("Encoberto e chuviscos", "chuvisco"),
    "overcast": ("Encoberto", "nublado"),
    "sunny": ("Ensolarado", "sol"),
    "frost": ("Geada", "geada"),
    "fog": ("Nevoeiro", "nevoeiro"),
    "sun_after_storm": ("Sol após a tempestade", "sol-chuva-raios"),
    "sun_many_clouds": ("Sol entre muitas nuvens", "sol-nuvens"),
    "sun_clouds": ("Sol entre nuvens", "sol-nuvens"),
    "sun_few_clouds": ("Sol entre poucas nuvens", "sol-poucas-nuvens"),
    "storm_after_sun": ("Pancadas de chuva após o sol", "sol-chuva"),
    "isolated_storms": ("Pancadas de chuva isoladas", "sol-chuva"),
}


def _numero(valor, campo: str, minimo: float, maximo: float) -> float:
    if isinstance(valor, bool) or valor is None:
        raise ValueError(f"PoaClima: {campo} ausente")
    try:
        numero = float(valor)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"PoaClima: {campo} não é numérico: {valor!r}") from exc
    if not math.isfinite(numero) or not minimo <= numero <= maximo:
        raise ValueError(f"PoaClima: {campo} fora da faixa esperada: {valor!r}")
    return numero


def normalizar_resposta(payload: dict, hoje: date | None = None) -> dict:
    """Valida o JSON e devolve somente dias presentes e campos utilizados.

    Erros de esquema interrompem a geração. Assim, o Actions conserva a
    publicação anterior em vez de apresentar silenciosamente outra fonte ou
    valores inventados como se fossem do PoaClima.
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("previsions"), list):
        raise ValueError("PoaClima: resposta sem a lista 'previsions'")

    dias = []
    datas_vistas = set()
    for bruto in payload["previsions"]:
        if not isinstance(bruto, dict) or bruto.get("show_forecast") is not True:
            continue
        try:
            data = date.fromisoformat(str(bruto["prevision_date"])[:10])
        except (KeyError, ValueError) as exc:
            raise ValueError(f"PoaClima: data inválida em {bruto!r}") from exc
        if hoje is not None and data < hoje:
            continue
        if data in datas_vistas:
            raise ValueError(f"PoaClima: previsão duplicada para {data.isoformat()}")

        clima = str(bruto.get("climate") or "")
        if clima not in CONDICOES:
            raise ValueError(f"PoaClima: condição do tempo desconhecida: {clima!r}")
        condicao, icone = CONDICOES[clima]
        direcao = str(bruto.get("wind_direction") or "").strip().upper()
        if not direcao or len(direcao) > 4:
            raise ValueError(f"PoaClima: direção do vento inválida: {direcao!r}")

        dia = {
            "data": data.isoformat(),
            "clima": clima,
            "condicao": condicao,
            "icone": icone,
            "chuva_mm": _numero(bruto.get("rain_quantity"), "chuva", 0.0, 1000.0),
            "temp_max_c": _numero(bruto.get("max_temperature"), "temperatura máxima", -80.0, 70.0),
            "temp_min_c": _numero(bruto.get("min_temperature"), "temperatura mínima", -80.0, 70.0),
            "umidade_max_pct": _numero(bruto.get("max_humidity"), "umidade máxima", 0.0, 100.0),
            "umidade_min_pct": _numero(bruto.get("min_humidity"), "umidade mínima", 0.0, 100.0),
            "vento_kmh": _numero(bruto.get("wind_speed"), "vento", 0.0, 500.0),
            "vento_dir": direcao,
        }
        if dia["temp_min_c"] > dia["temp_max_c"]:
            raise ValueError(f"PoaClima: mínima maior que a máxima em {data.isoformat()}")
        if dia["umidade_min_pct"] > dia["umidade_max_pct"]:
            raise ValueError(f"PoaClima: umidade mínima maior que a máxima em {data.isoformat()}")
        datas_vistas.add(data)
        dias.append(dia)

    dias.sort(key=lambda item: item["data"])
    if not dias:
        raise ValueError("PoaClima: nenhum dia vigente com 'show_forecast' verdadeiro")
    return {"atualizado_em": payload.get("last_updated_forecast"), "dias": dias}


def coletar_previsao(hoje: date | None = None, tentativas: int = 3, timeout: int = 30,
                     session: requests.Session | None = None) -> dict:
    """Baixa a previsão com tentativas independentes e cabeçalho de fuso."""
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "Origin": "https://clima.helpertecnologia.com.br",
        "Referer": URL_APLICATIVO,
        "x-timezone": FUSO,
        "User-Agent": "CISC-Painel-Calor/1.0 (+https://ciscpoa.github.io/protocolo_de_calor_Porto_Alegre/)",
    }
    cliente = session or requests.Session()
    ultimo_erro = None
    try:
        for tentativa in range(1, tentativas + 1):
            try:
                resposta = cliente.get(URL_API, headers=headers, timeout=timeout)
                resposta.raise_for_status()
                normalizado = normalizar_resposta(resposta.json(), hoje=hoje)
                return {
                    "fonte": FONTE,
                    "url": URL_PAINEL,
                    "atualizado_em": normalizado["atualizado_em"],
                    "coletado_em": datetime.now(ZoneInfo(FUSO)).isoformat(timespec="seconds"),
                    "dias": normalizado["dias"],
                }
            except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
                ultimo_erro = exc
                print(f"[PoaClima] tentativa {tentativa}/{tentativas} falhou: {exc}")
                if tentativa < tentativas:
                    time.sleep(2 * tentativa)
    finally:
        if session is None:
            cliente.close()
    raise RuntimeError(f"PoaClima indisponível após {tentativas} tentativas: {ultimo_erro}")


if __name__ == "__main__":
    import json

    agora = datetime.now(ZoneInfo(FUSO)).date()
    print(json.dumps(coletar_previsao(hoje=agora), ensure_ascii=False, indent=2))
