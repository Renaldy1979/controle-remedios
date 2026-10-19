import { EmptyState } from "@/components/ui/Layout";

/** Área que ainda não existe no lote atual: explica com calma, sem erro e sem parecer quebrada. */
export function ComingSoon({ icon, title, lot, what }: { icon: string; title: string; lot: string; what: string }) {
  return <EmptyState icon={icon} title={title} text={`${what} Esta parte chega no ${lot}. Por enquanto você já pode cadastrar pacientes, remédios e esquemas e convidar a família.`} />;
}
