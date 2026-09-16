# Testes v3.0.4

Executados localmente antes do empacotamento:

- `npm test`: 20/20 aprovados
- `npm run check`: aprovado
- render real H.264 + AAC 720x1280
- lote de 4 renders FFmpeg simultâneos
- entrada 60 fps vertical
- entrada 1080p horizontal
- vídeo sem faixa de áudio
- modo seguro de retry com 1 thread
- captura de SIGTERM e SIGKILL
- cálculo de concorrência por RAM/CPU
- detecção de pressão de memória
- Supabase RPC thenable sem `.catch()`

Observação: o ambiente de teste não possui Docker daemon, portanto o `docker build` não foi executado aqui. O Dockerfile usa Node 22 bookworm-slim + FFmpeg, e a sintaxe/arquivos foram validados.


## v4.1 Size Guard

- `npm test`: inclui teste real de recompressão automática quando o MP4 final excede o limite.
- `npm run check`: valida sintaxe do worker e libs.
- O teste força um MP4 acima de um limite artificial e confirma que o arquivo final fica abaixo do teto.
