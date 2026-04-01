"""
Servicio de merge/ranking de candidatos OCR.

Compara resultados de PaddleOCR y Tesseract sobre múltiples variantes
y elige el mejor candidato basándose en:
  - cantidad de líneas
  - cantidad de montos detectados ($xx.xx)
  - presencia de total/subtotal/iva
  - cantidad de texto útil
  - confianza promedio del motor
"""

import logging
import re

logger = logging.getLogger(__name__)

# Patrones que indican un buen resultado de OCR en tickets mexicanos
TOTAL_PATTERNS = re.compile(
    r"total|subtotal|sub\s*total|iva|i\.v\.a|ieps|impuesto|cambio|efectivo|tarjeta",
    re.IGNORECASE,
)

AMOUNT_PATTERN = re.compile(r"\$?\d{1,6}[.,]\d{2}")


def score_candidate(result: dict) -> float:
    """
    Calcula un score (0-1) para un candidato OCR.

    Factores:
      - lines_score: más líneas = mejor (hasta 50 líneas = 1.0)
      - amounts_score: más montos = mejor (hasta 10 = 1.0)
      - keywords_score: presencia de total/subtotal/iva
      - confidence_score: confianza del motor OCR
      - words_score: más palabras = mejor (hasta 100 = 1.0)
    """
    raw_text = result.get("raw_text", "")
    lines = result.get("lines", [])
    amounts = result.get("amounts_detected", 0)
    words = result.get("words_detected", 0)
    confidence = result.get("avg_confidence", 0.0)

    # Score por cantidad de líneas (0-1, cap at 50)
    lines_score = min(len(lines) / 50, 1.0) * 0.2

    # Score por montos detectados (0-1, cap at 10)
    amounts_score = min(amounts / 10, 1.0) * 0.25

    # Score por palabras clave de ticket
    keywords_found = len(TOTAL_PATTERNS.findall(raw_text))
    keywords_score = min(keywords_found / 5, 1.0) * 0.2

    # Score por confianza del motor
    confidence_score = confidence * 0.2

    # Score por cantidad de palabras (0-1, cap at 100)
    words_score = min(words / 100, 1.0) * 0.15

    total_score = lines_score + amounts_score + keywords_score + confidence_score + words_score

    return round(total_score, 4)


def merge_and_rank(
    all_results: list[dict],
    local_ocr_text: str | None = None,
    local_ocr_score: float | None = None,
) -> dict:
    """
    Recibe todos los resultados de OCR (PaddleOCR + Tesseract × variantes + tiles)
    y devuelve el ranking final.

    Retorna:
      - candidates: lista ordenada por score descendente
      - best_raw_text: texto del mejor candidato
      - best_source: fuente del mejor
      - confidence: confianza global
    """
    candidates: list[dict] = []

    # Agregar resultado del front (ML Kit / Vision) si existe
    if local_ocr_text and local_ocr_text.strip():
        amounts = len(AMOUNT_PATTERN.findall(local_ocr_text))
        lines = [l for l in local_ocr_text.strip().split("\n") if l.strip()]
        mlkit_result = {
            "raw_text": local_ocr_text.strip(),
            "lines": lines,
            "words_detected": sum(len(l.split()) for l in lines),
            "amounts_detected": amounts,
            "avg_confidence": local_ocr_score or 0.7,
        }
        score = score_candidate(mlkit_result)
        candidates.append({
            "source": "mlkit",
            "variant": "local",
            "raw_text": local_ocr_text.strip(),
            "lines": lines,
            "score": score,
            "amounts_detected": amounts,
            "words_detected": mlkit_result["words_detected"],
        })

    # Agregar resultados de PaddleOCR y Tesseract
    for result in all_results:
        if result is None:
            continue
        score = score_candidate(result)
        candidates.append({
            "source": result.get("source", "unknown"),
            "variant": result.get("variant", "unknown"),
            "raw_text": result.get("raw_text", ""),
            "lines": result.get("lines", []),
            "score": score,
            "amounts_detected": result.get("amounts_detected", 0),
            "words_detected": result.get("words_detected", 0),
        })

    # Ordenar por score descendente
    candidates.sort(key=lambda c: c["score"], reverse=True)

    if not candidates:
        return {
            "candidates": [],
            "best_raw_text": "",
            "best_source": "none",
            "confidence": 0.0,
        }

    best = candidates[0]

    # Confianza global: promedio ponderado del top-3
    top_scores = [c["score"] for c in candidates[:3]]
    confidence = sum(top_scores) / len(top_scores)

    logger.info(
        f"[MERGE] {len(candidates)} candidatos. "
        f"Mejor: {best['source']}:{best['variant']} score={best['score']:.4f} "
        f"({best['words_detected']} palabras, {best['amounts_detected']} montos)"
    )

    return {
        "candidates": candidates,
        "best_raw_text": best["raw_text"],
        "best_source": f"{best['source']}:{best['variant']}",
        "confidence": round(confidence, 4),
    }
