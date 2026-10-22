"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { formatPhone } from "@/lib/phone";
import {
  simEnviarAction, simFilaAction, simMarcarEnviadaAction, simPessoasAction, type FalarComo, type FilaSim,
} from "@/server/wa/actions";

interface Bolha {
  de: "eu" | "sistema" | "aviso";
  texto: string;
}

const NOVO = "novo";
const ATALHOS: Array<{ rotulo: string; texto: string }> = [
  { rotulo: "Tomei", texto: "tomei" },
  { rotulo: "1", texto: "1" },
  { rotulo: "2", texto: "2" },
  { rotulo: "Lembrar de novo", texto: "lembrar de novo" },
  { rotulo: "Eu cuido disso", texto: "eu cuido disso" },
  { rotulo: "Estoque", texto: "estoque" },
  { rotulo: "Próximas doses", texto: "próximas doses" },
  { rotulo: "Ajuda", texto: "ajuda" },
];

/** Negrito do WhatsApp (*texto*) e itálico (_texto_) para a leitura da conversa. */
function Texto({ t }: { t: string }) {
  const partes = t.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return (
    <>
      {partes.map((p, i) =>
        p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <strong key={i}>{p.slice(1, -1)}</strong> : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

/** Simulador de WhatsApp: fala com a MESMA rota que o N8N usará. Nenhuma mensagem real é enviada. */
export function SimulatorPanel() {
  const toast = useToast();
  const [pessoas, setPessoas] = useState<FalarComo[]>([]);
  const [como, setComo] = useState("");
  const [novoNumero, setNovoNumero] = useState("");
  const [texto, setTexto] = useState("");
  const [conversas, setConversas] = useState<Record<string, Bolha[]>>({});
  const [fila, setFila] = useState<FilaSim[]>([]);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const fim = useRef<HTMLDivElement>(null);

  const telefone = como === NOVO ? novoNumero : (pessoas.find((p) => p.id === como)?.telefone ?? "");
  const chave = como === NOVO ? `novo:${novoNumero.replace(/\D/g, "")}` : como;
  const bolhas = conversas[chave] ?? [];

  const carregarFila = useCallback(async () => {
    const r = await simFilaAction();
    if (r.ok) setFila(r.data);
    else setErro(r.message);
  }, []);

  useEffect(() => {
    void simPessoasAction().then((r) => {
      if (!r.ok) return setErro(r.message);
      setPessoas(r.data);
      setComo((c) => c || (r.data.find((p) => p.situacao === "verificado") ?? r.data[0])?.id || NOVO);
    });
    void carregarFila();
  }, [carregarFila]);

  useEffect(() => {
    fim.current?.scrollIntoView?.({ block: "end" });
  }, [bolhas.length]);

  const empurrar = (k: string, novas: Bolha[]) => setConversas((c) => ({ ...c, [k]: [...(c[k] ?? []), ...novas] }));

  const enviar = async (msg: string) => {
    const t = msg.trim();
    if (!t || !telefone) return;
    setErro("");
    setBusy(true);
    empurrar(chave, [{ de: "eu", texto: t }]);
    setTexto("");
    const r = await simEnviarAction({ telefone, texto: t });
    setBusy(false);
    if (!r.ok) return empurrar(chave, [{ de: "aviso", texto: r.message }]);
    const novas: Bolha[] = r.data.respostas.map((x) => ({ de: "sistema", texto: x.texto }));
    if (r.data.intent === "livre") novas.push({ de: "aviso", texto: "Texto livre: o agente de IA chega no Lote 4B." });
    empurrar(chave, novas);
    void carregarFila();
    // a verificação do número cria uma "pessoa verificada" nova na lista
    if (r.data.intent === "numero_verificado" || r.data.intent === "convite_aceito") {
      const p = await simPessoasAction();
      if (p.ok) setPessoas(p.data);
    }
  };

  const marcar = async (m: FilaSim) => {
    const r = await simMarcarEnviadaAction(m.id);
    if (!r.ok) return toast({ icon: "error", message: r.message, error: true });
    const dono = pessoas.find((p) => p.telefone === m.telefone);
    if (dono) empurrar(dono.id, [{ de: "sistema", texto: m.texto }]);
    toast({ icon: "check_circle", message: `Marcada como enviada para ${m.para}` });
    await carregarFila();
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="note" className="flex items-center gap-2 rounded-lg border-2 border-lt-bd bg-lt-bg p-3 font-bold text-lt">
        <Icon name="science" size={24} /> Simulador: nenhuma mensagem real é enviada
      </div>
      {erro ? <p role="alert" className="text-ms">{erro}</p> : null}

      <div className="grid gap-4 desk:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section aria-label="Conversa simulada" className="flex min-h-[520px] flex-col overflow-hidden rounded-lg border border-bd bg-sf">
          <div className="flex flex-wrap items-end gap-3 border-b border-bd p-3">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1">
              <span className="text-cap font-bold text-ink2">Falar como</span>
              <select value={como} onChange={(e) => setComo(e.target.value)} className="min-h-touch rounded-md border-[1.5px] border-bd2 bg-sf px-3 text-body">
                {pessoas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} · {formatPhone(p.telefone)} · {p.situacao === "verificado" ? "verificado" : "pendente"}
                  </option>
                ))}
                <option value={NOVO}>Outro número (testar convite ou verificação)…</option>
              </select>
            </label>
            {como === NOVO ? (
              <label className="flex min-w-[200px] flex-col gap-1">
                <span className="text-cap font-bold text-ink2">Número do remetente</span>
                <input value={novoNumero} onChange={(e) => setNovoNumero(e.target.value)} inputMode="tel" placeholder="(11) 91234-5678" className="min-h-touch rounded-md border-[1.5px] border-bd2 bg-sf px-3 text-body" />
              </label>
            ) : null}
          </div>

          <div role="log" aria-label="Mensagens" aria-live="polite" className="flex flex-1 flex-col gap-2 overflow-y-auto bg-bg p-3">
            {bolhas.length === 0 ? <p className="m-auto max-w-[320px] text-center text-ink2">Escreva como se fosse pelo WhatsApp. Ex.: “tomei”, “estoque”, “próximas doses” ou um código de 6 dígitos.</p> : null}
            {bolhas.map((b, i) => (
              <div key={i} className={b.de === "eu" ? "flex justify-end" : "flex justify-start"}>
                <p
                  className={
                    "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 " +
                    (b.de === "eu" ? "bg-brt text-ink" : b.de === "aviso" ? "border border-lt-bd bg-lt-bg text-lt" : "border border-bd bg-sf")
                  }
                >
                  {b.de === "aviso" ? <Icon name="info" size={18} className="mr-1 inline align-text-bottom" /> : null}
                  <Texto t={b.texto} />
                </p>
              </div>
            ))}
            <div ref={fim} />
          </div>

          <div className="flex flex-wrap gap-2 border-t border-bd p-3">
            {ATALHOS.map((a) => (
              <button key={a.rotulo} type="button" disabled={busy || !telefone} onClick={() => void enviar(a.texto)} className="min-h-touch rounded-pill border-[1.5px] border-bd2 bg-sf px-4 font-bold text-br hover:bg-brt disabled:opacity-50">
                {a.rotulo}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2 border-t border-bd p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar(texto);
            }}
          >
            <label className="flex-1">
              <span className="sr-only">Mensagem</span>
              <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Digite uma mensagem" className="min-h-touch w-full rounded-md border-[1.5px] border-bd2 bg-sf px-3 text-body" />
            </label>
            <Button type="submit" icon="send" loading={busy} loadingText="Enviando…" disabled={!telefone || !texto.trim()}>
              Enviar
            </Button>
          </form>
        </section>

        <aside aria-label="Mensagens que o sistema enviaria agora" className="flex flex-col gap-3 rounded-lg border border-bd bg-sf p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-t2 font-bold">Mensagens que o sistema enviaria agora</h2>
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => void carregarFila()}>
              Atualizar
            </Button>
          </div>
          {fila.length === 0 ? (
            <p className="text-ink2">Nada para enviar agora. Lembretes de dose, estoque baixo e resumo aparecem aqui para quem tem número verificado.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {fila.map((m) => (
                <li key={m.id} className="rounded-md border border-bd p-3">
                  <p className="text-cap text-ink2">
                    Para <strong>{m.para}</strong> · {formatPhone(m.telefone)} · {m.tipo}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">
                    <Texto t={m.texto} />
                  </p>
                  <div className="mt-2">
                    <Button size="sm" variant="secondary" icon="done_all" onClick={() => void marcar(m)}>
                      Marcar como enviada
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
