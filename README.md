# R31 Native Render Worker v4

Worker Railway/Docker com FFmpeg nativo adaptativo.

Além das correções de estabilidade da v3.0.4, a v4 reaproveita o mesmo MP4 final para as duas plataformas:

```text
FFmpeg nativo
    ↓
rendered/...mp4
    ↓
 ┌───────────────┐
 ↓               ↓
scheduled_posts facebook_posts
Instagram        Facebook
```

O worker **não usa App Secret nem token Meta**. Ele apenas cria as filas no Supabase. A Vercel faz a publicação.

## Estabilidade

- `code === null` tratado como interrupção recuperável;
- redução automática de concorrência quando um FFmpeg é morto;
- retry em modo seguro com 1 thread;
- normalização para 30 fps antes de filtros;
- monitora memória do cgroup;
- `ffprobe` para diagnóstico;
- H.264 + AAC.

## Railway

```env
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
SUPABASE_STORAGE_BUCKET=instagram-media
RENDER_CONCURRENCY=4
RENDER_POLL_MS=1500
DELETE_RENDER_SOURCES=true
FFMPEG_ENCODER=auto
FFMPEG_THREADS=0
```

`RENDER_CONCURRENCY=4` é o teto; o worker reduz sozinho se faltar RAM/CPU.

## Facebook

Se `fb_pages` existir e houver uma Página com `is_active=true`, cada render concluído cria também um registro em `facebook_posts` usando o **mesmo `outputPath`**.

Se a migration do Facebook ainda não tiver sido executada, o worker continua funcionando normalmente só para Instagram.
