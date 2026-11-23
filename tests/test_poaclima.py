"""Testes da coleta e da validação da previsão diária do PoaClima."""
from datetime import date

import pytest

from calor import poaclima


def resposta_valida():
    return {
        "last_updated_forecast": "2026-11-23T10:14:34.985Z",
        "previsions": [
            {
                "prevision_date": "2026-11-23", "climate": "sun_few_clouds", "show_forecast": True,
                "rain_quantity": 0, "max_temperature": 29, "min_temperature": 19,
                "max_humidity": 99, "min_humidity": 49, "wind_speed": 45, "wind_direction": "L",
            },
            {
                "prevision_date": "2026-11-24", "climate": "isolated_storms", "show_forecast": True,
                "rain_quantity": 10, "max_temperature": 29, "min_temperature": 20,
                "max_humidity": 97, "min_humidity": 62, "wind_speed": 40, "wind_direction": "SE",
            },
        ],
    }


def test_normaliza_rotulos_e_campos_do_poaclima():
    dados = poaclima.normalizar_resposta(resposta_valida(), hoje=date(2026, 11, 23))
    assert dados["atualizado_em"] == "2026-11-23T10:14:34.985Z"
    assert [d["data"] for d in dados["dias"]] == ["2026-11-23", "2026-11-24"]
    assert dados["dias"][0]["condicao"] == "Sol entre poucas nuvens"
    assert dados["dias"][0]["icone"] == "sol-poucas-nuvens"
    assert dados["dias"][1]["condicao"] == "Pancadas de chuva isoladas"
    assert dados["dias"][1]["chuva_mm"] == 10
    assert dados["dias"][1]["vento_dir"] == "SE"


def test_descarta_dia_anterior_e_mantem_previsao_vigente():
    dados = poaclima.normalizar_resposta(resposta_valida(), hoje=date(2026, 11, 24))
    assert [d["data"] for d in dados["dias"]] == ["2026-11-24"]


def test_sem_dias_vigentes_interrompe_em_vez_de_inventar_dados():
    payload = resposta_valida()
    payload["previsions"][1]["show_forecast"] = False
    with pytest.raises(ValueError, match="nenhum dia vigente"):
        poaclima.normalizar_resposta(payload, hoje=date(2026, 11, 24))


def test_rejeita_condicao_desconhecida_e_data_duplicada():
    payload = resposta_valida()
    payload["previsions"][0]["climate"] = "condicao_nova_sem_rotulo"
    with pytest.raises(ValueError, match="condição do tempo desconhecida"):
        poaclima.normalizar_resposta(payload)
    payload = resposta_valida()
    payload["previsions"][1]["prevision_date"] = payload["previsions"][0]["prevision_date"]
    with pytest.raises(ValueError, match="duplicada"):
        poaclima.normalizar_resposta(payload)


def test_rejeita_valores_inconsistentes():
    payload = resposta_valida()
    payload["previsions"][0]["min_temperature"] = 35
    with pytest.raises(ValueError, match="mínima maior que a máxima"):
        poaclima.normalizar_resposta(payload)
    payload = resposta_valida()
    payload["previsions"][0]["rain_quantity"] = None
    with pytest.raises(ValueError, match="chuva ausente"):
        poaclima.normalizar_resposta(payload)


class RespostaFalsa:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class SessaoFalsa:
    def __init__(self, payload):
        self.payload = payload
        self.chamadas = []

    def get(self, url, **kwargs):
        self.chamadas.append((url, kwargs))
        return RespostaFalsa(self.payload)


def test_coleta_usa_fuso_e_conserva_metadados_da_fonte():
    sessao = SessaoFalsa(resposta_valida())
    dados = poaclima.coletar_previsao(hoje=date(2026, 11, 23), session=sessao)
    assert dados["fonte"] == poaclima.FONTE
    assert dados["url"] == poaclima.URL_PAINEL
    assert dados["atualizado_em"] == resposta_valida()["last_updated_forecast"]
    assert len(dados["dias"]) == 2
    _, kwargs = sessao.chamadas[0]
    assert kwargs["headers"]["x-timezone"] == "America/Sao_Paulo"
