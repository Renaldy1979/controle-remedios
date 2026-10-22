#!/usr/bin/env node
// Valida os fluxos do N8N em integrations/n8n/fluxos/*.json. Sai com código 1 se houver erro. Roda também nos testes (validar.test.ts).
// Checa: JSON válido; cada nó com type/typeVersion/position; nomes únicos; conexões consistentes; fluxo sem nó solto;
// nenhum segredo literal e nenhum $env; URLs só no nó Config; credenciais por nome certo; webhooks; chamadas HTTP sem redirect;
// o agente de IA (01b): só ferramentas HTTP GET de leitura, nenhuma com parâmetro de telefone, X-Telefone fixado pelo fluxo;
// fluxos de agenda com tratamento de erro; "Marca enviada" só depois de envio OK; código dos nós Code = lib atual e com sintaxe válida;
// arquivos JSON iguais ao que o gerador produz agora (nada editado à mão).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CRED_API, CRED_EVO, DIR_FLUXOS, FLUXOS, LIB } from "./build.mjs";

const SEGREDOS = [
  [/cdf_[0-9a-zA-Z_-]{16,}/, "chave de API da família"],
  [/cpl_[0-9a-zA-Z_-]{16,}/, "chave de plataforma"],
  [/whsec_[0-9a-f]{16,}/i, "segredo de webhook"],
  [/sk-ant-[\w-]{10,}/i, "chave Anthropic"],
  [/AIza[0-9A-Za-z_-]{30,}/, "chave Google"],
  [/Bearer\s+[A-Za-z0-9._-]{16,}/, "token Bearer"],
  [/"(apikey|api_key|apiKey|password|senha|secret|token|instanceId)"\s*:\s*"(?!=)[^"]{8,}"/, "campo de segredo preenchido"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "chave privada"],
];
const TELEFONE = /telefone|phone|celular|whats|numero|número|remetente|number/i;
const TIPOS_AI = new Set(["ai_languageModel", "ai_memory", "ai_tool", "ai_outputParser"]);
const ROTAS_LEITURA = ["/estoque", "/doses/proximas", "/doses/dia", "/reposicoes", "/receitas", "/pacientes", "/remedios"];
const ROTAS_PROIBIDAS_AGENTE = /\/confirmar|\/desfazer|\/registrar|\/lembrar|\/assumir|\/avancar|\/conversa|\/telefone|\/enviado|\/arquivos|\/sistema/i;
const X_TELEFONE_FIXO = "={{ $('Entrada do 01').first().json.telefone }}";

/** Valida UM fluxo (objeto já lido). `bruto` é o texto do arquivo. Devolve a lista de erros. */
export function validarFluxo(arq, wf, bruto = JSON.stringify(wf)) {
  const erros = [];
  const erro = (msg) => erros.push(`${arq}: ${msg}`);

  if (typeof wf.name !== "string" || !wf.name) erro("workflow sem name");
  if (!Array.isArray(wf.nodes) || !wf.nodes.length) { erro("sem nodes"); return erros; }
  if (typeof wf.connections !== "object" || !wf.connections) erro("sem connections");
  if (wf.active === true) erro("workflow deve ser exportado desligado (active: false)");

  const porNome = new Map();
  for (const n of wf.nodes) {
    if (!n.name) erro("nó sem name");
    if (porNome.has(n.name)) erro(`nome duplicado: ${n.name}`);
    porNome.set(n.name, n);
    if (typeof n.type !== "string" || !n.type.includes(".")) erro(`nó "${n.name}" sem type válido`);
    if (typeof n.typeVersion !== "number") erro(`nó "${n.name}" sem typeVersion numérico`);
    if (!Array.isArray(n.position) || n.position.length !== 2) erro(`nó "${n.name}" sem position`);
    if (!n.parameters || typeof n.parameters !== "object") erro(`nó "${n.name}" sem parameters`);
    for (const c of Object.values(n.credentials ?? {})) if (!c?.name) erro(`nó "${n.name}" com credencial sem nome`);
  }
  if (!wf.nodes.some((n) => /trigger|webhook/i.test(n.type) && n.type !== "n8n-nodes-base.respondToWebhook")) erro("sem nó de gatilho");

  // conexões
  const conectados = new Set();
  const entradas = new Map();
  for (const [de, porTipo] of Object.entries(wf.connections ?? {})) {
    if (!porNome.has(de)) erro(`conexão de nó inexistente: ${de}`);
    conectados.add(de);
    for (const [tipo, saidas] of Object.entries(porTipo)) {
      if (tipo !== "main" && !TIPOS_AI.has(tipo)) erro(`tipo de conexão desconhecido: ${tipo}`);
      saidas.forEach((saida, idx) => {
        for (const alvo of saida ?? []) {
          if (!porNome.has(alvo.node)) erro(`conexão ${de} → ${alvo.node}: destino inexistente`);
          if (alvo.type !== tipo) erro(`conexão ${de} → ${alvo.node}: tipo ${alvo.type} ≠ ${tipo}`);
          conectados.add(alvo.node);
          (entradas.get(alvo.node) ?? entradas.set(alvo.node, []).get(alvo.node)).push({ de, idx, tipo });
        }
      });
    }
  }
  for (const n of wf.nodes) if (!conectados.has(n.name) && n.type !== "n8n-nodes-base.stickyNote") erro(`nó "${n.name}" sem conexão`);

  // segredos e variáveis de ambiente
  if (/\$env\b/.test(bruto)) erro("usa $env; guarde segredos em Credenciais do N8N");
  for (const [re, oque] of SEGREDOS) if (re.test(bruto)) erro(`possível segredo literal (${oque})`);

  // URLs só no nó Config (e nas notas); nenhuma URL literal em outro nó
  for (const n of wf.nodes) {
    if (n.name === "Config" || n.type === "n8n-nodes-base.stickyNote") continue;
    const texto = JSON.stringify(n.parameters);
    if (/https?:\/\//i.test(texto)) erro(`nó "${n.name}" tem URL literal; URLs ficam só no nó Config`);
  }
  const temHttp = wf.nodes.some((n) => /httpRequest|toolHttpRequest|emailSend/i.test(n.type));
  if (temHttp && !porNome.has("Config")) erro('falta o nó "Config" (URLs e limites)');
  const cfg = porNome.get("Config");
  if (cfg) for (const a of cfg.parameters?.assignments?.assignments ?? []) {
    if (/key|token|senha|password|secret|apikey/i.test(a.name) && String(a.value ?? "").length > 0) erro(`Config.${a.name} parece guardar segredo`);
  }

  // webhooks
  for (const n of wf.nodes.filter((x) => x.type === "n8n-nodes-base.webhook")) {
    const p = String(n.parameters.path ?? "");
    if (/^05/.test(arq)) {
      if (n.parameters.authentication !== "headerAuth" || !n.credentials?.httpHeaderAuth?.name) erro(`webhook "${n.name}" sem Header Auth (segredo do teste)`);
    } else {
      if (n.parameters.authentication !== "none" || !/^medcuidar-(whatsapp|captura)-[A-Za-z0-9_-]{6,}$/.test(p)) erro(`webhook "${n.name}" deve ser auth none com caminho medcuidar-(whatsapp|captura)-<código>`);
    }
    if (!n.parameters.responseMode) erro(`webhook "${n.name}" sem responseMode`);
  }

  // chamadas HTTP
  for (const n of wf.nodes.filter((x) => x.type === "n8n-nodes-base.httpRequest")) {
    const o = n.parameters.options ?? {};
    if (o.redirect?.redirect?.followRedirects !== false) erro(`nó "${n.name}" segue redirect (followRedirects deve ser false)`);
    const url = String(n.parameters.url ?? "");
    const cred = n.credentials ? Object.entries(n.credentials)[0] : undefined;
    if (/apiBase/.test(url)) {
      if (cred?.[1]?.name !== CRED_API.httpHeaderAuth.name) erro(`nó "${n.name}" chama a API sem a credencial "${CRED_API.httpHeaderAuth.name}"`);
      if (/cdf_/.test(JSON.stringify(n.parameters))) erro(`nó "${n.name}" usa chave de família; o N8N usa só a chave de plataforma`);
    } else if (/evolutionBase/.test(url)) {
      if (!/\/server\/ok$/.test(url) && cred?.[1]?.name !== CRED_EVO.httpCustomAuth.name) erro(`nó "${n.name}" chama a Evolution Go sem a credencial "${CRED_EVO.httpCustomAuth.name}"`);
    } else erro(`nó "${n.name}" chama uma URL que não vem do Config`);
    if (n.parameters.sendHeaders) {
      for (const h of n.parameters.headerParameters?.parameters ?? []) {
        if (/^(authorization|apikey|x-api-key)$/i.test(h.name)) erro(`nó "${n.name}" põe ${h.name} no fluxo; use só a credencial`);
      }
    }
  }

  // conversa: telefone só no cabeçalho, vindo do remetente; corpo sem telefone; idempotência por mensagem
  const conversa = porNome.get("Conversa (API)");
  if (conversa) {
    const hs = Object.fromEntries((conversa.parameters.headerParameters?.parameters ?? []).map((h) => [h.name, h.value]));
    if (hs["X-Telefone"] !== "={{ $json.telefone }}") erro('"Conversa (API)" deve enviar X-Telefone = remetente normalizado');
    if (!hs["Idempotency-Key"]) erro('"Conversa (API)" sem Idempotency-Key');
    if (conversa.parameters.jsonBody !== "={{ JSON.stringify($json.corpo) }}") erro('"Conversa (API)" deve enviar só o corpo montado pela lib');
  }

  // agente de IA (01b): só leitura, sem telefone vindo da IA
  if (/^01b/.test(arq)) {
    const ferramentas = wf.nodes.filter((n) => (wf.connections?.[n.name]?.ai_tool ?? []).length > 0);
    if (!ferramentas.length) erro("o agente não tem ferramentas");
    for (const f of ferramentas) {
      if (f.type !== "@n8n/n8n-nodes-langchain.toolHttpRequest") { erro(`ferramenta "${f.name}" não é HTTP (só toolHttpRequest é permitido)`); continue; }
      const p = f.parameters;
      if (String(p.method ?? "GET").toUpperCase() !== "GET") erro(`ferramenta "${f.name}" não é GET: o agente só lê`);
      if (p.sendBody) erro(`ferramenta "${f.name}" tem corpo: o agente só lê`);
      const url = String(p.url ?? "");
      const rota = url.replace(/^=?\{\{[^}]*apiBase \}\}/, "");
      if (!ROTAS_LEITURA.includes(rota)) erro(`ferramenta "${f.name}" usa rota fora da lista de leitura: ${rota}`);
      if (ROTAS_PROIBIDAS_AGENTE.test(rota)) erro(`ferramenta "${f.name}" usa rota de escrita/sistema`);
      if (/\{[^}]*telefone[^}]*\}/i.test(url)) erro(`ferramenta "${f.name}" tem placeholder de telefone na URL`);
      if (p.placeholderDefinitions) for (const d of p.placeholderDefinitions.values ?? []) if (TELEFONE.test(d.name)) erro(`ferramenta "${f.name}" tem parâmetro de telefone (${d.name})`);
      for (const [campo, lista] of [["parametersQuery", p.parametersQuery], ["parametersBody", p.parametersBody]]) {
        for (const v of lista?.values ?? []) {
          if (TELEFONE.test(v.name)) erro(`ferramenta "${f.name}" tem parâmetro de telefone em ${campo} (${v.name})`);
          if (/^model/.test(v.valueProvider) && !/^(data)$/.test(v.name)) erro(`ferramenta "${f.name}" deixa a IA escolher "${v.name}" (só "data" é permitido)`);
        }
      }
      const hs = p.parametersHeaders?.values ?? [];
      for (const h of hs) if (/^model/.test(h.valueProvider)) erro(`ferramenta "${f.name}" deixa a IA escolher o cabeçalho ${h.name}`);
      const tel = hs.find((h) => h.name === "X-Telefone");
      if (!tel || tel.valueProvider !== "fieldValue" || tel.value !== X_TELEFONE_FIXO) erro(`ferramenta "${f.name}" sem X-Telefone fixado pelo fluxo (remetente do 01)`);
      if (!f.credentials?.httpHeaderAuth || f.credentials.httpHeaderAuth.name !== CRED_API.httpHeaderAuth.name) erro(`ferramenta "${f.name}" sem a credencial "${CRED_API.httpHeaderAuth.name}"`);
    }
    for (const n of wf.nodes) if (n.type === "n8n-nodes-base.httpRequest") erro(`nó "${n.name}": o 01b não faz chamadas HTTP fora das ferramentas`);
    if (!wf.nodes.some((n) => n.type === "@n8n/n8n-nodes-langchain.lmChatAnthropic" && n.credentials?.anthropicApi?.name)) erro("falta o modelo Anthropic com credencial por nome");
  }

  // agenda: tratamento de erro
  if (wf.nodes.some((n) => n.type === "n8n-nodes-base.scheduleTrigger")) {
    const comRamoDeErro = wf.nodes.some((n) => n.onError === "continueErrorOutput" && (wf.connections?.[n.name]?.main?.[1] ?? []).some((a) => porNome.get(a.node)?.type === "n8n-nodes-base.stopAndError"));
    const http = wf.nodes.filter((n) => n.type === "n8n-nodes-base.httpRequest");
    const todasTratadas = http.length > 0 && http.every((n) => n.onError === "continueRegularOutput" || n.onError === "continueErrorOutput");
    if (!comRamoDeErro && !todasTratadas) erro("fluxo de agenda sem tratamento de erro (ramo de erro → Stop and Error, ou chamadas com onError)");
  }

  // "marcar como enviada" só depois de envio OK
  const marca = porNome.get("Marca enviada");
  if (marca) {
    const ent = entradas.get("Marca enviada") ?? [];
    const ok = ent.length === 1 && ent[0].idx === 0 && ent[0].de === "Envio ok?"
      && /\$json\.ok === true/.test(JSON.stringify(porNome.get("Envio ok?")?.parameters ?? {}));
    if (!ok) erro('"Marca enviada" só pode vir da saída verdadeira de "Envio ok?" (falha de envio nunca marca como enviada)');
    const falha = porNome.get("Marca falha");
    if (!falha || !/falhou/.test(String(falha.parameters.jsonBody))) erro('falta "Marca falha" (POST { falhou: true }) para soltar a mensagem em caso de erro de envio');
  }

  // Code: sintaxe válida e lib atual
  for (const n of wf.nodes.filter((x) => x.type === "n8n-nodes-base.code")) {
    const js = String(n.parameters.jsCode ?? "");
    try { new Function("$", "$input", "$getWorkflowStaticData", `return (async () => {\n${js}\n})`); }
    catch (e) { erro(`nó Code "${n.name}" com erro de sintaxe: ${e.message}`); }
    if (js.includes("// ---- lib/evolution.ts") && !js.includes(LIB)) erro(`nó Code "${n.name}" com lib desatualizada; rode pnpm n8n:build`);
    if (/require\(|import\s|process\.env/.test(js.replace(LIB, ""))) erro(`nó Code "${n.name}" usa require/import/process.env`);
  }

  return erros;
}

/** Valida todos os arquivos de `dir` e confere que são idênticos ao que o gerador produz agora. */
export function validarTudo(dir = DIR_FLUXOS, { conferirGerador = true } = {}) {
  const erros = [];
  const arquivos = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  for (const esperado of Object.keys(FLUXOS)) if (!arquivos.includes(esperado)) erros.push(`${esperado}: arquivo ausente (rode pnpm n8n:build)`);
  for (const arq of arquivos) if (!(arq in FLUXOS)) erros.push(`${arq}: fluxo que o gerador não produz (apague o arquivo)`);
  for (const arq of arquivos) {
    const bruto = readFileSync(path.join(dir, arq), "utf8");
    let wf;
    try { wf = JSON.parse(bruto); } catch (e) { erros.push(`${arq}: JSON inválido: ${e.message}`); continue; }
    erros.push(...validarFluxo(arq, wf, bruto));
    if (conferirGerador && arq in FLUXOS && JSON.stringify(FLUXOS[arq](), null, 2) + "\n" !== bruto) erros.push(`${arq}: diferente do gerador; rode pnpm n8n:build (não edite o JSON à mão)`);
  }
  return erros;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const erros = validarTudo();
  if (erros.length) {
    console.error(`n8n:validar — ${erros.length} problema(s):\n` + erros.map((e) => `  ✗ ${e}`).join("\n"));
    process.exit(1);
  }
  console.log(`n8n:validar — ${Object.keys(FLUXOS).length} fluxos OK`);
}
void fileURLToPath;
