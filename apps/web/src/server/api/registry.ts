import { API_VERSION } from "./version";

/**
 * Fonte única das rotas `/api/v1`: gera o OpenAPI (`/api/v1/openapi.json`) e é conferida contra os arquivos de
 * `src/app/api/v1/**` por um teste (o contrato não pode divergir das rotas).
 */

export type AuthKind =
  /** Bearer (cdf_ ou cpl_) + X-Telefone de um membro verificado; aplica as permissões dele */
  | "membro"
  /** só cpl_ (escopo conversa) + X-Telefone do remetente real; aceita quem ainda não é membro */
  | "remetente"
  /** cdf_ (a própria família) ou cpl_ (todas); sem X-Telefone */
  | "fila"
  /** só cpl_ */
  | "plataforma"
  /** URL assinada de curta duração, sem Bearer */
  | "assinada"
  | "publica";

interface Prop { type: "string" | "integer" | "number" | "boolean"; description?: string; enum?: string[] }

export interface RouteSpec {
  path: string;
  method: "get" | "post";
  handler: string;
  summary: string;
  tag: string;
  auth: AuthKind;
  query?: Record<string, Prop>;
  body?: { required?: string[]; properties: Record<string, Prop> };
}

const msg: Prop = { type: "string", description: "Id da mensagem do WhatsApp (idempotência)." };

export const ROUTES: RouteSpec[] = [
  { path: "/doses/proximas", method: "get", handler: "dosesProximas", tag: "Doses", auth: "membro", summary: "Próximas doses (abertas) de hoje.", query: { limite: { type: "integer" } } },
  { path: "/doses/dia", method: "get", handler: "dosesDoDia", tag: "Doses", auth: "membro", summary: "Doses de um dia (padrão: hoje) com a situação de cada uma.", query: { data: { type: "string", description: "aaaa-mm-dd" } } },
  { path: "/doses/{id}/confirmar", method: "post", handler: "dosesConfirmar", tag: "Doses", auth: "membro", summary: "Confirma a dose (idempotente; desconta o estoque uma só vez).", body: { properties: { messageId: msg } } },
  { path: "/doses/{id}/desfazer", method: "post", handler: "dosesDesfazer", tag: "Doses", auth: "membro", summary: "Desfaz a confirmação (só quem confirmou, nos primeiros 30 s)." },
  { path: "/doses/{id}/registrar-depois", method: "post", handler: "dosesRegistrarDepois", tag: "Doses", auth: "membro", summary: "Registra que tomou depois (dose atrasada ou esquecida).", body: { properties: { messageId: msg } } },
  { path: "/doses/{id}/lembrar-de-novo", method: "post", handler: "dosesLembrarDeNovo", tag: "Doses", auth: "membro", summary: "Pede novo lembrete em 15, 30 ou 60 minutos.", body: { properties: { minutos: { type: "integer" } } } },
  { path: "/estoque", method: "get", handler: "estoqueVisao", tag: "Estoque", auth: "membro", summary: "Visão do estoque com a previsão de término (colírio é estimativa)." },
  { path: "/reposicoes", method: "get", handler: "reposicoesListar", tag: "Reposição", auth: "membro", summary: "Reposições em andamento." },
  { path: "/reposicoes/{id}/assumir", method: "post", handler: "reposicoesAssumir", tag: "Reposição", auth: "membro", summary: "Assume a etapa atual da reposição do remédio (`id` = id do remédio). Exige acesso completo." },
  { path: "/reposicoes/{id}/avancar", method: "post", handler: "reposicoesAvancar", tag: "Reposição", auth: "membro", summary: "Conclui a etapa atual (`id` = id do remédio).", body: { properties: { quantidade: { type: "number", description: "Etapa Comprado: unidades que entraram." } } } },
  { path: "/receitas", method: "get", handler: "receitasListar", tag: "Receitas", auth: "membro", summary: "Receitas da família (exige acesso completo e permissão de ver receitas)." },
  { path: "/receitas/{id}/arquivos", method: "get", handler: "receitasArquivos", tag: "Receitas", auth: "membro", summary: "Páginas da receita com URL assinada de curta duração (auditado)." },
  { path: "/arquivos/receita/{fileId}", method: "get", handler: "arquivoReceita", tag: "Receitas", auth: "assinada", summary: "Entrega a página pela URL assinada (vale de 5 a 10 min; presa à pessoa, ao arquivo e à família)." },
  { path: "/pacientes", method: "get", handler: "pacientesListar", tag: "Cadastros", auth: "membro", summary: "Pacientes da família." },
  { path: "/remedios", method: "get", handler: "remediosListar", tag: "Cadastros", auth: "membro", summary: "Remédios da família." },
  {
    path: "/conversa/mensagem", method: "post", handler: "conversaMensagem", tag: "Conversa", auth: "remetente",
    summary: "Conversa em código (sem IA): código de verificação/convite, tomei, 1/2, lembrar de novo, eu cuido disso, estoque, próximas doses, ajuda. `intent: \"livre\"` = não casou (o agente de IA chega no Lote 4B).",
    body: { required: ["messageId"], properties: { messageId: msg, texto: { type: "string" }, acao: { type: "string", enum: ["tomei", "lembrar", "cuido", "estoque", "proximas", "ajuda"] } } },
  },
  { path: "/telefone/verificar", method: "post", handler: "telefoneVerificar", tag: "Conversa", auth: "remetente", summary: "Rota pré-membro: o dono do número envia o código de 6 dígitos mostrado no portal.", body: { required: ["codigo"], properties: { codigo: { type: "string", description: "6 dígitos" } } } },
  { path: "/lembretes/pendentes", method: "get", handler: "lembretesPendentes", tag: "Fila de saída", auth: "fila", summary: "Lembretes de dose (e dose esquecida) a enviar AGORA, já decididos (quem, texto, dedupe). Reivindica com lease de 2 min.", query: { somenteLer: { type: "boolean", description: "Só espia, sem reivindicar." }, limite: { type: "integer" } } },
  { path: "/lembretes/{id}/enviado", method: "post", handler: "lembreteEnviado", tag: "Fila de saída", auth: "fila", summary: "Marca a mensagem como enviada (idempotente). `falhou: true` solta o lease.", body: { properties: { falhou: { type: "boolean" } } } },
  { path: "/avisos/estoque", method: "get", handler: "avisosEstoque", tag: "Fila de saída", auth: "fila", summary: "Avisos de estoque baixo, receita vencendo e reposição a enviar agora (quem pode comprar).", query: { somenteLer: { type: "boolean" }, limite: { type: "integer" } } },
  { path: "/avisos/resumo", method: "get", handler: "avisosResumo", tag: "Fila de saída", auth: "fila", summary: "Resumo diário a enviar agora.", query: { somenteLer: { type: "boolean" }, limite: { type: "integer" } } },
  { path: "/sistema/fila", method: "get", handler: "filaCompleta", tag: "Sistema", auth: "plataforma", summary: "Toda a fila pendente, de todos os tipos (diagnóstico; use somenteLer=1).", query: { somenteLer: { type: "boolean" }, limite: { type: "integer" } } },
  { path: "/sistema/saude", method: "get", handler: "sistemaSaude", tag: "Sistema", auth: "plataforma", summary: "Teste de conexão: `{ ok, versao }`." },
  { path: "/openapi.json", method: "get", handler: "openapi", tag: "Sistema", auth: "publica", summary: "Este documento." },
];

const AUTH_TEXT: Record<AuthKind, string> = {
  membro: "Bearer (cdf_ ou cpl_) + X-Telefone de um membro com número VERIFICADO.",
  remetente: "Bearer cpl_ (escopo conversa) + X-Telefone do remetente real.",
  fila: "Bearer cdf_ (a própria família) ou cpl_ (todas as famílias).",
  plataforma: "Bearer cpl_.",
  assinada: "URL assinada de curta duração (sem Bearer).",
  publica: "Pública.",
};

function params(r: RouteSpec) {
  const p: Array<Record<string, unknown>> = [];
  for (const m of r.path.matchAll(/\{(\w+)\}/g)) p.push({ name: m[1], in: "path", required: true, schema: { type: "string", format: "uuid" } });
  for (const [name, prop] of Object.entries(r.query ?? {})) p.push({ name, in: "query", required: false, schema: prop });
  if (r.auth === "membro" || r.auth === "remetente") {
    p.push({ name: "X-Telefone", in: "header", required: true, schema: { type: "string", pattern: "^[0-9]{10,15}$" }, description: "Só dígitos: DDI + DDD + número." });
  }
  if (r.method === "post" && r.auth !== "assinada") p.push({ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 200 }, description: "Repetir a mesma chave devolve a resposta guardada (24 h)." });
  return p;
}

const ERROS = {
  "400": { $ref: "#/components/responses/Erro" }, "401": { $ref: "#/components/responses/Erro" }, "403": { $ref: "#/components/responses/Erro" },
  "404": { $ref: "#/components/responses/Erro" }, "422": { $ref: "#/components/responses/Erro" }, "429": { $ref: "#/components/responses/Erro" },
};

export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    (paths[r.path] ??= {})[r.method] = {
      operationId: r.handler,
      tags: [r.tag],
      summary: r.summary,
      description: `Autenticação: ${AUTH_TEXT[r.auth]}`,
      ...(r.auth === "publica" || r.auth === "assinada" ? { security: [] } : { security: [{ bearer: [] }] }),
      parameters: params(r),
      ...(r.body ? { requestBody: { required: !!r.body.required?.length, content: { "application/json": { schema: { type: "object", ...(r.body.required ? { required: r.body.required } : {}), properties: r.body.properties } } } } } : {}),
      responses: { "200": { description: "Sucesso. Corpo: { dados }.", content: { "application/json": { schema: { $ref: "#/components/schemas/Sucesso" } } } }, ...ERROS },
    };
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "MedCuidar API v1",
      version: API_VERSION,
      description: "API pública do MedCuidar. As regras de negócio moram aqui; o worker do WhatsApp e as integrações só roteiam e enviam. Erros: { erro: { codigo, mensagem, detalhes? } }.",
    },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Chave `cdf_...` (família) ou `cpl_...` (plataforma, escopo conversa)." } },
      schemas: {
        Sucesso: { type: "object", properties: { dados: {} } },
        Erro: { type: "object", required: ["erro"], properties: { erro: { type: "object", required: ["codigo", "mensagem"], properties: { codigo: { type: "string" }, mensagem: { type: "string" }, detalhes: {} } } } },
      },
      responses: { Erro: { description: "Erro padronizado.", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } } },
    },
    paths,
  };
}
