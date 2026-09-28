"""Flight Tracker: tu vigilante personal de precios de vuelos.

Todo funciona en GitHub:
  * GitHub Actions escanea los precios cada 6 horas y te manda los chollos por email
  * GitHub Pages publica tu web (tus destinos, filtros y resultados)
  * tus ajustes se guardan como variables/secrets del repositorio (los cambias desde la web)
"""
import logging
import os

__version__ = "5.0.0"


def init(db_path: str = None):
    """Abre (o crea) la base de datos y aplica los ajustes que llegan de GitHub."""
    from . import db
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    db.init(db_path or os.environ.get("DB_PATH", "data/flights.db"))
