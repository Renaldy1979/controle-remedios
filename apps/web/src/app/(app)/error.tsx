"use client";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Layout";

/** Falha ao carregar os dados (rede ou servidor): mensagem calma e "Tentar de novo". Nada de detalhe técnico na tela. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon="cloud_off"
      title="Não deu para carregar agora"
      text="Confira a internet. Se continuar assim, avise quem cuida do sistema."
      action={
        <Button icon="refresh" onClick={reset}>
          Tentar de novo
        </Button>
      }
    />
  );
}
