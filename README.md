# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout`

## Sites Lifecycle

The Sites lifecycle CLI runs the locked dependency install before returning this checkout. Edit the source under `app/`, then checkpoint when a coherent milestone is ready to inspect or share. The remote Sites builder runs `npm run build` against the pushed commit. Do not repeat install or build as a normal pre-checkpoint step.

This starter does not use `wrangler.jsonc`.

`install:ci` is intentionally a single, non-retrying `npm ci`. It refuses a concurrent install for the same project, consumes a matching image-seeded npm cache with `--prefer-offline` while retaining registry fallback for a missing cache object, otherwise downloads and verifies the complete vinext tarball recorded in `package-lock.json`, limits npm to one socket, and terminates a stalled install. `build` applies a short timeout and then validates the Sites artifact. These helpers target Linux and use GNU `timeout`; they are not native macOS scripts.

Scripts that need writable project-scoped home, npm, XDG, and temporary paths use `scripts/sites-env.sh`. The `dev` and `start` scripts honor the caller's runtime environment and keep Wrangler logs inside the checkout. The generated `.sites-runtime/` directory is disposable and ignored by Git.

## SAM local

O VisionLabel usa um conector FastAPI executado no computador do usuário; imagens e prompts não são enviados ao Site. A tela **Ativar SAM local** contém um catálogo com requisitos, licença, tamanho do checkpoint, plataforma e benchmark oficial — sempre acompanhado do hardware em que o número foi medido.

Modelos disponíveis:

| Família | Variantes | Uso nesta versão | Requisitos principais |
| --- | --- | --- | --- |
| SAM 2.1 | Hiera Tiny, Small, Base+, Large | pontos positivos/negativos e caixas; Small é o padrão | Python 3.10+, PyTorch 2.5.1+, Torchvision 0.20.1+; CUDA recomendada |
| SAM 3 | Imagem e conceitos | pontos, caixas e texto com múltiplas instâncias | Python 3.12+, PyTorch 2.7+, GPU e CUDA 12.6+; acesso gated no Hugging Face |

SAM 2.1 também possui tracking de vídeo no upstream. O SAM 3.1, lançado pela Meta em 27/03/2026, adiciona Object Multiplex para vídeo, mas ainda não está integrado nem é instalado pelo VisionLabel. O editor atual integra somente imagens e deixa essa diferença explícita.

Instalação e início:

- `public/visionlabel-sam-macos-linux.sh <model-id>` instala no Linux, macOS quando suportado ou WSL2 e inicia o modelo escolhido;
- `public/visionlabel-sam-windows.bat <model-id>` delega a instalação ao WSL2, preservando o mesmo menu e ID de modelo;
- os launchers `public/visionlabel-sam-start-macos-linux.sh` e `public/visionlabel-sam-start-windows.bat` reiniciam uma instalação existente e retomam automaticamente uma instalação interrompida;
- `public/visionlabel-sam-local.py` é o conector manual unificado, com CLI `--model`, `--checkpoint`, `--model-config` (nome Hydra do SAM 2), `--device`, `--port` e `--app-dir`;
- `public/visionlabel-sam-service-linux.sh install` registra o conector como serviço de usuário do systemd, para que ele suba no login e nenhum terminal precise ficar aberto (`status` e `uninstall` completam o ciclo). Em macOS e no WSL2 sem systemd, use o iniciador comum.

A troca de modelo acontece pela própria interface: `GET /models` lista o que está instalado em `~/.visionlabel-sam` e `POST /load {"model_id"}` recarrega o conector no venv da família pedida. Como cada família tem runtime próprio, a troca usa `execv` para substituir o processo preservando PID, terminal e processo pai, de modo que os instaladores que aguardam o conector continuam válidos; a porta fica indisponível por instantes e o modal acompanha o `/health` até o `ready`. Modelos não instalados são recusados com HTTP 409 explicando o que falta, em vez de subir quebrados.

O endpoint padrão é `http://127.0.0.1:7860/predict`. O conector valida o modelo solicitado, publica estado e capacidades em `/health`, detecta o dispositivo compatível e mantém em cache a representação da imagem atual para acelerar refinamentos. Requisições do navegador aceitam somente a origem oficial, origens loopback de desenvolvimento e origens adicionais declaradas em `VISIONLABEL_ALLOWED_ORIGINS`; os launchers configuram isso a partir de `VISIONLABEL_SITE_URL`. Checkpoints SAM 2.1 vêm dos downloads oficiais da Meta; SAM 3 exige aceitar os termos e executar `hf auth login` localmente.

Os instaladores mantêm separadas a URL do Site e a origem pública dos arquivos: `VISIONLABEL_SITE_URL` controla a página aberta e o CORS, enquanto as atualizações dos scripts usam por padrão `https://raw.githubusercontent.com/eduardoafonso1089/epiaka/main/public`; o bootstrap do conector usa um commit público imutável e confere sua soma SHA-256. `VISIONLABEL_ASSET_BASE_URL` pode substituir essa origem HTTPS. Em desenvolvimento ou numa instalação offline no Linux/macOS, `VISIONLABEL_CONNECTOR_PATH` aceita explicitamente uma cópia local do conector. O runtime do SAM 3 fixa `setuptools<81` enquanto a revisão upstream usada ainda depender de `pkg_resources` e instala explicitamente as dependências usadas pelo import principal.

A seleção é transacional: o modelo escolhido fica em `pending-model.txt` durante a instalação e só é promovido a `selected-model.txt` depois que runtime, dispositivo, checkpoint e o `/health` do modelo exato passam nas validações. Os iniciadores retomam esse estado pendente; checkpoints incompletos não são reutilizados, pois os cinco artefatos são conferidos contra seus tamanhos oficiais antes da ativação.

Pesos e dependências nunca são gravados no checkout: Linux, macOS e WSL2 usam `~/.visionlabel-sam/`. O `.gitignore` também bloqueia formatos de checkpoint, ambientes virtuais e diretórios de modelos como proteção adicional.

Por segurança de memória, o serviço limita cada imagem a 16 megapixels, processa no máximo quatro corpos de previsão simultaneamente e devolve no máximo 64 instâncias SAM 3. Esses valores podem ser ajustados conscientemente com `VISIONLABEL_MAX_IMAGE_PIXELS`, `VISIONLABEL_MAX_CONCURRENT_REQUESTS` e `VISIONLABEL_SAM3_MAX_PREDICTIONS`; o limiar conceitual mínimo do SAM 3 usa `VISIONLABEL_SAM3_MIN_CONCEPT_THRESHOLD` e começa em `0.1`.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Diagnostic Commands

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build and validate the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm run test:sam-installers`: exercise all five SAM installer paths with isolated mocks and sparse checkpoints
- `npm test`: build, validate, and verify the rendered development-preview metadata
- `npm run validate:artifact`: recheck an existing artifact's manifest and ESM `default.fetch` export
- `npm run db:generate`: generate Drizzle migrations after schema changes

Use build and validation commands for targeted diagnosis after a remote failure, not as part of the normal checkpoint path.

The timeout defaults can be overridden for a controlled canary with `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT`, and `SITES_BUILD_KILL_AFTER`. A timeout fails the command; the helpers never retry an unchanged install or build.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
