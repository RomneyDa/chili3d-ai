# CLAUDE.md — Chili3D-AI architecture guide

This file is auto-loaded into LLM prompts for this repo. It captures the non-obvious knowledge needed to modify the codebase without re-discovering it every session.

## Identity & scope

Chili3D-AI is a fork of [xiangechen/chili3d](https://github.com/xiangechen/chili3d). Upstream is a browser-based 3D CAD app (TypeScript + OCCT WASM + Three.js). The fork adds:

1. A same-origin React chat iframe served at `/chat/` next to the main editor layout.
2. A Zod-validated tool registry that lets an LLM drive CAD actions from inside the iframe.

The architecture is fully **local-first**: the chat iframe talks directly to the user's own Anthropic/OpenAI endpoint with their own API key, and tool calls execute in-browser against `window.parent.chili3dApp`. There's no backend. No server-side components ship with the app.

Upstream behaviour is preserved — no upstream commands or node types were deleted. The main upstream files touched are `packages/ui/src/editor.ts` (right sidebar iframe), `packages/ui/src/mainWindow.ts` (auto-open doc on startup), `packages/builder/src/appBuilder.ts` (expose globals), and `packages/app/src/bodys/index.ts` (re-export `BooleanNode`).

## Monorepo layout

Yarn workspaces over `packages/*` and `plugins/*`. Main bundler is Rspack (not Webpack, not Vite).

```
packages/
  core/       @chili3d/core     interfaces, math, PubSub, Material, Transaction, …
  app/        @chili3d/app      Application, commands, body nodes (BoxNode, SphereNode, …)
  builder/    @chili3d/builder  AppBuilder — boots the app, exposes globals
  ui/         @chili3d/ui       custom-element UI (MainWindow, Editor, Ribbon, Home)
  three/      @chili3d/three    Three.js visual factory
  wasm/       @chili3d/wasm     OCCT shape factory (C++/WASM)
  storage/    @chili3d/storage  IndexedDB implementation
  i18n/       @chili3d/i18n     zh-cn + en locales
  element/    @chili3d/element  DOM element helpers (div, span, svg, …)
  web/        @chili3d/web      entry point (./packages/web/src/index.ts)
  ai-chat/    @chili3d/ai-chat  THIS FORK. React chat iframe built to public/chat/
plugins/
  helloworld-ts, helloworld-js, macro   example plugins
```

Root `tsconfig.json` includes only `packages/` but excludes `packages/ai-chat` — it has its own tsconfig and Vite build. Don't change the root tsconfig to include it; keep it isolated.

## Build & dev

Root scripts (`package.json`):

- `npm run dev` — builds the chat iframe once, then runs `rspack dev` on :8080.
- `npm run dev:full` — runs `vite build --watch` (chat) and `rspack dev` concurrently. Use this when iterating on chat code.
- `npm run dev:ai-chat` — chat iframe in watch mode only.
- `npm run build` — builds chat first, then rspack.

The chat iframe builds to `public/chat/`. Rspack's `CopyRspackPlugin` then copies everything under `public/` into the final `dist/`, so `/chat/` works in both dev and prod. Don't add a second `public` dir under `packages/ai-chat`; Vite's `outDir` is explicitly `../../public/chat` and it must stay that way for same-origin delivery.

## How the app boots

`packages/web/src/index.ts` calls:

```ts
new AppBuilder()
    .useIndexedDB()
    .useWasmOcc()
    .useThree()
    .useUI()
    .build()
    .then(handleApplicaionBuilt);
```

`AppBuilder.build()` (in `packages/builder/src/appBuilder.ts`) runs the registered inits in order, then:

1. constructs `Application`
2. inits `MainWindow` (custom element `<chili3d-main-window>`)
3. loads default plugins from `/public/plugins/plugins.json`
4. **exposes three globals for the iframe**:
   - `globalThis.chili3dApp`  — the `IApplication` instance
   - `globalThis.Chili3dCore` — the whole `@chili3d/core` module
   - `globalThis.Chili3dApp`  — the whole `@chili3d/app` module (has `BoxNode`, `SphereNode`, …)

The iframe reads these via `window.parent.*`. Don't remove them.

`MainWindow.init` also skips the welcome screen on first run: if `app.storage.page(DBName, RecentTable, 0)` returns an empty array, it dispatches `doc.new` instead of rendering the Home page.

## PubSub + command dispatch

Commands are registered via an `@command({ key, icon, isApplicationCommand? })` decorator on an `ICommand` class. Execution is fire-and-forget via PubSub:

```ts
PubSub.default.pub("executeCommand", "create.box"); // dispatch
```

The `CommandService` listens for `"executeCommand"`, instantiates the command class, and calls `execute(app)`. Interactive commands implement `ICancelableCommand` and pick points through `Step`s.

**Key insight** — the upstream command system is interactive: the user clicks to supply coordinates. An LLM calling `execute_command("create.box")` would hang waiting for clicks. That's why tools construct nodes directly instead of dispatching commands for geometry creation.

Full PubSub event map is in `packages/core/src/foundation/pubsub.ts`. The main ones an AI tool might touch:

- `executeCommand(key)` — run any registered command
- `activeViewChanged(view)` — document/view was swapped; iframe subscribes
- `showToast`, `displayError`, `showDialog`, `showPermanent`

## How the AI iframe reaches into the parent

`packages/ai-chat/src/bridge/parent.ts` exports:

```ts
getApplication(): IApplication       // window.parent.chili3dApp
getCore(): typeof import("@chili3d/core")  // window.parent.Chili3dCore
getAppModule(): typeof import("@chili3d/app")  // window.parent.Chili3dApp
requireActiveDocument(): IDocument
```

**Why go through the parent instead of bundling `@chili3d/core` into the iframe?** Same-origin iframes each get their own JS realm. If the iframe imported `@chili3d/core` and did `new BoxNode(...)`, the result would be an instance of the *iframe's* `BoxNode` class, not the parent's — serialization and `instanceof` checks would all break. By always constructing nodes from the parent's module, they live in the same realm as every other node in the document.

Imports in iframe code use `import type { X } from "@chili3d/core"` for compile-time types, then access the runtime constructors through `getCore()` / `getAppModule()`. Never do a value import from `@chili3d/core` or `@chili3d/app` in iframe code — Vite will bundle it and you'll get cross-realm bugs.

### Why no hotkey patch?

The upstream `HotkeyService` listens on `window.addEventListener("keydown", …)` and swallows keys. In the previous non-fork attempt (`chili3d-ai`) the chat lived in the same window, so the service ate text input. Here the chat is in an iframe — the iframe has its own `window`, events don't bubble to the parent, and no patch is needed. Don't reintroduce one.

## Tool system

- `packages/ai-chat/src/tools/schemas.ts` — Zod schemas keyed by tool name. Single source of truth for tool shapes.
- `packages/ai-chat/src/tools/registry.ts` — one executor per tool. Executors use `getCore()` / `getAppModule()` / `requireActiveDocument()` and always wrap mutations in `withTransaction(doc, "ai.foo", () => …)` so the user can undo them.
- `packages/ai-chat/src/tools/index.ts` re-exports `schemas`, `registry`, `executeTool`, `SYSTEM_PROMPT`, and `toolDescriptions`.
- `packages/ai-chat/src/tools/system-prompt.ts` — user-facing rules the model follows (units, call `fit_view` after changes, reuse existing materials before creating new ones, capture_view is expensive, etc.). Update when adding tools with non-obvious usage.

### Adding a new tool

1. Add schema to `packages/ai-chat/src/tools/schemas.ts` (under `schemas`) and a description in `toolDescriptions`.
2. Add the executor in `packages/ai-chat/src/tools/registry.ts`. Use `withTransaction` for anything that mutates the document.
3. If the tool has non-obvious timing or dependency rules, update `system-prompt.ts`.
4. **Update the "AI tool surface" section of `README.md`** — list the new tool with its parameters in the appropriate category. Same rule applies when renaming, removing, or changing the parameters of an existing tool. The README list is user-facing documentation of the model's capabilities and must stay in sync with the schemas.
5. If the tool returns non-JSON (e.g. image bytes), special-case it in `toModelOutputFor` inside `packages/ai-chat/src/ui/ChatPanel.tsx` to build the correct `tool-result` content (`{ type: "content", value: [{ type: "media", data, mediaType }, ...] }`). Returning JSON uses the SDK default; don't touch `toModelOutputFor` otherwise.
6. Rebuild chat iframe (`npm run build:ai-chat`) and the main bundle — the iframe is pre-built and served from `public/chat/`.

> Rule: any change to `packages/ai-chat/src/tools/schemas.ts` (adding, removing, renaming a tool, or changing its parameters) must be accompanied in the same commit by the corresponding edit to the "AI tool surface" list in `README.md`. If you catch yourself changing one without the other, stop and update both.

The Settings dialog's Tools section (toggle checkboxes) derives its list from `Object.keys(schemas)` at runtime — **adding a new tool to `schemas.ts` automatically gives it a checkbox, no UI change needed**. But when you *rename or remove* a tool, the persisted `chili3d-ai-chat.disabledTools` array in localStorage may still reference the old name; that's harmless (unknown names are filtered out by `loadDisabled`), but worth noting if you're debugging "why is my new tool disabled by default" — it isn't; new tools default to enabled.

## Chat UI essentials

- Uses Vercel AI SDK v5 client-side (`dangerouslyAllowBrowser: true` for Anthropic via the `anthropic-dangerous-direct-browser-access` header). The user supplies their own API key, stored in localStorage. No backend.
- History is stored as `ModelMessage[]` (SDK's canonical format). After each `streamText` turn, `await result.response; setHistory(h => [...h, ...response.messages])`. **Do not** flatten assistant/tool messages into a single message — Anthropic requires each `tool_use` to be immediately followed by its `tool_result` in the next message, and the SDK's per-step emission already has the right shape.
- `toDisplayGroups` folds tool-result blocks back into their tool-call blocks for rendering, and coalesces consecutive assistant messages.
- Transcripts persist to IndexedDB keyed by the active document id (`packages/ai-chat/src/ui/chat-store.ts`). `useActiveDocumentId` subscribes to `activeViewChanged` to swap transcripts. A `loadedDocRef` guard prevents the initial empty state from overwriting a stored transcript during the async load.
- Settings dialog (`SettingsDialog.tsx`) is the only way to clear the API key; changing provider/model/key updates `App` state without reload so the chat stays live.

## Materials

Materials are per-document and stored in `doc.modelManager.materials` (an `ObservableCollection<Material>`). Each `GeometryNode` has `materialId: string | string[]`. Whole-node assignment: `node.materialId = "id"`. Per-face assignment uses `node.addFaceMaterial([{ faceIndex, materialId }])`, which the AI tools don't expose yet.

Three material classes live in `@chili3d/core`:

- `Material` — basic: `color`, `opacity`, `map` (Texture)
- `PhongMaterial` — adds `specular`, `shininess`, `emissive`
- `PhysicalMaterial` — adds `metalness`, `roughness`, `emissive` (PBR)

All three are constructed with `{ document, name, color }`. Don't mutate a material outside a `Transaction` or undo/redo will be inconsistent.

## Gotchas & pitfalls

- **Don't value-import `@chili3d/core`/`@chili3d/app` in iframe code.** Types only. Use `getCore()` / `getAppModule()`.
- **`Matrix4` is immutable.** No `setPosition` or `elements[]=` — use `Matrix4.fromTranslation(x,y,z).multiply(existing)` to translate.
- **`Plane` constructor validates**: `normal` and `xvec` cannot be zero or parallel. Pick an X axis orthogonal to the normal (see `planeAt` helper in `registry.ts`).
- **`ShapeNode.shape.value` can be `undefined`** right after construction if the shape hasn't been generated yet. For boolean ops, the current `shapeOf` helper throws on this; if you see "Node X has no geometry yet", force a visual update first or generate the shape eagerly.
- **Interactive vs programmatic**: when in doubt, construct nodes directly instead of dispatching commands. `execute_command` is an escape hatch for things with no non-interactive path (e.g. `act.alignCamera` for fit view).
- **Rspack's `CircularDependencyRspackPlugin` has `failOnError: true`** with `node_modules` excluded. If a circular import creeps in between packages, the main build breaks — tools at the top of the chain (e.g. `core`) must not import from things below.
- **TypeScript is strict** (`strict: true`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`). `process.env.FOO` has to be `process.env["FOO"]`.
- **WeChat components commented out** in this fork: `packages/ui/src/home/home.ts`, `packages/builder/src/ribbon.ts`, `packages/app/src/commands/application/index.ts` and `wechatGroup.ts`. The i18n keys and icon font entry remain — leave them alone to avoid touching the `CommandKeys` union.
- **Decorator side effects**: the `@command()` decorator in `packages/core/src/command/decorator.ts` registers the command at module-load time. Commenting out the `export * from …` in the barrel is enough to stop registration because nothing imports the file directly.

## Branding

- App name: **Chili3D-AI**
- Logo: upstream chili SVG with a small blue "AI" text badge at the bottom-right (`logoBadge` + `aiBadge` class pairs in `home.module.css` and `ribbon.module.css`)
- GitHub: <https://github.com/romneyda/chili3d-ai>
- Tab title + meta description in `public/index.html`

## File quick-reference

When you need to change X, start here:

| I want to… | File |
|---|---|
| Add a new AI tool | `packages/ai-chat/src/tools/{schemas,registry,system-prompt}.ts` + update README |
| Change chat UI | `packages/ai-chat/src/ui/ChatPanel.tsx`, `SettingsDialog.tsx`, `styles.css` |
| Change iframe layout | `packages/ui/src/editor.ts` + `editor.module.css` |
| Boot a new service | `packages/builder/src/appBuilder.ts` (services in `getServices()`) |
| Handle a new PubSub event | `packages/core/src/foundation/pubsub.ts` (add to `PubSubEventMap`) |
| Add a new node type | `packages/app/src/bodys/` (extend `ParameterShapeNode` / `FacebaseNode`) |
| Expose a module to the iframe | `appBuilder.ts`'s `ensureAPI()` |
| Change the welcome/skip-home behaviour | `packages/ui/src/mainWindow.ts` `init()` |
