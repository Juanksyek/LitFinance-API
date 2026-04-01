"""
Servicio PaddleOCR – Motor OCR principal.

PaddleOCR es un toolkit OCR que convierte imágenes en datos estructurados.
Se usa como extractor primario porque tiene buena precisión en documentos variados.
"""

import logging
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# Inicialización lazy del modelo (pesado, solo una vez)
_ocr_engine = None


def _get_engine():
    """Inicializa PaddleOCR lazily la primera vez que se necesita."""
    global _ocr_engine
    if _ocr_engine is None:
        from paddleocr import PaddleOCR

        logger.info("[PADDLE] Inicializando PaddleOCR (primera vez)...")
        _ocr_engine = PaddleOCR(
            use_angle_cls=True,  # Detectar y corregir texto rotado
            lang="es",           # Español
            show_log=False,
            use_gpu=False,       # CPU por defecto; cambiar a True si hay GPU
        )
        logger.info("[PADDLE] PaddleOCR listo")
    return _ocr_engine


def extract_text(img: np.ndarray, variant_name: str = "original") -> Optional[dict]:
    """
    Ejecuta PaddleOCR sobre una imagen (numpy array BGR).

    Retorna dict con:
      - raw_text: texto plano concatenado
      - lines: lista de líneas
      - words_detected: cantidad de palabras
      - amounts_detected: cantidad de montos numéricos detectados
      - avg_confidence: confianza promedio de todas las detecciones
    """
    try:
        engine = _get_engine()
        result = engine.ocr(img, cls=True)

        if not result or not result[0]:
            logger.warning(f"[PADDLE:{variant_name}] Sin resultados")
            return None

        detections = result[0]
        lines: list[str] = []
        confidences: list[float] = []
        amounts = 0

        for detection in detections:
            # detection = [bbox, (text, confidence)]
            if len(detection) < 2:
                continue
            text_info = detection[1]
            if isinstance(text_info, tuple) and len(text_info) >= 2:
                text = str(text_info[0]).strip()
                conf = float(text_info[1])
            else:
                continue

            if text:
                lines.append(text)
                confidences.append(conf)

                # Contar montos: buscar patrones como $123.45, 123.45, etc.
                import re
                amount_matches = re.findall(r"\$?\d+[.,]\d{2}", text)
                amounts += len(amount_matches)

        raw_text = "\n".join(lines)
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0

        logger.info(
            f"[PADDLE:{variant_name}] {len(lines)} líneas, "
            f"{sum(len(l.split()) for l in lines)} palabras, "
            f"{amounts} montos, conf={avg_conf:.2f}"
        )

        return {
            "raw_text": raw_text,
            "lines": lines,
            "words_detected": sum(len(l.split()) for l in lines),
            "amounts_detected": amounts,
            "avg_confidence": avg_conf,
        }

    except Exception as e:
        logger.error(f"[PADDLE:{variant_name}] Error: {e}")
        return None
