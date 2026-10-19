"use client";
import type { ReactNode } from "react";
import { useDataKind } from "@/data";

/** Escolhe a tela pela origem dos dados: a completa (mock, desenvolvimento) ou a do lote atual (Postgres). */
export function ByKind({ mock, postgres }: { mock: ReactNode; postgres: ReactNode }) {
  return useDataKind() === "postgres" ? <>{postgres}</> : <>{mock}</>;
}
