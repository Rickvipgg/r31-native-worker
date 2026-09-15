# R31 Native Render Worker v3.0.4

Hotfix para falhas intermitentes `ffmpeg saiu com código null` em lotes grandes.

## O que mudou

- qualquer saída `code === null` agora é tratada como interrupção recuperável;
- reduz o paralelismo automaticamente após interrupção;
- retries passam a usar **modo seguro** (1 thread de encoder + 1 thread de filtros);
- o pipeline reduz o vídeo para **30 fps antes de scale/crop/overlay**, evitando processar 60/120 fps sem necessidade;
- monitora RAM do cgroup e para de pegar novos jobs quando o container está acima de ~82% de uso;
- adiciona `ffprobe` para registrar codec, resolução, fps e duração dos vídeos problemáticos;
- health endpoint agora mostra uso atual de memória;
- mantém H.264 + AAC e o mesmo layout/qualidade do projeto.

## Railway

Mantenha as mesmas variáveis:

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

`RENDER_CONCURRENCY=4` é apenas o teto. O worker reduz sozinho quando necessário.

## Atualização

Substitua o conteúdo do repositório do worker por esta versão e faça commit/push. Não precisa alterar Vercel, Supabase ou SQL.
