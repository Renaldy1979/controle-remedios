# Lote 1 (portal) → A (banco): sugestão pequena, não bloqueia nada

**Nenhuma mudança de schema, RLS ou função é necessária para o Lote 1.** O portal usa só o que já existe em `@medcuidar/pg` (`withFamilia`, `resolverMembroPorAppwriteUser`, `resolverLinkPrimeiroAcesso`, `consumirLinkPrimeiroAcesso`, `hashConviteCodigo`, `gerarTokenPrimeiroAcesso`, `gerarCodigoVerificacao`).

## Pedido (opcional) — `packages/pg/src/testing.ts`
`ORDEM_LIMPEZA` apaga `members` antes de `audit_log`, mas `audit_log.actor_member_id` referencia `members`. Quem testa ações administrativas (que geram auditoria) recebe `violates foreign key constraint "audit_log_actor_member_id_members_id_fk"` na limpeza. Pedido: mover `"audit_log"` para antes de `"members"` (por exemplo, logo depois de `"message_log"`). O teste de integração do portal contorna isso apagando `audit_log` antes de chamar `limparFamilias`.

## Como o portal usa os convites (para conferência)
- **Convite por e-mail** reutiliza `first_access_links` (o token vai na URL `…/aceitar-convite?t=<token>`; o Appwrite acrescenta `userId` e `secret` do Magic URL). `resolverLinkPrimeiroAcesso(sha256(t))` descobre membro e família antes de haver sessão; `consumirLinkPrimeiroAcesso` gasta o link ao concluir; depois o portal faz `members.access_state='active'`, `appwrite_user_id`, `email_confirmed_at`. Não foi preciso função nova.
- **Convite por WhatsApp (só a criação, Lote 1):** `invites` kind `whatsapp` com `code_hash = hashConviteCodigo(telefone, código)`; o código é mostrado uma vez e nunca guardado. O uso (`consumirConviteWhatsapp`) é do Lote 4; o teste de integração do portal já confere que o hash gravado é aceito pela função do banco, que o código errado/outro número é recusado e que gerar novo código revoga o anterior.
- **Primeira entrada:** `families` + `profiles` + `members(active)` numa só transação de `withFamilia(<uuid novo>)`; o `WITH CHECK` de `families` aceita porque `app.familia_id` é o próprio id novo.
- **Desativar:** `members.active=false` + `removed_at`; o portal então derruba as sessões e bloqueia o usuário no Appwrite. `resolve_member_by_appwrite_user` já devolve `ativo=false` e o portal nega o acesso.
