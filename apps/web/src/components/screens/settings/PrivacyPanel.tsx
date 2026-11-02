"use client";
import { useState } from "react";
import { useSnapshot } from "@/data";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { CONTROLLER, DELETION_GRACE_DAYS } from "@/lib/privacy";
import { pedirExclusaoAction } from "@/server/pg/privacy-actions";

/**
 * Configurações › Privacidade e dados. Todos leem a política; exportar e excluir são do Administrador
 * (o servidor também recusa quem não é: ver server/pg/privacy.ts).
 */
export function PrivacyPanel() {
  const { member } = useSnapshot();
  const admin = member.profileName === "Administrador";
  return (
    <div className="flex max-w-[760px] flex-col gap-6">
      <section aria-label="Política de privacidade" className="flex flex-col gap-3 rounded-lg border border-bd bg-sf p-4">
        <h2 className="font-display text-t2 font-bold">Política de privacidade</h2>
        <p className="text-ink2">O MedCuidar guarda dados de saúde. Veja quais dados, para quê, com quem passam e por quanto tempo.</p>
        <div>
          <ButtonLink href="/privacidade" variant="secondary" icon="policy" target="_blank" rel="noopener">
            Ler a política
          </ButtonLink>
        </div>
        <p className="text-cap text-ink2">Dúvidas e pedidos sobre seus dados: {CONTROLLER.email}.</p>
      </section>
      {admin ? (
        <>
          <ExportCard />
          <DeleteCard />
        </>
      ) : (
        <p className="flex items-start gap-2 text-ink2">
          <Icon name="lock" size={22} className="mt-0.5 flex-none" />
          Exportar e excluir os dados da família é com quem administra a família.
        </p>
      )}
    </div>
  );
}

function ExportCard() {
  return (
    <section aria-label="Exportar os dados" className="flex flex-col gap-3 rounded-lg border border-bd bg-sf p-4">
      <h2 className="font-display text-t2 font-bold">Exportar os dados da família</h2>
      <p className="text-ink2">Baixa um arquivo com tudo o que está cadastrado: pessoas, pacientes, remédios, esquemas, doses, estoque, receitas (sem as fotos), avisos e o histórico. As fotos das receitas continuam na tela de receitas.</p>
      <div>
        <ButtonLink href="/api/family-export" variant="secondary" icon="download" download>
          Baixar os dados
        </ButtonLink>
      </div>
    </section>
  );
}

function DeleteCard() {
  const { family } = useSnapshot();
  const familyName = family.name;
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const confirmar = async () => {
    setBusy(true);
    setErro("");
    const r = await pedirExclusaoAction(nome);
    if (!r.ok) {
      setBusy(false);
      return setErro(r.message);
    }
    toast({ icon: "check_circle", message: "Exclusão agendada" });
    window.location.assign("/exclusao-agendada");
  };
  return (
    <section aria-label="Excluir a família" className="flex flex-col gap-3 rounded-lg border border-ms-bd bg-sf p-4">
      <h2 className="font-display text-t2 font-bold">Excluir a família</h2>
      <p className="text-ink2">
        Apaga de vez todos os dados da família: pacientes, remédios, doses, estoque, receitas (inclusive as fotos), avisos, histórico e as contas de acesso de todas as pessoas.
        Fica agendado por {DELETION_GRACE_DAYS} dias: nesse prazo ninguém usa o sistema e você pode cancelar. Depois disso não há como recuperar.
      </p>
      {aberto ? (
        <div className="flex flex-col gap-3">
          <TextField label={`Para confirmar, digite o nome da família: ${familyName ?? ""}`} value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" error={erro || undefined} />
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" icon="delete_forever" loading={busy} loadingText="Agendando…" disabled={!nome.trim()} onClick={() => void confirmar()}>
              Agendar a exclusão
            </Button>
            <Button variant="ghost" onClick={() => { setAberto(false); setNome(""); setErro(""); }}>
              Desistir
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="dangerOutline" icon="delete_forever" onClick={() => setAberto(true)}>
            Excluir a família…
          </Button>
        </div>
      )}
    </section>
  );
}
