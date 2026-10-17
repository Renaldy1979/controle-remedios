import { Skeleton } from "@/components/ui/Layout";

/** Carregando: blocos com brilho (shimmer) no lugar do conteúdo; o brilho para com prefers-reduced-motion. */
export default function Loading() {
  return (
    <div role="status" aria-label="Carregando" className="flex flex-col gap-4">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-4 desk:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
