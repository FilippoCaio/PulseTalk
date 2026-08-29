#!/usr/bin/env python3
"""Rende il template del catalogo e controlla che ne esca un Compose valido.

Non prova che l'app funzioni su TrueNAS: quello lo puo' dire soltanto un
TrueNAS, e sta scritto in `truenas/README.md` fra le cose da verificare a mano.
Prova le tre che si possono provare qui:

  1. il template Jinja2 renderizza senza errori con i valori di prova;
  2. cio' che ne esce e' YAML leggibile, con dentro i due servizi attesi;
  3. ed e' conforme alla Compose Specification — se lo schema e' a portata.

Il terzo controllo e' facoltativo perche' lo schema e' di qualcun altro e non
va vendorizzato qui dentro. Per farlo girare, una volta sola:

    pip install jsonschema
    curl -sL -o truenas/compose-spec.json       https://raw.githubusercontent.com/compose-spec/compose-spec/master/schema/compose-spec.json

Senza, il controllo si salta dicendolo — non in silenzio, o si finirebbe per
credere di averlo fatto.

Uso:  python truenas/prova.py
Serve: pip install jinja2 pyyaml
"""

import sys
from pathlib import Path

try:
    import yaml
    from jinja2 import Environment, StrictUndefined
except ImportError:
    print("Servono jinja2 e pyyaml:  pip install jinja2 pyyaml", file=sys.stderr)
    raise SystemExit(2)

RADICE = Path(__file__).resolve().parent
APP = RADICE / "trains" / "pulse" / "pulse-talk"
SCHEMA = RADICE / "compose-spec.json"


def validatore():
    """Il validatore della Compose Specification, se c'e' di che costruirlo."""
    if not SCHEMA.exists():
        return None, "schema assente"
    try:
        import json

        from jsonschema import Draft202012Validator
    except ImportError:
        return None, "manca jsonschema"
    return Draft202012Validator(json.loads(SCHEMA.read_text(encoding="utf-8"))), None


def versioni():
    return sorted(p for p in APP.iterdir() if p.is_dir())


def rendi(versione: Path, valori: dict) -> str:
    modello = (versione / "templates" / "docker-compose.yaml").read_text(encoding="utf-8")
    # StrictUndefined: una chiave dimenticata deve esplodere adesso, non
    # diventare una stringa vuota dentro al Compose che TrueNAS eseguira'.
    ambiente = Environment(undefined=StrictUndefined, keep_trailing_newline=True)
    return ambiente.from_string(modello).render(values=valori)


def coerente(composto: dict) -> list[str]:
    """Le due coppie di valori che vanno d'accordo o non funziona niente.

    Sono gli errori che si fanno modificando il file a mano, e sono tutti e due
    silenziosi: nessun container si lamenta, e la chiamata semplicemente non
    parte o resta muta. Meglio scoprirli qui.
    """
    guai = []
    servizi = composto.get("services", {})
    app = servizi.get("pulse-talk", {}).get("environment", {})
    sfu = servizi.get("pulse-talk-sfu", {}).get("environment", {})

    # 1. Il segreto e' scritto in due posti e deve essere lo stesso: il piano di
    #    controllo firma i gettoni, la SFU li verifica. Diversi, ogni ingresso
    #    viene rifiutato e il client riprova all'infinito.
    chiavi = str(sfu.get("LIVEKIT_KEYS", ""))
    if ": " in chiavi and chiavi.split(": ", 1)[1] != app.get("SFU_API_SECRET"):
        guai.append("SFU_API_SECRET e LIVEKIT_KEYS non hanno lo stesso segreto")

    # 2. SFU_URL e use_external_ip sono un aut-aut. Girati a meta', la chiamata
    #    si collega e resta muta, senza nessun errore da nessuna parte.
    try:
        config = yaml.safe_load(sfu.get("LIVEKIT_CONFIG", "") or "{}") or {}
    except Exception:
        return guai + ["LIVEKIT_CONFIG non e' YAML leggibile"]

    esterno = bool(config.get("rtc", {}).get("use_external_ip"))
    url = str(app.get("SFU_URL", ""))
    if url.startswith("wss://") and not esterno:
        guai.append("SFU_URL e' pubblico (wss://) ma use_external_ip e' false")
    if url.startswith("ws://") and esterno:
        guai.append("SFU_URL e' locale (ws://) ma use_external_ip e' true")
    return guai


def provaFileSingolo(schema) -> int:
    """Il file da incollare in TrueNAS, che e' quello che la gente modifica."""
    percorso = RADICE / "pulse-talk.yaml"
    if not percorso.exists():
        print("[!] manca truenas/pulse-talk.yaml")
        return 1

    composto = yaml.safe_load(percorso.read_text(encoding="utf-8"))
    if schema is not None:
        errori = sorted(schema.iter_errors(composto), key=lambda e: list(e.path))
        if errori:
            print("[X] pulse-talk.yaml: non conforme alla Compose Specification")
            for e in errori[:5]:
                dove = "/".join(str(x) for x in e.path) or "(radice)"
                print(f"      {dove} -> {e.message[:160]}")
            return 1

    guai = coerente(composto)
    if guai:
        print("[X] pulse-talk.yaml:")
        for g in guai:
            print(f"      {g}")
        return 1

    print(f"[ok] pulse-talk.yaml: {len(composto.get('services', {}))} servizi, coerente")
    return 0


def main() -> int:
    guai = 0
    schema, perche = validatore()
    if schema is None:
        print(f"[.] controllo Compose Specification saltato: {perche}")

    for versione in versioni():
        prove = sorted((versione / "templates" / "test_values").glob("*.yaml"))
        if not prove:
            print(f"[!] {versione.name}: nessun file di prova")
            guai += 1
            continue

        for prova in prove:
            valori = yaml.safe_load(prova.read_text(encoding="utf-8"))
            try:
                uscita = rendi(versione, valori)
                composto = yaml.safe_load(uscita)
            except Exception as e:  # noqa: BLE001 - qui interessa il messaggio
                print(f"[X] {versione.name}/{prova.name}: {e}")
                guai += 1
                continue

            servizi = composto.get("services", {})
            attesi = {
                valori["consts"]["talk_container_name"],
                valori["consts"]["sfu_container_name"],
            }
            mancanti = attesi - set(servizi)
            if mancanti:
                print(f"[X] {versione.name}/{prova.name}: mancano i servizi {mancanti}")
                guai += 1
                continue

            sfu = servizi[valori["consts"]["sfu_container_name"]]
            if sfu.get("network_mode") != "host":
                print(f"[X] {versione.name}/{prova.name}: la SFU non e' sulla rete dell'host")
                guai += 1
                continue

            # La configurazione della SFU deve nascere dalle risposte, non da un
            # file da modificare a mano dopo: se `use_external_ip` non segue la
            # scelta, l'installazione produce una chiamata muta.
            config = sfu.get("environment", {}).get("LIVEKIT_CONFIG", "")
            atteso = "true" if valori["accesso"]["modo"] == "dominio" else "false"
            if f"use_external_ip: {atteso}" not in config:
                print(f"[X] {versione.name}/{prova.name}: use_external_ip non segue la scelta")
                guai += 1
                continue

            if schema is not None:
                errori = sorted(schema.iter_errors(composto), key=lambda e: list(e.path))
                if errori:
                    print(f"[X] {versione.name}/{prova.name}: non conforme alla Compose Specification")
                    for e in errori[:5]:
                        dove = "/".join(str(x) for x in e.path) or "(radice)"
                        print(f"      {dove} -> {e.message[:160]}")
                    guai += 1
                    continue

            conforme = " e conforme" if schema is not None else ""
            print(f"[ok] {versione.name}/{prova.name}: {len(servizi)} servizi{conforme}")

    guai += provaFileSingolo(schema)

    if guai:
        print(f"\n{guai} problemi.")
        return 1
    print("\nTutto renderizza.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
