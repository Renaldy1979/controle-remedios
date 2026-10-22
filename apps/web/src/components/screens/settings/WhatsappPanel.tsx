"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import {
  criarChaveAction, estadoWhatsappAction, reenviarLinkAcessoAction, revogarChaveAction, type ChaveWa, type EstadoWa, type PessoaWa,
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
