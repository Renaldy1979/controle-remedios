"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";

/**
 * Login por código de 6 dígitos enviado no WhatsApp (docs/01 RF0).
 * Fase 2: simulado. A resposta é a mesma para número cadastrado ou não (RF0.2).
 * Código "000000" mostra o estado de erro; qualquer outro código de 6 dígitos entra.
 */
export function LoginScreen() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const sendCode = () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 11) {
      setErr("Confira o número com DDD, por exemplo (11) 91234-5678.");
      return;
    }
    setErr("");
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setStep("code");
      setWait(30);
    }, 500);
  };

  const verify = () => {
    if (!/^\d{6}$/.test(code)) return setErr("O código tem 6 números.");
    if (code === "000000") return setErr("Esse código não confere. Confira a mensagem no WhatsApp ou peça um novo.");
    setErr("");
    setBusy(true);
    setTimeout(() => router.push("/"), 400);
  };

  return (
    <main id="conteudo" className="grid min-h-dvh desk:grid-cols-2">
      <section className="hidden flex-col justify-between bg-br p-12 text-onbr desk:flex" aria-hidden="true">
        <span className="flex items-center gap-3 font-display text-t1 font-extrabold">
          <Icon name="medication" size={40} />
          MedCuidar
        </span>
        <div>
          <p className="font-display text-display font-extrabold">Cada remédio na hora certa.</p>
          <p className="mt-3 max-w-[420px] text-body-lg opacity-90">Lembretes no WhatsApp, estoque que avisa antes de acabar e receitas guardadas em segurança.</p>
        </div>
        <span className="text-cap opacity-80">Para a família cuidar junta.</span>
      </section>

      <section className="flex items-center justify-center p-4 desk:p-12">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <span className="flex items-center gap-2.5 font-display text-t2 font-extrabold desk:hidden">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-br text-onbr">
              <Icon name="medication" size={26} />
            </span>
            MedCuidar
          </span>
          <div>
            <h1 className="font-display text-t1 font-extrabold">{step === "phone" ? "Entrar" : "Digite o código"}</h1>
            <p className="mt-1 text-ink2">{step === "phone" ? "Vamos enviar um código de 6 números no seu WhatsApp." : "Se o número estiver cadastrado, o código chegou no WhatsApp. Ele vale por poucos minutos."}</p>
          </div>

          {step === "phone" ? (
            <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
              <TextField label="Celular com DDD" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 91234-5678" value={phone} error={err} onChange={(e) => { setPhone(e.target.value); setErr(""); }} />
              <Button type="submit" size="lg" icon="chat" loading={busy} loadingText="Enviando…">
                Receber código
              </Button>
            </form>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); verify(); }}>
              <TextField
                label="Código de 6 números"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className="num text-center text-time tracking-[0.4em]"
                value={code}
                error={err}
                onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setErr(""); }}
              />
              <Button type="submit" size="lg" icon="login" loading={busy} loadingText="Entrando…">
                Entrar
              </Button>
              <Button
                variant="secondary"
                disabled={wait > 0}
                icon="refresh"
                onClick={() => {
                  setWait(30);
                  toast({ icon: "chat", message: "Enviamos um novo código" });
                }}
              >
                {wait > 0 ? `Reenviar código em ${wait} s` : "Reenviar código"}
              </Button>
              <Button variant="ghost" onClick={() => { setStep("phone"); setCode(""); setErr(""); }}>
                Trocar o número
              </Button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
