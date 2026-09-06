---
title: AutoTube Studio
emoji: 🎬
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# AutoTube Studio

Generador automático de vídeos faceless para YouTube: a partir de un título escribe el guion
con IA, genera la locución en español (Piper), busca clips y música libres, monta subtítulos
karaoke y renderiza el MP4 final con ffmpeg.

La interfaz está protegida por contraseña (`APP_PASSWORD`).

## Variables

- `APP_PASSWORD`: contraseña de acceso.
- `GEMINI_API_KEY`: guiones con IA.
- `PEXELS_API_KEY`: clips de vídeo de stock.
- `OPENVERSE_CLIENT_ID` / `OPENVERSE_CLIENT_SECRET`: imágenes y música libres.
- `DATA_DIR`: carpeta de trabajos y media.
