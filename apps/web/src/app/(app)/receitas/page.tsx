import { ByKind } from "@/components/app/ByKind";
import { RxListScreen } from "@/components/screens/RxListScreen";
import { ComingSoon } from "@/components/screens/lote1/ComingSoon";

export default function Page() {
  return <ByKind mock={<RxListScreen />} postgres={<ComingSoon icon="description" title="As receitas chegam no Lote 3" lot="Lote 3" what="Aqui você vai anexar fotos das receitas, ver a validade e acompanhar a reposição." />} />;
}
