"""
Servicio Tesseract – Motor OCR secundario / de rescate.

Tesseract 4+ usa un motor basado en LSTM. Se usa como segundo motor
para comparación y rescate cuando PaddleOCR no obtiene buenos resultados.
"""

import logging
import re
from typing import Optional

import numpy as np
import pytesseract

logger = logging.getLogger(__name__)


def extract_text(img: np.ndarray, variant_name: str = "original") -> Optional[dict]:
    """
    Ejecuta Tesseract sobre una imagen (numpy array).

    Usa --oem 1 (LSTM) y --psm 6 (bloque de texto uniforme, ideal para tickets).

    Retorna dict con:
      - raw_text, lines, words_detected, amounts_detected, avg_confidence
    """
    try:
        # Asegurar grayscale para Tesseract
        if len(img.shape) == 3:
            import cv2

            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        else:
            gray = img

        # Ejecutar OCR con datos de confianza
        data = pytesseract.image_to_data(
            gray,
            lang="spa",
            config="--oem 1 --psm 6",
            output_type=pytesseract.Output.DICT,
        )

        # Reconstruir líneas desde las palabras detectadas
        lines: list[str] = []
        confidences: list[float] = []
        current_line: list[str] = []
        current_line_num = -1

        for i, text in enumerate(data["text"]):
            conf = int(data["conf"][i])
            line_num = data["line_num"][i]

            if line_num != current_line_num:
                if current_line:
                    lines.append(" ".join(current_line))
                current_line = []
                current_line_num = line_num

            word = str(text).strip()
            if word and conf > 0:
                current_line.append(word)
                confidences.append(conf / 100.0)

        # Agregar última línea
        if current_line:
            lines.append(" ".join(current_line))

        # Filtrar líneas vacías
        lines = [l for l in lines if l.strip()]

        if not lines:
            logger.warning(f"[TESSERACT:{variant_name}] Sin texto detectado")
            return None

        raw_text = "\n".join(lines)
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0

        # Contar montos
        amounts = len(re.findall(r"\$?\d+[.,]\d{2}", raw_text))

        logger.info(
            f"[TESSERACT:{variant_name}] {len(lines)} líneas, "
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
        logger.error(f"[TESSERACT:{variant_name}] Error: {e}")
        return None
