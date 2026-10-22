# Lote 4B — Limpeza do N8N

**Decisão do dono (22/10/2026):** o WhatsApp roda direto no portal; o N8N sai. Esta nota registra o que foi removido e **onde cada parte vive agora** (conferido antes de apagar: nada em `apps/web`, `packages/*` importa de `integrations/n8n`).

| Era do N8N (`integrations/n8n`) | Onde vive agora |
|---|---|
| `lib/evolution.ts` (normalização do webhook da Evolution Go, botão/lista, id de envio, download de mídia) e `lib/fixtures/eventos.json` | `apps/web/src/server/wa/provider/evolution-go.ts` e `provider/fixtures/eventos.json`, com os mesmos `TODO verificar com mensagem real` e teste por fixture (`provider/provider.test.ts`) |
| Montagem do envio (`/send/text`), presença e estado da instância | `provider/evolution-go.ts` (`enviarTexto`, `presenca`, `statusInstancia`, `baixarMidia`) |
| Fluxos `01-conversa`, `01b-agente` (conversa e agente de IA) | `wa/nucleo.ts` (núcleo), `wa/conversa.ts` (regras determinísticas, do 4A) e `wa/ia/*` (agente Claude só de leitura) |
| Fluxo `00-captura` (conferir o formato real) | Roteiro `docs/lotes/L4B-roteiro.md`, passo B1, e a seção 3 de `docs/11-whatsapp-direto.md` |
| Fluxos `02`, `03`, `04` (lembretes de dose, estoque/receitas, resumo diário) | `wa/fila.ts` (geração, dedupe, descarte do obsoleto), `wa/saida.ts` e `wa/agendador.ts` (envio com ritmo, líder único por trava consultiva) |
| Fluxo `05-teste-conexao` e URL/segredo HMAC do portal | Removidos. O estado da instância vem de `statusInstancia()` (`wa/alertas.ts`, botão **Consultar agora**) |
| Fluxo `06-alertas-operacionais` (`atualizarFalhas`, `textoAlerta`) | `wa/alertas.ts`: aviso no **sino** dos administradores (desconexão e 5 falhas seguidas). E-mail de alerta **não** foi criado (não há infraestrutura de e-mail do sistema além do Appwrite Auth) |
| `limitarRajada` | `wa/ritmo.ts` (teto por minuto/hora, escalonamento, pausa de 2 a 6 s) |
| `validar.mjs`, `build.mjs`, scripts `n8n:build` e `n8n:validar` | Removidos |
| Chave `cpl_` criada pelo portal, `PLATFORM_KEYS_FROM_PORTAL`, `ALLOW_PRIVATE_WEBHOOKS` | Removidos do portal e do `.env.example`. A API `/api/v1` ainda aceita `cpl_` (e a tabela `platform_api_keys` fica, sem uso), para integrações futuras |
| `docs/11-n8n-whatsapp.md` | Substituído por `docs/11-whatsapp-direto.md` |

**Não removido de propósito:** colunas `n8n_*` de `family_integrations` e a tabela `platform_api_keys` (a migração só acrescenta; ver `docs/07-banco-postgres.md`, seção 6.4).

Tudo continua no histórico do git (`git log -- integrations/n8n`).
