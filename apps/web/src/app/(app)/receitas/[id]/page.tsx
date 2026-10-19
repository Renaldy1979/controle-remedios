import { ByKind } from "@/components/app/ByKind";
import { RxDetailScreen } from "@/components/screens/RxDetailScreen";
import { ComingSoon } from "@/components/screens/lote1/ComingSoon";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ByKind mock={<RxDetailScreen id={id} />} postgres={<ComingSoon icon="description" title="As receitas chegam no Lote 3" lot="Lote 3" what="Aqui você vai ver cada receita, suas páginas e quem já viu." />} />;
}
