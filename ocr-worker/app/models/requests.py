"""
Modelos Pydantic para request/response del OCR Worker.
"""

from pydantic import BaseModel
from typing import Optional


class OcrRequest(BaseModel):
    """Request body para POST /ocr"""
    image_base64: str
    mime_type: str = "image/jpeg"
    width: Optional[int] = None
    height: Optional[int] = None
    platform: Optional[str] = None  # 'ios' | 'android'
    local_ocr: Optional[str] = None  # Texto OCR del front (ML Kit / Vision)
    local_ocr_score: Optional[float] = None


class OcrCandidate(BaseModel):
    """Un candidato OCR de un motor/variante específico."""
    source: str  # 'paddle' | 'tesseract' | 'mlkit'
    variant: str  # 'original', 'grayscale', 'contrast', etc.
    raw_text: str
    lines: list[str]
    score: float
    amounts_detected: int
    words_detected: int


class OcrWorkerResponse(BaseModel):
    """Respuesta completa del OCR worker."""
    candidates: list[OcrCandidate]
    best_raw_text: str
    best_source: str
    confidence: float
    debug: Optional[dict] = None
