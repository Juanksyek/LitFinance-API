"""
Preprocesamiento de imágenes con OpenCV.

Genera múltiples variantes de la imagen para maximizar la calidad del OCR:
  - original (decodificada)
  - grayscale
  - contraste alto
  - binarizada (Otsu)
  - sharpen
  - deskew (corrección de rotación)
  - perspectiva corregida (si se detectan bordes)
"""

import base64
import logging
import math
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)


def decode_image(base64_str: str) -> np.ndarray:
    """Decodifica una imagen base64 a un array OpenCV BGR."""
    img_bytes = base64.b64decode(base64_str)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("No se pudo decodificar la imagen")
    return img


def encode_image(img: np.ndarray, fmt: str = ".jpg") -> str:
    """Codifica un array OpenCV a base64."""
    _, buf = cv2.imencode(fmt, img)
    return base64.b64encode(buf).decode("utf-8")


def to_grayscale(img: np.ndarray) -> np.ndarray:
    """Convierte a escala de grises."""
    if len(img.shape) == 2:
        return img
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def high_contrast(img: np.ndarray) -> np.ndarray:
    """Aplica CLAHE para mejorar contraste local."""
    gray = to_grayscale(img)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def binarize(img: np.ndarray) -> np.ndarray:
    """Binarización adaptativa con Otsu."""
    gray = to_grayscale(img)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binary


def sharpen(img: np.ndarray) -> np.ndarray:
    """Aplica kernel de sharpening."""
    kernel = np.array([
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0],
    ], dtype=np.float32)
    return cv2.filter2D(img, -1, kernel)


def deskew(img: np.ndarray) -> np.ndarray:
    """
    Corrige la rotación detectando el ángulo dominante con Hough Lines.
    Solo corrige rotaciones menores a ±15°.
    """
    gray = to_grayscale(img)
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(
        edges, 1, math.pi / 180,
        threshold=100, minLineLength=80, maxLineGap=10,
    )

    if lines is None or len(lines) < 3:
        return img

    # Calcular ángulo promedio de las líneas detectadas
    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
        # Solo considerar líneas casi horizontales (±30°)
        if abs(angle) < 30:
            angles.append(angle)

    if not angles:
        return img

    median_angle = float(np.median(angles))

    # Solo corregir si la rotación es significativa pero no excesiva
    if abs(median_angle) < 0.5 or abs(median_angle) > 15:
        return img

    logger.info(f"[DESKEW] Corrigiendo rotación de {median_angle:.2f}°")

    h, w = img.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, median_angle, 1.0)
    return cv2.warpAffine(
        img, matrix, (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


def correct_perspective(img: np.ndarray) -> Optional[np.ndarray]:
    """
    Intenta detectar los 4 bordes del ticket y aplicar corrección de perspectiva.
    Retorna None si no se detecta un contorno rectangular claro.
    """
    gray = to_grayscale(img)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 200)

    # Dilatar para cerrar gaps en los bordes
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    edges = cv2.dilate(edges, kernel, iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # Buscar el contorno más grande que sea aproximadamente rectangular
    contours = sorted(contours, key=cv2.contourArea, reverse=True)

    h, w = img.shape[:2]
    min_area = h * w * 0.2  # Al menos 20% del área de la imagen

    for contour in contours[:5]:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue

        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * peri, True)

        if len(approx) == 4:
            pts = approx.reshape(4, 2).astype(np.float32)

            # Ordenar puntos: top-left, top-right, bottom-right, bottom-left
            rect = _order_points(pts)

            # Calcular dimensiones del rectángulo destino
            width_a = np.linalg.norm(rect[2] - rect[3])
            width_b = np.linalg.norm(rect[1] - rect[0])
            max_w = int(max(width_a, width_b))

            height_a = np.linalg.norm(rect[1] - rect[2])
            height_b = np.linalg.norm(rect[0] - rect[3])
            max_h = int(max(height_a, height_b))

            if max_w < 100 or max_h < 100:
                continue

            dst = np.array([
                [0, 0],
                [max_w - 1, 0],
                [max_w - 1, max_h - 1],
                [0, max_h - 1],
            ], dtype=np.float32)

            matrix = cv2.getPerspectiveTransform(rect, dst)
            warped = cv2.warpPerspective(img, matrix, (max_w, max_h))
            logger.info(f"[PERSPECTIVE] Corregida: {w}x{h} -> {max_w}x{max_h}")
            return warped

    return None


def _order_points(pts: np.ndarray) -> np.ndarray:
    """Ordena 4 puntos en: top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]  # top-left: menor x+y
    rect[2] = pts[np.argmax(s)]  # bottom-right: mayor x+y
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]  # top-right: menor y-x
    rect[3] = pts[np.argmax(d)]  # bottom-left: mayor y-x
    return rect


def generate_variants(img: np.ndarray) -> dict[str, np.ndarray]:
    """
    Genera todas las variantes de la imagen para OCR.
    Retorna un dict { nombre_variante: imagen }.
    """
    variants: dict[str, np.ndarray] = {"original": img}

    # 1. Deskew primero (sobre la original)
    deskewed = deskew(img)
    if deskewed is not img:
        variants["deskew"] = deskewed
        base = deskewed  # Usar la deskewed como base para el resto
    else:
        base = img

    # 2. Perspectiva corregida
    perspective = correct_perspective(base)
    if perspective is not None:
        variants["perspective"] = perspective
        base = perspective  # Si se corrigió perspectiva, usarla como nueva base

    # 3. Grayscale
    variants["grayscale"] = to_grayscale(base)

    # 4. Contraste alto (CLAHE)
    variants["contrast"] = high_contrast(base)

    # 5. Binarizada (Otsu)
    variants["binarized"] = binarize(base)

    # 6. Sharpen
    variants["sharpen"] = sharpen(base)

    logger.info(f"[PREPROCESS] Generadas {len(variants)} variantes: {list(variants.keys())}")
    return variants
