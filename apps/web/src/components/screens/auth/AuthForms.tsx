"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import type { FormState } from "@/server/pg/auth-actions";
import * as auth from "@/server/pg/auth-actions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Controls";
import { TextField } from "@/components/ui/Field";
import { FormNotice } from "./AuthFrame";

const initial: FormState = {};
const linkClass = "inline-flex min-h-touch items-center font-bold text-br underline-offset-2 hover:underline";

/** Campo de senha com "Mostrar a senha" (a pessoa confere o que digitou; vale para quem digita com dificuldade). */
function Passwords({ confirm = false, label = "Senha", autoComplete }: { confirm?: boolean; label?: string; autoComplete: "current-password" | "new-password" }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <TextField label={label} name="senha" type={show ? "text" : "password"} autoComplete={autoComplete} required minLength={autoComplete === "new-password" ? 8 : undefined} hint={autoComplete === "new-password" ? "Pelo menos 8 caracteres." : undefined} />
      {confirm ? <TextField label="Repita a senha" name="confirmar" type={show ? "text" : "password"} autoComplete="new-password" required /> : null}
      <Checkbox checked={show} onChange={setShow} label="Mostrar a senha" />
    </>
  );
}

export function SignInForm({ notice }: { notice?: { kind: "error" | "ok"; text: string } }) {
  const [state, action, pending] = useActionState(auth.signIn, initial);
  const [remember, setRemember] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-4">
      {notice ? <FormNotice kind={notice.kind}>{notice.text}</FormNotice> : null}
      {state.error ? <FormNotice kind="error">{state.error}</FormNotice> : null}
      <TextField label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" required defaultValue={state.values?.["email"]} />
      <Passwords autoComplete="current-password" />
      <input type="hidden" name="lembrar" value={remember ? "1" : ""} />
      <Checkbox checked={remember} onChange={setRemember} label="Manter conectado neste aparelho" />
      <Button type="submit" size="lg" icon="login" loading={pending} loadingText="Entrando…">
        Entrar
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <Link href="/esqueci-senha" className={linkClass}>
          Esqueci minha senha
        </Link>
        <Link href="/criar-conta" className={linkClass}>
          Criar conta
        </Link>
      </div>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(auth.signUp, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error ? <FormNotice kind="error">{state.error}</FormNotice> : null}
      <TextField label="Seu nome" name="nome" autoComplete="name" required minLength={2} defaultValue={state.values?.["nome"]} />
      <TextField label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" required defaultValue={state.values?.["email"]} hint="Enviaremos um e-mail para você confirmar que ele é seu." />
      <Passwords confirm autoComplete="new-password" />
      <Button type="submit" size="lg" icon="person_add" loading={pending} loadingText="Criando…">
        Criar conta
      </Button>
      <p className="text-ink2">
        Já tem conta?{" "}
        <Link href="/login" className={linkClass}>
          Entrar
        </Link>
      </p>
    </form>
  );
}

/** Tela "confira seu e-mail": reenviar (a cada 2 min) e "Já confirmei". */
export function VerifyPending({ email }: { email: string }) {
  const [resent, resend, resending] = useActionState(async () => auth.resendVerification(), initial);
  const [checked, check, checking] = useActionState(async () => auth.checkEmailConfirmed(), initial);
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg border border-bd bg-sf p-4">
        Enviamos um e-mail para <strong className="break-all">{email}</strong>. Abra a mensagem e toque no botão para confirmar.
        <span className="mt-1 block text-cap text-ink2">Não chegou? Veja a caixa de spam e espere um minuto.</span>
      </p>
      {resent.error ? <FormNotice kind="error">{resent.error}</FormNotice> : null}
      {resent.ok ? <FormNotice kind="ok">{resent.ok}</FormNotice> : null}
      {checked.error ? <FormNotice kind="error">{checked.error}</FormNotice> : null}
      <form action={check}>
        <Button type="submit" size="lg" icon="mark_email_read" full loading={checking} loadingText="Conferindo…">
          Já confirmei
        </Button>
      </form>
      <form action={resend}>
        <Button type="submit" variant="secondary" icon="forward_to_inbox" full loading={resending} loadingText="Enviando…">
          Enviar o e-mail de novo
        </Button>
      </form>
      <form action={auth.signOut}>
        <Button type="submit" variant="ghost" icon="logout" full>
          Sair
        </Button>
      </form>
    </div>
  );
}

/** Clique do botão confirma (prévias de e-mail não gastam o link). */
export function ConfirmEmailForm({ userId, secret }: { userId: string; secret: string }) {
  const [state, action, pending] = useActionState(auth.confirmEmail, initial);
  if (state.ok)
    return (
      <div className="flex flex-col gap-4">
        <FormNotice kind="ok">{state.ok}</FormNotice>
        <ButtonLink href="/criar-familia" size="lg" icon="arrow_forward" full>
          Continuar
        </ButtonLink>
      </div>
    );
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error ? <FormNotice kind="error">{state.error}</FormNotice> : null}
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="secret" value={secret} />
      <Button type="submit" size="lg" icon="verified" loading={pending} loadingText="Confirmando…">
        Confirmar meu e-mail
      </Button>
    </form>
  );
}

export function CreateFamilyForm({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState(auth.createFamily, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error ? <FormNotice kind="error">{state.error}</FormNotice> : null}
      <TextField label="Nome da família" name="nomeFamilia" defaultValue={state.values?.["nomeFamilia"] ?? defaultName} required minLength={2} maxLength={80} hint="Por exemplo: Família Souza. Você poderá convidar as outras pessoas depois." />
      <Button type="submit" size="lg" icon="groups" loading={pending} loadingText="Criando…">
        Criar a família
      </Button>
      <p className="text-cap text-ink2">Você será o(a) Administrador(a): pode convidar pessoas, cadastrar pacientes e ajustar o que cada perfil pode fazer.</p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(auth.forgotPassword, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error ? <FormNotice kind="error">{state.error}</FormNotice> : null}
      {state.ok ? <FormNotice kind="ok">{state.ok}</FormNotice> : null}
      <TextField label="E-mail da sua conta" name="email" type="email" autoComplete="email" inputMode="email" required defaultValue={state.values?.["email"]} />
      <Button type="submit" size="lg" icon="forward_to_inbox" loading={pending} loadingText="Enviando…">
        Enviar o link
      </Button>
      <Link href="/login" className={linkClass}>
        Voltar para entrar
      </Link>
    </form>
  );
}

export function ResetPasswordForm({ userId, secret }: { userId: string; secret: string }) {
  const [state, action, pending] = useActionState(auth.resetPassword, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error ? <FormNotice kind="error">{state.error}</FormNotice> : null}
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="secret" value={secret} />
      <Passwords confirm label="Nova senha" autoComplete="new-password" />
      <Button type="submit" size="lg" icon="lock_reset" loading={pending} loadingText="Salvando…">
        Salvar a nova senha
      </Button>
    </form>
  );
}

export function AcceptInviteForm({ token, userId, secret, name, familyName, profileName }: { token: string; userId: string; secret: string; name: string; familyName: string; profileName: string }) {
  const [state, action, pending] = useActionState(auth.acceptInvite, initial);
  const [resent, resend, resending] = useActionState(auth.resendInviteEmail, initial);
  const needsNewEmail = !userId || !secret;
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg border border-bd bg-sf p-4">
        Olá, <strong>{name}</strong>! Você foi convidado(a) para a <strong>{familyName}</strong> com o perfil <strong>{profileName}</strong>. Crie uma senha para entrar.
      </p>
      {needsNewEmail ? (
        <FormNotice kind="error">Abra o link que chegou no e-mail do convite. Se não achar, peça um novo abaixo.</FormNotice>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          {state.error ? <FormNotice kind="error">{state.error}</FormNotice> : null}
          <input type="hidden" name="t" value={token} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="secret" value={secret} />
          <Passwords confirm label="Crie uma senha" autoComplete="new-password" />
          <Button type="submit" size="lg" icon="login" loading={pending} loadingText="Entrando…">
            Criar senha e entrar
          </Button>
        </form>
      )}
      <form action={resend} className="flex flex-col gap-2 border-t border-bd pt-4">
        <input type="hidden" name="t" value={token} />
        {resent.error ? <FormNotice kind="error">{resent.error}</FormNotice> : null}
        {resent.ok ? <FormNotice kind="ok">{resent.ok}</FormNotice> : null}
        <p className="text-cap text-ink2">O link do e-mail vale por pouco tempo. Se der erro, peça um novo.</p>
        <Button type="submit" variant="secondary" icon="forward_to_inbox" loading={resending} loadingText="Enviando…">
          Enviar um novo e-mail
        </Button>
      </form>
    </div>
  );
}
