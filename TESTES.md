# Testes — R31 Native Render Worker v3.0.2

Executados em Node.js 22.16.0 + FFmpeg 7.1.5.

## Resultado automatizado

10/10 testes aprovados:
- render H.264/AAC 720x1280 real com FFmpeg nativo;
- RPC `requeue_stale_render_jobs` com objeto thenable sem `.catch()`;
- tolerância a erro no requeue;
- claim de jobs e parâmetros;
- propagação de erro de claim;
- argumentos libx264 ultrafast;
- argumentos NVENC p1;
- proteção contra `sb.rpc(...).catch()`;
- Docker Node 22 + FFmpeg;
- encerramento SIGTERM/graceful shutdown.

## Teste de integração do worker completo

Também foi iniciado o `index.mjs` como processo real com um mock compatível com o comportamento do Supabase/PostgREST, servidor HTTP local para os arquivos e um job completo.

Fluxo validado:
1. startup;
2. `/health` respondendo;
3. claim do job;
4. download do MP4 + template;
5. FFmpeg nativo;
6. upload simulado do MP4 final;
7. criação do post agendado simulada;
8. conclusão do render job;
9. limpeza das fontes;
10. shutdown por SIGTERM.

Resultado observado:
`COMPLETO -> fila Instagram`
`completed=1, failed=0, lastError=null`

O único componente não acessado nesse teste local foi o projeto Supabase real do usuário; credenciais reais não foram usadas nem copiadas.
