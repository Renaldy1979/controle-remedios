import { Suspense } from "react";
import { PatientsScreen } from "@/components/screens/PatientsScreen";

export default function Page() {
  return (
    <Suspense>
      <PatientsScreen />
    </Suspense>
  );
}
