import { PRIVACY_SECTIONS, PRIVACY_UPDATED } from "@/lib/privacy";

/** Texto da política de privacidade. Sem hooks: serve à página pública e à tela de aceite. */
export function PrivacyPolicy() {
  return (
    <article className="flex flex-col gap-6" aria-label="Política de privacidade">
      <p className="text-cap text-ink2">Versão de {PRIVACY_UPDATED}</p>
      {PRIVACY_SECTIONS.map((sec) => (
        <section key={sec.id} aria-labelledby={`pp-${sec.id}`} className="flex flex-col gap-2">
          <h2 id={`pp-${sec.id}`} className="font-display text-t2 font-extrabold">
            {sec.title}
          </h2>
          {sec.paragraphs.map((p, i) => (
            <p key={i} className="text-body">
              {p}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
