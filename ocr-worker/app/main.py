"""
FastAPI – OCR Worker para LitFinance.

Microservicio que recibe imágenes de tickets, las preprocesa con OpenCV,
ejecuta PaddleOCR + Tesseract y devuelve candidatos rankeados.
"""

import logging
from fastapi import FastAPI
from app.routes.ocr import router as ocr_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

app = FastAPI(
    title="LitFinance OCR Worker",
    version="1.0.0",
    description="Microservicio de OCR con OpenCV + PaddleOCR + Tesseract",
)

app.include_router(ocr_router, prefix="/ocr", tags=["OCR"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ocr-worker"}
