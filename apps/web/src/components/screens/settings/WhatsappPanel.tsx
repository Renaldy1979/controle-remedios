"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import {
  criarChaveAction, estadoWhatsappAction, gerarSegredoN8nAction, reenviarLinkAcessoAction, revogarChaveAction, salvarWebhookN8nAction, testarN8nAction,
  type ChaveWa, type EstadoWa, type N8nVm, type PessoaWa,
} from "@/server/wa/actions";
import { WhatsappNumberCard } from "./WhatsappNumberCard";

const ACESSO: Record<PessoaWa["acesso"], string> = { invited: "Convidado", whatsapp_verified: "WhatsApp verificado", active: "Acesso completo" };

/** Configurações › WhatsApp: meu número, estado do número de cada pessoa e chaves de API (valor mostrado uma vez). */
export function WhatsappPanel() {
  const [estado, setEstado] = useState<EstadoWa | null>(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(async () => {
    const r = await estadoWhatsappAction();
    if (r.ok) setEstado(r.data);
    else setErro(r.message);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <p role="alert" className="text-ms">{erro}</p>;
  if (!estado) return <p className="text-ink2">Carregando…</p>;
  return (
    <div className="flex max-w-[860px] flex-col gap-6">
      <WhatsappNumberCard onChange={() => void carregar()} />
      <PessoasCard pessoas={estado.pessoas} onChange={carregar} />
      {estado.admin ? (
        <>
          <ChavesCard titulo="Chaves de API da família" ajuda="Chaves cdf_… dão acesso à API só desta família (sempre junto com o X-Telefone de uma pessoa com número verificado)." tipo="familia" chaves={estado.chaves} onChange={carregar} />
          {estado.chavesPlataforma ? (
            <ChavesCard titulo="Chave da plataforma (N8N)" ajuda="Chaves cpl_… (escopo conversa) valem para TODAS as famílias do sistema. Use só uma, no N8N do Lote 4B." tipo="plataforma" chaves={estado.chavesPlataforma} onChange={carregar} />
          ) : null}
        </>
      ) : null}
      {estado.n8n ? <N8nCard n8n={estado.n8n} onChange={carregar} /> : null}
      {estado.simulador ? (
        <ButtonLink href="/configuracoes/simulador" variant="secondary" icon="forum">
          Abrir o simulador de WhatsApp
        </ButtonLink>
      ) : null}
    </div>
  );
}

function PessoasCard({ pessoas, onChange }: { pessoas: PessoaWa[]; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [link, setLink] = useState<{ nome: string; url: string } | null>(null);
  if (pessoas.length === 0) return null;
  const reenviar = async (p: PessoaWa) => {
    setBusy(p.id);
    const r = await reenviarLinkAcessoAction(p.id);
    setBusy("");
    if (!r.ok) return toast({ icon: "error", message: r.message, error: true });
    setLink({ nome: p.nome, url: r.data.link });
    toast({ icon: "check_circle", message: "Link novo criado e enviado ao WhatsApp da pessoa" });
    await onChange();
  };
  return (
    <section aria-label="Pessoas e WhatsApp" className="flex flex-col gap-3 rounded-lg border border-bd bg-sf p-4">
      <h2 className="font-display text-t2 font-bold">Pessoas</h2>
      <p className="text-ink2">Quem não tem o número verificado não recebe nada no WhatsApp: vê os avisos no portal (sino).</p>
      <ul className="flex flex-col divide-y divide-bd">
        {pessoas.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold">
                {p.nome}
                {p.eu ? <span className="font-normal text-ink2"> (você)</span> : null}
              </p>
              <p className="text-cap text-ink2">
                {p.perfil} · {ACESSO[p.acesso]}
                {p.telefone ? ` · ${p.telefone}` : ""}
              </p>
            </div>
            {p.numero === "verificado" ? (
              <StatusChip compact tone="ok" icon="check_circle" label="Número verificado" />
            ) : p.numero === "pendente" ? (
              <StatusChip compact tone="lt" icon="schedule" label="Número pendente" />
            ) : (
              <StatusChip compact tone="neu" icon="phone_disabled" label="Sem número" />
            )}
            {p.acesso === "whatsapp_verified" ? (
              <Button size="sm" variant="secondary" icon="link" onClick={() => void reenviar(p)} loading={busy === p.id} loadingText="Criando…">
                Reenviar link de acesso
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {link ? (
        <div role="status" className="rounded-lg border-2 border-br bg-brt p-3">
          <p className="font-bold">Link de {link.nome} (uso único, vale 24 h)</p>
          <p className="break-all text-cap">{link.url}</p>
          <p className="mt-1 text-cap text-ink2">Ele também foi para a fila do WhatsApp dessa pessoa. Mostrado só agora.</p>
        </div>
      ) : null}
    </section>
  );
}

function ChavesCard({ titulo, ajuda, tipo, chaves, onChange }: { titulo: string; ajuda: string; tipo: "familia" | "plataforma"; chaves: ChaveWa[]; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState("");
  const [nova, setNova] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  const criar = async () => {
    setBusy("criar");
    setErro("");
    const r = await criarChaveAction(nome, tipo);
    setBusy("");
    if (!r.ok) return setErro(r.message);
    setNova(r.data.chave);
    setNome("");
    await onChange();
  };
  const revogar = async (id: string) => {
    setBusy(id);
    const r = await revogarChaveAction(id, tipo);
    setBusy("");
    if (!r.ok) return toast({ icon: "error", message: r.message, error: true });
    toast({ icon: "check_circle", message: "Chave revogada" });
    await onChange();
  };
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(nova ?? "");
      toast({ icon: "content_copy", message: "Chave copiada" });
    } catch {
      toast({ icon: "error", message: "Não deu para copiar. Selecione o texto e copie.", error: true });
    }
  };

  return (
    <section aria-label={titulo} className="flex flex-col gap-3 rounded-lg border border-bd bg-sf p-4">
      <h2 className="font-display text-t2 font-bold">{titulo}</h2>
      <p className="text-ink2">{ajuda} A chave aparece <strong>uma só vez</strong>, ao criar; depois só o nome fica visível.</p>
      {nova ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border-2 border-br bg-brt p-3">
          <p className="flex items-center gap-2 font-bold">
            <Icon name="key" size={22} /> Copie agora: esta chave não será mostrada de novo
          </p>
          <code className="break-all rounded-md bg-sf p-2 text-body">{nova}</code>
          {tipo === "plataforma" ? (
            <p className="text-cap">
              No N8N, abra <strong>Credenciais › Criar credencial › Header Auth</strong>, dê o nome <strong>MedCuidar API</strong>, em “Name” escreva <code>Authorization</code> e em “Value” escreva <code>Bearer </code> seguido desta chave (com um espaço depois de “Bearer”). Se perder a chave, revogue e crie outra.
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button size="sm" icon="content_copy" onClick={() => void copiar()}>
              Copiar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNova(null)}>
              Já copiei
            </Button>
          </div>
        </div>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void criar();
        }}
      >
        <div className="min-w-[220px] flex-1">
          <TextField label="Nome da nova chave" placeholder={tipo === "familia" ? "Ex.: Planilha da Rosa" : "Ex.: N8N do staging"} value={nome} error={erro} onChange={(e) => { setNome(e.target.value); setErro(""); }} />
        </div>
        <Button type="submit" icon="add" loading={busy === "criar"} loadingText="Criando…">
          Criar chave
        </Button>
      </form>
      {chaves.length === 0 ? (
        <p className="text-ink2">Nenhuma chave criada.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-bd">
          {chaves.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{k.nome}</p>
                <p className="text-cap text-ink2">
                  {k.prefixo}… · criada {k.criadaEm} · último uso: {k.ultimoUso}
                </p>
              </div>
              {k.revogada ? (
                <StatusChip compact tone="neu" icon="block" label="Revogada" />
              ) : (
                <Button size="sm" variant="dangerOutline" icon="block" onClick={() => void revogar(k.id)} loading={busy === k.id} loadingText="Revogando…">
                  Revogar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-cap text-ink2">
        Documentação das rotas: <Link href="/api/v1/openapi.json" className="font-bold text-br underline" target="_blank">/api/v1/openapi.json</Link>
      </p>
    </section>
  );
}

/** Ligação com o N8N: URL do webhook do fluxo 05, segredo do teste e o botão Testar conexão (só Administrador). */
function N8nCard({ n8n, onChange }: { n8n: N8nVm; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [url, setUrl] = useState(n8n.url ?? "");
  const [erroUrl, setErroUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [segredo, setSegredo] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ok: boolean; mensagem: string } | null>(null);

  const salvar = async () => {
    setBusy("url");
    setErroUrl("");
    const r = await salvarWebhookN8nAction(url);
    setBusy("");
    if (!r.ok) return setErroUrl(r.message);
    setResultado(null);
    toast({ icon: "check_circle", message: "Endereço salvo" });
    await onChange();
  };
  const gerar = async () => {
    setBusy("segredo");
    const r = await gerarSegredoN8nAction();
    setBusy("");
    if (!r.ok) return toast({ icon: "error", message: r.message, error: true });
    setSegredo(r.data.segredo);
    setResultado(null);
    await onChange();
  };
  const testar = async () => {
    setBusy("teste");
    setResultado(null);
    const r = await testarN8nAction();
    setBusy("");
    if (!r.ok) return setResultado({ ok: false, mensagem: r.message });
    setResultado({ ok: r.data.ok, mensagem: r.data.mensagem });
    await onChange();
  };
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(segredo ?? "");
      toast({ icon: "content_copy", message: "Segredo copiado" });
    } catch {
      toast({ icon: "error", message: "Não deu para copiar. Selecione o texto e copie.", error: true });
    }
  };

  return (
    <section aria-label="Ligação com o N8N" className="flex flex-col gap-3 rounded-lg border border-bd bg-sf p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-t2 font-bold">WhatsApp do sistema (N8N)</h2>
        {n8n.estado === "conectado" ? (
          <StatusChip compact tone="ok" icon="check_circle" label="N8N conectado" />
        ) : (
          <StatusChip compact tone="lt" icon="schedule" label="Aguardando conexão" />
        )}
      </div>
      <p className="text-ink2">
        {n8n.estado === "conectado"
          ? `Último teste OK em ${n8n.teste?.em ?? ""}${n8n.teste?.versao ? ` · fluxos versão ${n8n.teste.versao}` : ""}. O número do WhatsApp é conectado na Evolution Go (passo a passo em docs/11).`
          : "WhatsApp do sistema: aguardando conexão. Importe os fluxos no N8N, ative o fluxo 05 e preencha abaixo; depois toque em Testar conexão."}
      </p>

      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
        <div className="min-w-[260px] flex-1">
          <TextField
            label="Endereço do webhook do fluxo 05 (Teste de conexão)"
            placeholder="https://seu-n8n.exemplo.com.br/webhook/medcuidar-teste-conexao"
            value={url}
            error={erroUrl}
            onChange={(e) => { setUrl(e.target.value); setErroUrl(""); }}
          />
        </div>
        <Button type="submit" variant="secondary" icon="save" loading={busy === "url"} loadingText="Salvando…">
          Salvar endereço
        </Button>
      </form>
      <p className="text-cap text-ink2">Use o endereço de <strong>produção</strong> do webhook (sem “webhook-test”), só https e público.</p>

      {segredo ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border-2 border-br bg-brt p-3">
          <p className="flex items-center gap-2 font-bold">
            <Icon name="key" size={22} /> Copie agora: este segredo não será mostrado de novo
          </p>
          <code className="break-all rounded-md bg-sf p-2 text-body">{segredo}</code>
          <p className="text-cap">
            No N8N: <strong>Credenciais › Criar credencial › Header Auth</strong>, nome <strong>MedCuidar Teste de conexão</strong>, “Name” = <code>X-MedCuidar-Token</code> e “Value” = este segredo.
          </p>
          <div className="flex gap-3">
            <Button size="sm" icon="content_copy" onClick={() => void copiar()}>Copiar</Button>
            <Button size="sm" variant="ghost" onClick={() => setSegredo(null)}>Já copiei</Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" icon="key" onClick={() => void gerar()} loading={busy === "segredo"} loadingText="Gerando…">
          {n8n.temSegredo ? "Gerar novo segredo" : "Gerar segredo"}
        </Button>
        <Button icon="network_check" onClick={() => void testar()} loading={busy === "teste"} loadingText="Testando…" disabled={!n8n.url || !n8n.temSegredo}>
          Testar conexão
        </Button>
      </div>
      {!n8n.url || !n8n.temSegredo ? <p className="text-cap text-ink2">Para testar: salve o endereço e gere o segredo.</p> : null}
      {resultado ? (
        <p role="status" className={`flex items-start gap-2 rounded-lg border-2 p-3 font-bold ${resultado.ok ? "border-ok bg-ok-bg" : "border-ms-bd bg-ms-bg"}`}>
          <Icon name={resultado.ok ? "check_circle" : "error"} size={22} />
          <span>{resultado.mensagem}</span>
        </p>
      ) : null}
    </section>
  );
}
