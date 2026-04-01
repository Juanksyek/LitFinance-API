"""
Tiling vertical para tickets largos.

Divide la imagen en secciones con solapamiento del 12% para evitar
perder artículos en los cortes.

Estructura generada:
  header   (top 25%)
  body_1   (con overlap)
  body_2   (con overlap)
  ...
  footer   (bottom 25%)
"""

import logging
import numpy as np

logger = logging.getLogger(__name__)

# Configuración
DEFAULT_TILE_HEIGHT = 1200  # px por tile
OVERLAP_RATIO = 0.12        # 12% de solapamiento
MIN_HEIGHT_FOR_TILING = 2000  # Solo dividir si la imagen es más alta que esto
MIN_ASPECT_RATIO = 2.5       # Solo dividir si aspect ratio > 2.5


def should_tile(img: np.ndarray) -> bool:
    """Determina si la imagen necesita tiling."""
    h, w = img.shape[:2]
    aspect = h / max(w, 1)
    return h > MIN_HEIGHT_FOR_TILING and aspect > MIN_ASPECT_RATIO


def generate_tiles(img: np.ndarray) -> list[dict]:
    """
    Divide la imagen en tiles verticales con solapamiento.

    Retorna lista de dicts con:
      - name: nombre del tile ('header', 'body_1', ..., 'footer')
      - image: numpy array del tile
      - y_start: posición Y de inicio
      - y_end: posición Y de fin
    """
    h, w = img.shape[:2]

    if not should_tile(img):
        return [{"name": "full", "image": img, "y_start": 0, "y_end": h}]

    tiles: list[dict] = []
    tile_height = DEFAULT_TILE_HEIGHT
    overlap = int(tile_height * OVERLAP_RATIO)

    # Header: top 25% del ticket (logo, nombre tienda, dirección)
    header_end = min(int(h * 0.25), tile_height)
    tiles.append({
        "name": "header",
        "image": img[0:header_end, :],
        "y_start": 0,
        "y_end": header_end,
    })

    # Body: sección central con tiles solapados
    body_start = header_end - overlap
    body_end = int(h * 0.80)  # Dejar el último 20% para footer
    tile_idx = 1

    y = body_start
    while y < body_end:
        y_end = min(y + tile_height, h)
        tiles.append({
            "name": f"body_{tile_idx}",
            "image": img[y:y_end, :],
            "y_start": y,
            "y_end": y_end,
        })
        tile_idx += 1
        y += tile_height - overlap

    # Footer: bottom 25% (totales, impuestos, método de pago)
    footer_start = max(int(h * 0.75), h - tile_height)
    # Evitar duplicar si el footer ya está cubierto por el último body tile
    if footer_start < tiles[-1]["y_end"] - overlap * 2:
        footer_start = tiles[-1]["y_end"] - overlap

    tiles.append({
        "name": "footer",
        "image": img[footer_start:h, :],
        "y_start": footer_start,
        "y_end": h,
    })

    logger.info(
        f"[TILING] Imagen {w}x{h} dividida en {len(tiles)} tiles: "
        f"{[t['name'] for t in tiles]}"
    )

    return tiles
