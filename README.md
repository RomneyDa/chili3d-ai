# Chili3D-AI

A fork of [Chili3D](https://github.com/xiangechen/chili3d) that embeds an AI assistant directly into the browser-based CAD app. The assistant drives CAD operations (create/modify geometry, manage materials, export files, control the camera, screenshot the viewport) via natural-language chat.

**Live:** <https://chili3d-ai.vercel.app>

![Screenshot](./screenshots/screenshot.png)

## What this fork adds

- **AI chat sidebar** — a React + Vite app in `packages/ai-chat`, served at `/chat/` and embedded in the editor layout as a same-origin iframe on the right. Uses the Vercel AI SDK with client-side streaming: the user pastes in their own Anthropic or OpenAI key, and every request goes straight from their browser to the provider. No backend, no proxy, no server secrets.
- **Tool registry** — Zod-validated tools spanning document / selection / creation / modification / boolean / materials / camera / vision / escape-hatch. See [AI tool surface](#ai-tool-surface) below for the full list.
- **Per-document chat persistence** — transcripts are stored in IndexedDB keyed by Chili3D document id; switching documents swaps transcripts.
- **Non-interactive bindings** — the upstream command system is built around interactive multi-step commands (click to pick points). The AI tools construct node instances (`BoxNode`, `SphereNode`, etc.) directly inside a `Transaction`, so undo/redo still works but the model never has to negotiate a pick sequence.

## AI tool surface

The model can call any of the tools below. Source of truth: [`packages/ai-chat/src/tools/schemas.ts`](./packages/ai-chat/src/tools/schemas.ts).

**Document**
- `new_document({ name? })` — create and activate a fresh document
- `save_document()` — persist the active document to IndexedDB
- `get_document_state()` — id, name, and top-level node summary
- `get_application_state()` — open documents + which is active

**Selection**
- `get_selection()` — current selection in the active document
- `select_nodes({ nodeIds, toggle? })` — replace or toggle selection

**Camera / view**
- `fit_view()` — frame all geometry
- `get_camera_state()` — `{ eye, target, up, type }`
- `set_camera({ eye?, target?, up?, type? })` — partial update
- `view_from({ direction, nodeIds?, padding? })` — named views: `top`, `bottom`, `front`, `back`, `left`, `right`, `iso`
- `frame_nodes({ nodeIds, padding? })` — fit camera on a subset of nodes

**Vision**
- `capture_view({ maxSize?, format?, quality? })` — screenshot the viewport and return it to the model as image content (not JSON). The model can then actually see the CAD state, which is useful for verifying results or diagnosing user reports. Each capture stays in history and is re-sent on every subsequent turn, so image tokens compound — use sparingly.

**Create**
- `create_box({ dx, dy, dz, origin?, name? })`
- `create_sphere({ center, radius, name? })`
- `create_cylinder({ center, radius, height, normal?, name? })`
- `create_cone({ center, radius, height, normal?, name? })`
- `create_rect({ origin, dx, dy, plane?, name? })` — `plane`: `XY`/`YZ`/`ZX`
- `create_circle({ center, radius, normal?, name? })`
- `create_line({ start, end, name? })`

**Modify**
- `delete_nodes({ nodeIds })` — empty list deletes current selection
- `move_nodes({ nodeIds, offset })` — translate by `[x, y, z]`

**Boolean**
- `boolean_union({ nodeIds })` — fuse 2+ solids
- `boolean_subtract({ subjectNodeId, toolNodeIds })`
- `boolean_intersect({ nodeIds })`

**Materials**
- `list_materials()` — enumerate materials in the active document (model should call this before creating new ones to avoid duplicates)
- `create_material({ name, color, opacity?, kind?, metalness?, roughness? })` — `kind`: `basic` / `phong` / `physical`
- `update_material({ materialId, name?, color?, opacity? })`
- `assign_material({ nodeIds, materialId })`
- `delete_material({ materialId })` — fails if nodes still reference it

**Escape hatch**
- `execute_command({ key })` — dispatch any chili3d command by key (interactive commands will prompt the user; prefer the dedicated tools when one exists)

## Upstream repo & licence

This fork remains under the same AGPL-3.0 licence as upstream. Upstream chili3d features (modelling, snapping, measurement, import/export, i18n, etc.) are unchanged; see the "Upstream features" section at the bottom for a full list.

## Quick start

```bash
npm install
npm run dev       # builds the chat iframe once, then starts rspack dev on :8080
# or
npm run dev:full  # runs vite watcher + rspack dev in parallel (auto-rebuild chat)
```

Open <http://localhost:8080>, click the sparkle icon in the top-right of the viewport to open the chat, and paste an Anthropic or OpenAI key in the gate.

## Building

```bash
npm run build        # builds the chat iframe + the main Rspack bundle
npm run build:ai-chat  # chat only
```

Build output goes to `dist/`; the chat iframe lives inside that at `dist/chat/`.

### Building the WASM kernel

Same as upstream:

```bash
npm run setup:wasm
npm run build:wasm
```

## Architecture at a glance

```
┌───────────────── browser tab ────────────────────────┐
│                                                      │
│   Vue/custom-element CAD app (packages/ui, /app)     │
│   Layout:                                            │
│     left sidebar │ viewport │ right iframe           │
│   window globals (set in AppBuilder):                │
│     .chili3dApp      IApplication                    │
│     .Chili3dCore     @chili3d/core exports           │
│     .Chili3dApp      @chili3d/app exports (BoxNode…) │
│                                                      │
│   ┌── /chat/ iframe (React, Vite bundle) ────────┐   │
│   │   reads window.parent.* to construct nodes   │   │
│   │   in the parent realm inside Transactions    │   │
│   │   Vercel AI SDK v5, client-side streamText   │   │
│   └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
                                        │
                                        ▼
                                  user's LLM API
                              (Anthropic / OpenAI)
```

See **[CLAUDE.md](./CLAUDE.md)** for the details an LLM (or human) needs when modifying this repo: monorepo layout, how commands are dispatched, how to add a new tool, how the iframe reaches into the parent, and the most common gotchas.

## Upstream features

Everything below is inherited from upstream Chili3D unchanged.

### Modeling tools

- **Basic shapes**: boxes, cylinders, cones, spheres, pyramids
- **2D sketching**: lines, arcs, circles, ellipses, rectangles, polygons, Bezier curves
- **Advanced**: boolean ops (union, difference, intersection), extrusion, revolution, sweeping, lofting, offset surfaces, section creation

### Snapping / tracking

- Object snap (points, edges, faces), workplane snap, axis tracking, feature-point detection, tracking visualization

### Editing

- Modification (chamfer, fillet, trim, break, split), transforms (move, rotate, mirror), feature removal, sub-shape manipulation, explode

### Measurement

- Angles, lengths, and sum of length / area / volume

### Documents

- Create / open / save with full undo/redo, STEP / IGES / BREP import/export

### Localization

- Built-in i18n (currently Chinese + English); additional languages welcome

## Technology stack

- **App**: TypeScript, custom elements, Three.js
- **Geometry kernel**: OpenCascade compiled to WebAssembly
- **Main build**: Rspack (workspaces) + SWC
- **Chat iframe**: React 19, Vite 6, Vercel AI SDK v5 (`@ai-sdk/anthropic`, `@ai-sdk/openai`)
- **Validation**: Zod for tool-input schemas
- **Tests**: rstest

## Development status

⚠️ **Early development / research fork**

- Upstream chili3d itself is in alpha — core APIs may churn
- The AI fork adds its own surface (tool registry, iframe host) that is subject to change

## Licence

Distributed under the GNU Affero General Public License v3.0 (AGPL-3.0). Full text: [LICENSE](./LICENSE).

For commercial-licensing questions about upstream Chili3D, contact xiangetg@msn.cn.

## Warning / analytics

Chili3D uses [Microsoft Clarity](https://clarity.microsoft.com) for growth analytics. To disable, remove the `<script>` block in `public/index.html`.

This software is provided "AS IS," and the authors and contributors disclaim all express and implied warranties. You bear full responsibility for any risks and consequences arising from its use, including (without limitation) data loss, system failures, and any illegal use.
