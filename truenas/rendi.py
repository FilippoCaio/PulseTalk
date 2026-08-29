#!/usr/bin/env python3
"""Rende il template del catalogo e stampa il Compose da incollare.

Serve alla strada che su TrueNAS funziona davvero — **Install via YAML** — dato
che i cataloghi di terze parti non si possono piu' aggiungere dalla 24.10 in
poi. Le domande sono le stesse di `questions.yaml`: qui si rispondono sulla riga
di comando invece che in un modulo.

Esempi:

    # rete locale, per provare tutto prima di aprire qualcosa
    python truenas/rendi.py --locale 192.168.1.10 --segreto "$(openssl rand -hex 32)"

    # da internet, con un dominio
    python truenas/rendi.py --dominio casa.it --segreto "$(openssl rand -hex 32)"

Serve: pip install jinja2 pyyaml
"""

import argparse
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


def ultima_versione() -> Path:
    versioni = sorted(p for p in APP.iterdir() if p.is_dir())
    if not versioni:
        raise SystemExit("Nessuna versione dell'app in trains/pulse/pulse-talk.")
    return versioni[-1]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    dove = p.add_mutually_exclusive_group(required=True)
    dove.add_argument("--dominio", help="Il tuo dominio, senza https:// (per esempio casa.it).")
    dove.add_argument("--locale", metavar="IP", help="L'indirizzo del NAS nella rete di casa.")
    p.add_argument("--segreto", required=True, help="Il segreto della SFU. openssl rand -hex 32")
    p.add_argument("--dati", default="/mnt/pool/pulsetalk/dati", help="La cartella dei dati sul NAS.")
    p.add_argument("--porta", type=int, default=30080, help="La porta del piano di controllo.")
    p.add_argument("--uid", type=int, default=568)
    p.add_argument("--gid", type=int, default=568)
    p.add_argument("--immagine", default=None, help="Per usare un'immagine diversa da quella di serie.")
    p.add_argument("--versione-immagine", default=None, help="latest, oppure X.Y.Z.")
    args = p.parse_args()

    if len(args.segreto) < 32:
        # Non e' pignoleria: con questo segreto si firmano i gettoni con cui le
        # app entrano nelle stanze. Corto vuol dire indovinabile.
        print("Il segreto deve essere lungo almeno 32 caratteri.", file=sys.stderr)
        return 2

    versione = ultima_versione()
    valori = yaml.safe_load(
        (versione / "templates" / "test_values" / "basic-values.yaml").read_text(encoding="utf-8")
    )

    valori["accesso"] = {
        "modo": "dominio" if args.dominio else "locale",
        "dominio": args.dominio or "",
        "indirizzo_locale": args.locale or "",
    }
    valori["sfu"]["segreto"] = args.segreto
    valori["rete"]["porta"] = args.porta
    valori["run_as"] = {"user": args.uid, "group": args.gid}
    # Sempre una cartella scelta a mano: `ix_volume` lo sa risolvere solo il
    # middleware di TrueNAS, e qui il middleware non c'e'.
    valori["storage"]["data"] = {"type": "host_path", "host_path_config": {"path": args.dati}}
    valori["ix_volumes"] = {"data": args.dati}
    if args.immagine:
        valori["images"]["image"]["repository"] = args.immagine
    if args.versione_immagine:
        valori["images"]["image"]["tag"] = args.versione_immagine

    modello = (versione / "templates" / "docker-compose.yaml").read_text(encoding="utf-8")
    ambiente = Environment(undefined=StrictUndefined, keep_trailing_newline=True)
    uscita = ambiente.from_string(modello).render(values=valori)

    # Un controllo prima di stamparlo: se non e' YAML valido, meglio dirlo qui
    # che farlo scoprire alla schermata di TrueNAS.
    yaml.safe_load(uscita)
    print(uscita)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
