import { ByKind } from "@/components/app/ByKind";
import { HomeScreen } from "@/components/screens/HomeScreen";
import { Lote1Home } from "@/components/screens/lote1/Lote1Home";

export default function Page() {
  return <ByKind mock={<HomeScreen />} postgres={<Lote1Home />} />;
}
