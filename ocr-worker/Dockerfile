FROM python:3.11-slim

# Instalar Tesseract + idioma español
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-spa \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código
COPY app/ app/

# NOTA: precargar modelos durante el build puede causar fallos en ambientes "slim"
# (paddlepaddle/paddleocr cargan binarios y pueden requerir libs/GL en tiempo
# de ejecución). Para evitar problemas de build, no descargamos los modelos
# en la fase de build. El worker hará lazy-load al primer request y cacheará
# los modelos en /root/.paddleocr (montado como volumen en docker-compose).
# Si prefieres forzar la precarga, ejecuta manualmente dentro del contenedor:
#   docker compose run --rm ocr-worker python -c "from paddleocr import PaddleOCR; PaddleOCR(use_angle_cls=True, lang='es', show_log=False, use_gpu=False)"

EXPOSE 8100

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
