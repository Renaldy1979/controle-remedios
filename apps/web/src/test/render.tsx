import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { DataProvider } from "@/data";
import { createMockDataSource } from "@/data/mock/store";
import { OverlayProvider } from "@/components/app/overlay-context";
import { OverlayHost } from "@/components/app/OverlayHost";
import { ToastProvider } from "@/components/ui/Toast";

export const nav = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/", search: "" };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: nav.back, prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

export function renderApp(ui: ReactElement, opts?: { source?: ReturnType<typeof createMockDataSource> }) {
  const source = opts?.source ?? createMockDataSource();
  const utils = render(
    <DataProvider source={source}>
      <ToastProvider>
        <OverlayProvider>
          {ui}
          <OverlayHost />
        </OverlayProvider>
      </ToastProvider>
    </DataProvider>,
  );
  return { ...utils, source };
}
