import { ByKind } from "@/components/app/ByKind";
import { HistoryScreen } from "@/components/screens/HistoryScreen";
import { ComingSoon } from "@/components/screens/lote1/ComingSoon";

export default function Page() {
  return <ByKind mock={<HistoryScreen />} postgres={<ComingSoon icon="history" title="O histórico chega no Lote 2" lot="Lote 2" what="Aqui vão aparecer as doses tomadas, atrasadas e esquecidas, com quem deu e quando." />} />;
}
