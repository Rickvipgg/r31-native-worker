# R31 Native Render Worker v3.0.2

Hotfix testado para Railway.

## Corrigido
- Node.js 22 (WebSocket nativo para Supabase).
- Remove uso inválido de `.catch()` em `sb.rpc()`; o builder do PostgREST é thenable e não implementa `.catch()`.
- Requeue de jobs antigos agora é tolerante a erro e não derruba o worker.
- Limpeza de arquivos do Storage não derruba jobs concluídos.
- `mkdtemp`/limpeza temporária protegidos para não prender contador de concorrência.

## Variáveis Railway
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_STORAGE_BUCKET=instagram-media`
- `RENDER_CONCURRENCY=4`
- `RENDER_POLL_MS=1500`
- `DELETE_RENDER_SOURCES=true`
- `FFMPEG_ENCODER=auto`

## Logs esperados
`R31 Native Worker ... | concurrency=4 | encoder=libx264`
Depois: `baixando ...`, `render native ...`, `render ok ...`, `COMPLETO -> fila Instagram`.

## v3.0.2 — RPC + testes de integração
Corrige `TypeError: sb.rpc(...).catch is not a function`. O PostgREST builder do Supabase é `thenable`, mas não implementa `.catch()` diretamente. A chamada agora usa `await` e trata `{ data, error }` corretamente.

Também inclui graceful shutdown e testes de integração do fluxo completo do worker.
