"use client";
/**
 * Camada de dados única das telas. Hoje conectada a mocks tipados; na Fase 3 basta
 * passar outra implementação de DataSource ao <DataProvider source={...}>.
 * Nenhum componente conhece a origem dos dados.
 */
import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { can, type PermissionKey } from "@medcuidar/shared";
import { createMockDataSource } from "./mock/store";
import type { Actions, ConnectionStatus, DataSource, Snapshot } from "./types";

export type * from "./types";

const DataContext = createContext<DataSource | null>(null);

export function DataProvider({ children, source }: { children: ReactNode; source?: DataSource }) {
  const [ds] = useState(() => source ?? createMockDataSource());
  return <DataContext.Provider value={ds}>{children}</DataContext.Provider>;
}

function useSource(): DataSource {
  const ds = useContext(DataContext);
  if (!ds) throw new Error("Hooks de dados exigem <DataProvider>");
  return ds;
}

export function useSnapshot(): Snapshot {
  const ds = useSource();
  return useSyncExternalStore(ds.subscribe, ds.getSnapshot, ds.getSnapshot);
}

const ONLINE: ConnectionStatus = { offline: false, dataAsOf: "" };

/** Estado da conexão (só a origem real tem). Offline: as telas seguem com os últimos dados e oferecem "Tentar de novo". */
export function useConnection(): ConnectionStatus & { retry: () => Promise<void> } {
  const ds = useSource();
  const status = useSyncExternalStore(ds.subscribe, ds.connection?.getStatus ?? (() => ONLINE), () => ONLINE);
  return { ...status, retry: ds.connection?.retry ?? (async () => undefined) };
}

export function useDataKind(): "mock" | "appwrite" {
  return useSource().kind;
}

export function usePreviewStockDays(): (medId: string, delta: number) => number | Promise<number> {
  return useSource().previewStockDays;
}

export function useActions(): Actions {
  return useSource().actions;
}

/** Permissão do membro logado, via `can` de @medcuidar/shared. */
export function useCan(permission: PermissionKey): boolean {
  const { member } = useSnapshot();
  return useMemo(() => can(member, permission), [member, permission]);
}
