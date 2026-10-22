"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { normalizePhone } from "@/lib/phone";
import { estadoWhatsappAction, iniciarVerificacaoAction, removerMeuNumeroAction, type EstadoWa } from "@/server/wa/actions";

/**
 * O número da PRÓPRIA conta e a validação (docs/06 seção 3): informar → o portal mostra um código de 6 dígitos (vale 15 min)
 * → o dono do número envia o código ao WhatsApp do sistema → verificado. Usado em Configurações › WhatsApp e em Minha conta.
 */
export function WhatsappNumberCard({ onChange }: { onChange?: () => void }) {
  const toast = useToast();
  const [eu, setEu] = useState<EstadoWa["eu"] | null>(null);
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [codigo, setCodigo] = useState<{ codigo: string; telefone: string; expiraHora: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await estadoWhatsappAction();
    if (r.ok) {
      setEu(r.data.eu);
      if (r.data.eu.verificado && !r.data.eu.pendente) setCodigo(null);
    }
    return r.ok ? r.data.eu : null;
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // enquanto há código ativo, confere a cada 4 s se o sistema já recebeu o código
  const aguardando = !!codigo && !!eu && !eu.verificado;
  useEffect(() => {
    if (!aguardando) return;
    const t = setInterval(() => {
      void carregar().then((e) => {
        if (e?.verificado && !e.pendente) {
          toast({ icon: "check_circle", message: "WhatsApp verificado!" });
          onChange?.();
        }
      });
    }, 4000);
    return () => clearInterval(t);
  }, [aguardando, carregar, onChange, toast]);

  const gerar = async () => {
    if (!normalizePhone(phone)) return setErr("Confira o número com DDD, por exemplo (11) 91234-5678.");
    setErr("");
    setBusy(true);
    const r = await iniciarVerificacaoAction(phone);
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setCodigo({ codigo: r.data.codigo, telefone: r.data.telefone, expiraHora: r.data.expiraHora });
    setTrocando(false);
    await carregar();
    onChange?.();
  };

  const remover = async () => {
    setBusy(true);
    const r = await removerMeuNumeroAction();
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setCodigo(null);
    setPhone("");
    toast({ icon: "check_circle", message: "Número removido" });
    await carregar();
    onChange?.();
  };

  if (!eu) return <p className="text-ink2">Carregando…</p>;
  const verificado = !!eu.verificado && !eu.pendente;
  const mostrarForm = !verificado || trocando;

  return (
    <section aria-label="Meu número de WhatsApp" className="flex flex-col gap-4 rounded-lg border border-bd bg-sf p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-t2 font-bold">Meu WhatsApp</h2>
        {verificado ? (
          <StatusChip compact tone="ok" icon="check_circle" label="Verificado" />
        ) : eu.pendente ? (
          <StatusChip compact tone="lt" icon="schedule" label="Pendente de validação" />
        ) : (
          <StatusChip compact tone="neu" icon="phone_disabled" label="Não informado" />
        )}
      </div>

      {verificado ? (
        <p className="flex items-start gap-2">
          <Icon name="check_circle" size={22} className="mt-0.5 flex-none text-ok" />
          <span>
            O número <strong>{eu.verificado}</strong> recebe os lembretes e responde “tomei” pelo WhatsApp.
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2 text-ink2">
          <Icon name="info" size={22} className="mt-0.5 flex-none text-br" />
          <span>Sem o número verificado você usa o portal normalmente, mas não recebe mensagens no WhatsApp.</span>
        </p>
      )}

      {codigo && !verificado ? (
        <div role="status" className="flex flex-col gap-2 rounded-lg border-2 border-br bg-brt p-4">
          <p>
            Envie este código, <strong>pelo WhatsApp do número {codigo.telefone}</strong>, para o WhatsApp do sistema:
          </p>
          <p aria-label={`Código ${codigo.codigo.split("").join(" ")}`} className="font-display text-display font-extrabold tracking-[0.2em]">
            {codigo.codigo}
          </p>
          <p className="text-cap text-ink2">Vale até às {codigo.expiraHora} (15 minutos). Um código novo cancela este. Aguardando o envio…</p>
        </div>
      ) : eu.pendente && !verificado ? (
        <p className="text-ink2">
          Número <strong>{eu.pendente}</strong> aguardando o código. {eu.codigoAtivo ? "" : "O código anterior venceu: gere um novo abaixo."}
        </p>
      ) : null}

      {mostrarForm ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void gerar();
          }}
        >
          <TextField
            label="Celular com DDD"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(11) 91234-5678"
            hint="Um número verificado pertence a uma única pessoa em todo o sistema."
            value={phone}
            error={err}
            onChange={(e) => {
              setPhone(e.target.value);
              setErr("");
            }}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" icon="sms" loading={busy} loadingText="Gerando…">
              {eu.pendente || verificado ? "Gerar novo código" : "Gerar código"}
            </Button>
            {trocando ? (
              <Button variant="ghost" onClick={() => setTrocando(false)}>
                Cancelar
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" icon="edit" onClick={() => setTrocando(true)}>
            Trocar número
          </Button>
          <Button variant="dangerOutline" icon="phone_disabled" onClick={() => void remover()} loading={busy} loadingText="Removendo…">
            Remover número
          </Button>
        </div>
      )}
      {!mostrarForm && err ? <p role="alert" className="text-ms">{err}</p> : null}
      {mostrarForm && (eu.verificado || eu.pendente) ? (
        <p className="text-cap text-ink2">Ao trocar o número, o verificado deixa de valer até o novo ser confirmado.</p>
      ) : null}
      {eu.pendente || eu.verificado ? (
        mostrarForm && !verificado ? (
          <div>
            <Button variant="ghost" icon="phone_disabled" onClick={() => void remover()} loading={busy} loadingText="Removendo…">
              Remover número
            </Button>
          </div>
        ) : null
      ) : null}
    </section>
  );
}
