"use client";
import { useState } from "react";
import { useActions, useDataKind, useSnapshot, type InviteResult, type MemberInput, type PersonVM } from "@/data";
import { Avatar } from "@/components/ui/Avatar";
import { PageAction } from "@/components/app/PageAction";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/Chip";
import { RadioGroup } from "@/components/ui/Controls";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { SelectField, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { maskPhone } from "@/lib/phone";

/** Quem está na escala de cuidado (só na origem mock): remover exige digitar REMOVER (RF1.9). */
const ON_SCHEDULE = new Set(["Rosa", "Lúcia", "Seu João"]);

function AccessChips({ p }: { p: PersonVM }) {
  if (!p.accessState) return <StatusChip compact tone={p.whatsappActive ? "ok" : "lt"} icon={p.whatsappActive ? "check_circle" : "schedule"} label={p.whatsappActive ? "WhatsApp ativo" : "Convite pendente"} />;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {p.active === false ? (
        <StatusChip compact tone="neu" icon="block" label="Desativado(a)" />
      ) : p.accessState === "active" ? (
        <StatusChip compact tone="ok" icon="check_circle" label="Ativo(a)" />
      ) : p.accessState === "whatsapp_verified" ? (
        <StatusChip compact tone="pn" icon="chat" label="Só WhatsApp" />
      ) : (
        <StatusChip compact tone="lt" icon="schedule" label={p.invite?.expired ? "Convite vencido" : "Convite pendente"} />
      )}
      {p.accessState !== "invited" ? (
        p.whatsappActive ? (
          <StatusChip compact tone="ok" icon="chat" label="WhatsApp verificado" />
        ) : p.phonePending ? (
          <StatusChip compact tone="lt" icon="schedule" label="WhatsApp pendente" />
        ) : (
          <StatusChip compact tone="neu" icon="phone_disabled" label="Sem WhatsApp" />
        )
      ) : null}
    </div>
  );
}

export function UsersPanel() {
  const snap = useSnapshot();
  const kind = useDataKind();
  const actions = useActions();
  const toast = useToast();
  const [removing, setRemoving] = useState<PersonVM | null>(null);
  const [revoking, setRevoking] = useState<PersonVM | null>(null);
  const [editing, setEditing] = useState<PersonVM | "new" | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const real = kind === "postgres";

  const resend = async (p: PersonVM) => {
    const r = await actions.resendInvite(p.id);
    if (!r) return;
    setResult(r);
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Pessoas">
        <PageAction>
          <Button icon="person_add" onClick={() => setEditing("new")}>
            Convidar pessoa
          </Button>
        </PageAction>
        <h2 className="mb-3 font-display text-t2 font-bold">Pessoas da família</h2>
        <ul className="divide-y divide-bd rounded-lg border border-bd bg-sf">
          {snap.people.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
              <Avatar name={p.name} role={p.role} size={44} whatsapp={p.whatsappActive} />
              <div className="min-w-0 flex-1 basis-56">
                <p className="font-bold">
                  {p.name}
                  {p.relation ? <span className="font-normal text-ink2"> · {p.relation}</span> : null}
                  {p.isSelf ? <span className="font-normal text-ink2"> · você</span> : null}
                </p>
                <p className="text-cap text-ink2">
                  {p.profileName}
                  {p.email ? <> · <span className="break-all">{p.email}</span></> : null}
                  {p.phone ? <> · <span className="num">{p.phone}</span></> : null}
                </p>
                {p.invite ? <p className="text-cap text-ink2">Convite por {p.invite.kind === "email" ? "e-mail" : "WhatsApp"} · vale até {p.invite.expiresLabel}</p> : null}
                {real && p.phonePending && !p.whatsappActive ? <p className="text-cap text-ink2">WhatsApp informado, aguardando o código de validação</p> : null}
              </div>
              <AccessChips p={p} />
              <div className="flex flex-wrap">
                <Button variant="ghost" size="sm" icon="edit" aria-label={`Editar ${p.name}`} onClick={() => setEditing(p)}>
                  Editar
                </Button>
                {p.accessState === "invited" ? (
                  <>
                    <Button variant="ghost" size="sm" icon="forward_to_inbox" aria-label={`${p.invite?.kind === "whatsapp" ? "Gerar novo código para" : "Reenviar convite a"} ${p.name}`} onClick={() => void resend(p)}>
                      {p.invite?.kind === "whatsapp" ? "Novo código" : "Reenviar"}
                    </Button>
                    <Button variant="ghost" size="sm" icon="cancel" aria-label={`Cancelar convite de ${p.name}`} onClick={() => setRevoking(p)}>
                      Cancelar convite
                    </Button>
                  </>
                ) : p.active === false ? (
                  <Button variant="ghost" size="sm" icon="person_check" aria-label={`Reativar ${p.name}`} onClick={async () => { if ((await actions.reactivateMember(p.id)) !== false) toast({ icon: "person_check", message: `${p.name} foi reativada(o)` }); }}>
                    Reativar
                  </Button>
                ) : !p.isSelf ? (
                  <Button variant="ghost" size="sm" icon="person_remove" aria-label={`${real ? "Desativar" : "Remover"} ${p.name}`} onClick={() => setRemoving(p)}>
                    {real ? "Desativar" : "Remover"}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex items-center gap-2 text-cap text-ink2">
          <Icon name="info" size={16} />
          {real
            ? "Desativar tira o acesso na hora e encerra as sessões da pessoa. Dá para reativar depois."
            : "Quem está na escala de cuidado (cuidadoras e Seu João) só sai depois de digitar REMOVER."}
        </p>
      </section>

      {editing ? (
        <MemberDialog
          person={editing === "new" ? null : editing}
          profiles={snap.profiles}
          real={real}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === "new") {
              const r = await actions.inviteMember(input);
              if (!r) return false;
              setEditing(null);
              setResult(r);
              return true;
            }
            if ((await actions.updateMember(editing.id, input)) === false) return false;
            setEditing(null);
            toast({ icon: "check_circle", message: `${input.name} atualizada(o)` });
            return true;
          }}
        />
      ) : null}

      {result ? <InviteResultDialog result={result} onClose={() => setResult(null)} /> : null}

      {removing ? (
        <ConfirmDialog
          title={`${real ? "Desativar" : "Remover"} ${removing.name}?`}
          description={
            real
              ? `${removing.name} perde o acesso agora e as sessões abertas são encerradas. Os registros dela(e) continuam guardados e dá para reativar depois.`
              : ON_SCHEDULE.has(removing.name)
                ? `${removing.name} está na escala de doses. Sem essa pessoa, alguns horários ficam sem responsável.`
                : `${removing.name} deixa de receber avisos da família.`
          }
          confirmLabel={real ? "Desativar pessoa" : "Remover pessoa"}
          requireWord={!real && ON_SCHEDULE.has(removing.name) ? "REMOVER" : undefined}
          icon="person_remove"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const who = removing;
            setRemoving(null);
            if ((await actions.removeMember(who.id)) === false) return;
            toast({ icon: "person_remove", message: `${who.name} foi ${real ? "desativada(o)" : "removida(o)"}` });
          }}
        />
      ) : null}

      {revoking ? (
        <ConfirmDialog
          title={`Cancelar o convite de ${revoking.name}?`}
          description="O link e o código deixam de funcionar. Você pode convidar de novo quando quiser."
          confirmLabel="Cancelar convite"
          icon="cancel"
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            const who = revoking;
            setRevoking(null);
            if ((await actions.revokeInvite(who.id)) === false) return;
            toast({ icon: "cancel", message: `Convite de ${who.name} cancelado` });
          }}
        />
      ) : null}
    </div>
  );
}

function MemberDialog({ person, profiles, real, onClose, onSave }: { person: PersonVM | null; profiles: string[]; real: boolean; onClose: () => void; onSave: (i: MemberInput) => Promise<boolean> }) {
  const [kind, setKind] = useState<"email" | "whatsapp">("email");
  const [name, setName] = useState(person?.name ?? "");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState(person && !real ? person.phone : "");
  const [profile, setProfile] = useState(person?.profileName ?? profiles.find((p) => p === "Familiar") ?? profiles[0] ?? "");
  const [relation, setRelation] = useState(person ? person.relation.split(" · ")[0]! : "");
  const [err, setErr] = useState<{ name?: string; phone?: string; email?: string }>({});
  const [busy, setBusy] = useState(false);
  const inviting = !person;
  const needsPhone = !real || (inviting && kind === "whatsapp");
  const needsEmail = real && inviting && kind === "email";

  const submit = async () => {
    const e: typeof err = {};
    if (!name.trim()) e.name = "Informe o nome.";
    if (needsPhone && phone.replace(/\D/g, "").length < 10) e.phone = "Confira o número com DDD, por exemplo (11) 91234-5678.";
    if (needsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = "Confira o e-mail, por exemplo nome@exemplo.com.";
    setErr(e);
    if (e.name || e.phone || e.email) return;
    setBusy(true);
    await onSave({ name: name.trim(), phone, email: email.trim(), profileName: profile, relation, ...(inviting ? { kind } : {}) });
    setBusy(false);
  };

  return (
    <Dialog
      title={person ? `Editar ${person.name}` : "Convidar pessoa"}
      icon={person ? "edit" : "person_add"}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {person ? "Salvar" : kind === "email" || !real ? "Convidar" : "Gerar código"}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(ev) => { ev.preventDefault(); void submit(); }}>
        {real && inviting ? (
          <RadioGroup
            name="invite-kind"
            legend="Como convidar"
            value={kind}
            onChange={setKind}
            options={[
              { value: "email", label: "Por e-mail", description: "A pessoa recebe um link, confirma o e-mail e cria a senha." },
              { value: "whatsapp", label: "Por código de WhatsApp", description: "Para quem usa mais o WhatsApp. A pessoa envia o código ao WhatsApp do sistema." },
            ]}
          />
        ) : null}
        <TextField label="Nome" data-autofocus value={name} error={err.name} onChange={(e) => setName(e.target.value)} />
        {needsEmail ? <TextField label="E-mail" type="email" inputMode="email" autoComplete="off" value={email} error={err.email} onChange={(e) => setEmail(e.target.value)} /> : null}
        {needsPhone ? (
          <TextField
            label={real ? "Celular com DDD (o código só vale deste número)" : "Celular com DDD (WhatsApp)"}
            type="tel"
            inputMode="tel"
            value={phone}
            error={err.phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        ) : null}
        <SelectField label="Perfil" value={profile} onChange={(e) => setProfile(e.target.value)}>
          {profiles.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </SelectField>
        <TextField label="Relação" optional hint="Ex.: filha, cuidadora, sobrinho" value={relation} onChange={(e) => setRelation(e.target.value)} />
      </form>
    </Dialog>
  );
}

/** O código do convite por WhatsApp aparece UMA vez; o servidor guarda só o hash. */
function InviteResultDialog({ result, onClose }: { result: InviteResult; onClose: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const isCode = result.kind === "whatsapp" && result.code;
  return (
    <Dialog
      title={isCode ? `Código para ${result.memberName}` : result.emailSent === false ? "Convite criado, e-mail não enviado" : `Convite enviado a ${result.memberName}`}
      icon={isCode ? "pin" : result.emailSent === false ? "warning" : "mark_email_read"}
      iconTone={result.kind === "email" && result.emailSent === false ? "lt" : "br"}
      size="md"
      onClose={onClose}
      footer={<Button onClick={onClose}>Entendi</Button>}
    >
      {isCode ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg border border-bd bg-sf2 p-4 text-center">
            <span className="block text-cap text-ink2">Código de uso único</span>
            <span className="num block text-display font-extrabold tracking-[0.3em]" aria-label={`Código ${result.code!.split("").join(" ")}`}>
              {result.code}
            </span>
          </p>
          <Button
            variant="secondary"
            icon={copied ? "check" : "content_copy"}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(result.code!);
                setCopied(true);
              } catch {
                toast({ icon: "info", message: "Não deu para copiar. Anote o código." });
              }
            }}
          >
            {copied ? "Código copiado" : "Copiar código"}
          </Button>
          <p className="flex items-start gap-2 font-bold text-lt">
            <Icon name="warning" size={22} className="mt-0.5 flex-none" />
            Anote ou copie agora: este código aparece só uma vez e não dá para ver depois.
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-ink2">
            <li>Vale só para o número {result.expectedPhone ? <strong className="num text-ink">{maskPhone(result.expectedPhone)}</strong> : null} e por uma vez.</li>
            <li>Vence em {result.expiresLabel} (24 horas).</li>
            <li>
              <strong>A pessoa envia este código ao WhatsApp do sistema</strong>, pelo número informado. Em seguida recebe o link para definir e-mail e senha.
            </li>
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {result.emailSent === false ? (
            <p className="flex items-start gap-2 font-bold text-lt">
              <Icon name="warning" size={22} className="mt-0.5 flex-none" />
              Não conseguimos enviar o e-mail agora (confira o envio de e-mails no Appwrite). Use &quot;Reenviar&quot; na lista quando estiver certo.
            </p>
          ) : (
            <p>
              Enviamos um e-mail com um link. {result.memberName} confirma o e-mail, cria a senha e já entra com o perfil escolhido. O link vale até {result.expiresLabel}.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

