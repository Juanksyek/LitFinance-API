"""
Ruta principal del OCR Worker.

POST /ocr → recibe imagen → preprocesa → OCR múltiple → merge → respuesta
"""

import logging
import time

from fastapi import APIRouter, HTTPException

from app.models.requests import OcrRequest, OcrCandidate, OcrWorkerResponse
from app.services import preprocess, paddle_service, tesseract_service, ticket_tiling, merge_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("", response_model=OcrWorkerResponse)
async def process_ocr(req: OcrRequest):
    """
    Pipeline OCR completo:
      1. Decodificar imagen
      2. Generar variantes con OpenCV
      3. Tiling si es ticket largo
      4. Ejecutar PaddleOCR + Tesseract sobre cada variante/tile
      5. Merge y ranking
      6. Devolver candidatos rankeados
    """
    start = time.time()

    try:
        # 1. Decodificar imagen
        img = preprocess.decode_image(req.image_base64)
        h, w = img.shape[:2]
        logger.info(f"[OCR] Imagen recibida: {w}x{h} ({req.mime_type})")

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error al decodificar imagen: {e}")

    # 2. Generar variantes
    variants = preprocess.generate_variants(img)

    # 3. Tiling para tickets largos
    tiles = ticket_tiling.generate_tiles(img)
    has_tiles = len(tiles) > 1

    # 4. Ejecutar OCR sobre cada variante + tiles
    all_results: list[dict] = []

    # 4a. OCR sobre variantes de la imagen completa
    for variant_name, variant_img in variants.items():
        # PaddleOCR
        paddle_result = paddle_service.extract_text(variant_img, variant_name)
        if paddle_result:
            paddle_result["source"] = "paddle"
            paddle_result["variant"] = variant_name
            all_results.append(paddle_result)

        # Tesseract
        tess_result = tesseract_service.extract_text(variant_img, variant_name)
        if tess_result:
            tess_result["source"] = "tesseract"
            tess_result["variant"] = variant_name
            all_results.append(tess_result)

    # 4b. Si hay tiles, también OCR las variantes principales de cada tile
    if has_tiles:
        for tile_info in tiles:
            tile_img = tile_info["image"]
            tile_name = tile_info["name"]

            # Solo PaddleOCR para tiles (Tesseract es más lento)
            paddle_result = paddle_service.extract_text(tile_img, f"tile_{tile_name}")
            if paddle_result:
                paddle_result["source"] = "paddle"
                paddle_result["variant"] = f"tile_{tile_name}"
                all_results.append(paddle_result)

            # Tesseract solo para header y footer (las partes más importantes)
            if tile_name in ("header", "footer"):
                tess_result = tesseract_service.extract_text(tile_img, f"tile_{tile_name}")
                if tess_result:
                    tess_result["source"] = "tesseract"
                    tess_result["variant"] = f"tile_{tile_name}"
                    all_results.append(tess_result)

    if not all_results and not req.local_ocr:
        raise HTTPException(
            status_code=422,
            detail="No se pudo extraer texto de la imagen con ningún motor OCR",
        )

    # 5. Merge y ranking
    merged = merge_service.merge_and_rank(
        all_results,
        local_ocr_text=req.local_ocr,
        local_ocr_score=req.local_ocr_score,
    )

    elapsed = time.time() - start
    logger.info(f"[OCR] Pipeline completo en {elapsed:.2f}s — {len(merged['candidates'])} candidatos")

    # 6. Construir respuesta
    candidates = [
        OcrCandidate(
            source=c["source"],
            variant=c["variant"],
            raw_text=c["raw_text"],
            lines=c["lines"],
            score=c["score"],
            amounts_detected=c["amounts_detected"],
            words_detected=c["words_detected"],
        )
        for c in merged["candidates"]
    ]

    return OcrWorkerResponse(
        candidates=candidates,
        best_raw_text=merged["best_raw_text"],
        best_source=merged["best_source"],
        confidence=merged["confidence"],
        debug={
            "elapsed_seconds": round(elapsed, 2),
            "variants_generated": list(variants.keys()),
            "tiles_generated": [t["name"] for t in tiles] if has_tiles else [],
            "total_results": len(all_results),
            "image_size": f"{w}x{h}",
        },
    )
