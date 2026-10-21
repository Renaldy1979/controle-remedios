/** Foto de receita tirada no celular: gira e reduz no próprio aparelho antes de enviar (menos dados, mais rápido). PDF e formatos que o navegador não abre seguem como estão. */

const MAX_SIDE = 2400;
const QUALITY = 0.85;
const DECODABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Gira `quarters` vezes 90° (sentido horário) e reduz o lado maior para 2400 px. Devolve o arquivo original se não precisar (ou não conseguir) mexer. */
export async function preparePage(file: File, quarters: number): Promise<File> {
  const rot = ((quarters % 4) + 4) % 4;
  if (!DECODABLE.has(file.type) || typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (rot === 0 && scale === 1 && file.size <= 3 * 1024 * 1024) return file; // já está leve e na posição certa
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = rot % 2 ? h : w;
    canvas.height = rot % 2 ? w : h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 2);
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", QUALITY));
    if (!blob || (rot === 0 && blob.size >= file.size)) return file;
    return new File([blob], "pagina.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
