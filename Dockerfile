# SilverAid — imagen de la aplicación (usa MySQL; ver docker-compose.yml)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py index.html app.html login.html admin.html usuario.html ./
COPY css ./css
COPY js ./js
COPY assets ./assets

# Usuario sin privilegios. /data solo se usa para importar los .txt antiguos la primera vez.
RUN useradd --system --uid 1000 silveraid \
    && mkdir -p /data \
    && chown silveraid /data
USER silveraid

ENV HOST=0.0.0.0 \
    PORT=8000 \
    DATA_DIR=/data \
    STORAGE=mysql

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/login.html', timeout=4)" || exit 1

CMD ["python", "server.py"]
