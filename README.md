# R31 Native Render Worker

Esse serviço é o motor pesado da v3. Ele NÃO roda na Vercel. A Vercel continua com o painel/API; o worker roda num serviço Docker contínuo (Railway, Render, VPS, etc.).

## O que ele faz

1. Busca `render_jobs` no Supabase com claim atômico.
2. Baixa o vídeo original + template PNG.
3. Renderiza com FFmpeg NATIVO (`libx264 ultrafast`).
4. Se detectar NVIDIA, usa `h264_nvenc` automaticamente.
5. Envia o MP4 final ao Storage.
6. Cria o `scheduled_post` para o AutoPost.
7. Apaga fonte/template do Storage após sucesso (configurável).

## Railway / serviço Docker

Crie um serviço apontando para este repositório/ZIP e use o Dockerfile `worker/Dockerfile`.

Variáveis do worker:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_STORAGE_BUCKET=instagram-media`
- `RENDER_CONCURRENCY=2` a `8`, conforme CPU
- `FFMPEG_ENCODER=auto`
- `DELETE_RENDER_SOURCES=true`

O worker expõe `/health` na porta fornecida por `PORT`.

## Escala

Você pode subir 2+ workers. `claim_render_jobs()` usa `FOR UPDATE SKIP LOCKED`, então cada job é pego apenas por um worker.
