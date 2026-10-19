import { Suspense } from "react";
import { ByKind } from "@/components/app/ByKind";
import { PatientsScreen } from "@/components/screens/PatientsScreen";
import { PatientsOverview } from "@/components/screens/lote1/PatientsOverview";

export default function Page() {
  return (
    <Suspense>
      <ByKind mock={<PatientsScreen />} postgres={<PatientsOverview />} />
    </Suspense>
  );
}
