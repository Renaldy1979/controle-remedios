import { ByKind } from "@/components/app/ByKind";
import { HistoryScreen } from "@/components/screens/HistoryScreen";
import { DoseHistoryScreen } from "@/components/screens/lote2/DoseHistoryScreen";

export default function Page() {
  return <ByKind mock={<HistoryScreen />} postgres={<DoseHistoryScreen />} />;
}
