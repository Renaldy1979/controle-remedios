# Evolution Go com a correção do "Client outdated (405)" — TEMPORÁRIO

Em 02/11/2026 o WhatsApp passou a recusar a versão de cliente embutida nas imagens publicadas da Evolution Go (0.7.2, `latest` e `0.7.2-beta`), derrubando todas as instâncias com `Client outdated (405)`. Issue: <https://github.com/evolution-foundation/evolution-go/issues/225>.

A correção (PR #227, ainda não publicada em imagem oficial) manda para o WhatsApp a versão do WhatsApp Web buscada na hora, com `store.SetWAVersion`. Este Dockerfile baixa o **código oficial da tag 0.7.2** direto do repositório da Evolution Foundation, insere essas linhas (`wa-version.snippet.go`) e compila. Nada de imagem de terceiros.

## Usar no EasyPanel (uma vez)

1. Serviço da Evolution Go → **Source**: troque de *Docker image* para **GitHub**, repositório `Renaldy1979/controle-remedios`, ramo `main`, **Build path `/infra/evolution-go`** (usa o `Dockerfile` desta pasta). O repositório do MedCuidar já está conectado ao EasyPanel.
2. **Não mexa em Environment, Mounts (volumes) nem Domains.** A sessão do número e o banco ficam como estão.
3. **Deploy** (o build leva alguns minutos). No log procure por:
   - `Applied store.SetWAVersion -> 2.3000.…` (a correção entrou) e **nenhum** `Client outdated`.
4. A instância deve voltar a **conectada** sozinha, sem QR Code. Se não voltar, `POST /instance/connect` no manager.
5. No portal: Configurações › WhatsApp › **Consultar agora** → Conectada.

## Voltar para a imagem oficial (quando sair a 0.7.3 ou mais nova)

Confira no [Docker Hub](https://hub.docker.com/r/evoapicloud/evolution-go/tags) se existe tag estável (sem `-beta`) mais nova que 0.7.2 e se as notas citam a correção do 405. Então: Source → **Docker image** → `evoapicloud/evolution-go:<tag>` → Deploy. Volumes e variáveis não mudam. Depois apague esta pasta.

## Limites
- Se a busca da versão do WhatsApp Web falhar (WhatsApp Web fora do ar ou bloqueio de rede), nada é aplicado e o 405 pode voltar; o log mostra `Failed to fetch WhatsApp Web version`.
- O Dockerfile fixa a tag `0.7.2` (`ARG EVO_REF`). Não suba de versão sem ler as notas.
- Reinicie o serviço depois de qualquer deploy; a versão buscada fica em cache por 1 hora dentro do processo.
