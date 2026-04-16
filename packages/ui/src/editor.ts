// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IApplication,
    type IDocument,
    type Material,
    PubSub,
    type Ribbon,
} from "@chili3d/core";
import { div } from "@chili3d/element";
import style from "./editor.module.css";
import { OKCancel } from "./okCancel";
import { ProjectView } from "./project";
import { PropertyView } from "./property";
import { MaterialDataContent, MaterialEditor } from "./property/material";
import { RibbonUI } from "./ribbon";
import { Statusbar } from "./statusbar";
import { LayoutViewport } from "./viewport";

const AI_SIDEBAR_STORAGE_KEY = "chili3d.aiSidebar";
const AI_SIDEBAR_DEFAULT_WIDTH = 380;
const AI_SIDEBAR_MIN_WIDTH = 260;

export class Editor extends HTMLElement {
    private readonly _selectionController: OKCancel;
    private readonly _viewportContainer: HTMLDivElement;
    private _sidebarWidth: number = 260;
    private _isResizingSidebar: boolean = false;
    private _sidebarEl: HTMLDivElement | null = null;
    private _aiSidebarWidth: number = AI_SIDEBAR_DEFAULT_WIDTH;
    private _aiSidebarVisible: boolean = true;
    private _isResizingAiSidebar: boolean = false;
    private _aiSidebarEl: HTMLDivElement | null = null;
    private _aiToggleBtn: HTMLButtonElement | null = null;

    constructor(
        readonly app: IApplication,
        readonly ribbonContent: Ribbon,
    ) {
        super();
        const viewport = new LayoutViewport(app);
        viewport.classList.add(style.viewport);
        this._selectionController = new OKCancel();
        this._viewportContainer = div(
            { className: style.viewportContainer },
            this._selectionController,
            viewport,
        );
        this.clearSelectionControl();
        this._loadAiSidebarState();
        this.render();
    }

    private _loadAiSidebarState() {
        try {
            const raw = localStorage.getItem(AI_SIDEBAR_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as { width?: number; visible?: boolean };
            if (typeof parsed.width === "number") {
                this._aiSidebarWidth = Math.max(AI_SIDEBAR_MIN_WIDTH, parsed.width);
            }
            if (typeof parsed.visible === "boolean") {
                this._aiSidebarVisible = parsed.visible;
            }
        } catch {
            // ignore; use defaults
        }
    }

    private _persistAiSidebarState() {
        try {
            localStorage.setItem(
                AI_SIDEBAR_STORAGE_KEY,
                JSON.stringify({ width: this._aiSidebarWidth, visible: this._aiSidebarVisible }),
            );
        } catch {
            // ignore
        }
    }

    private render() {
        this._sidebarEl = div(
            {
                className: style.sidebar,
                style: `width: ${this._sidebarWidth}px;`,
            },
            new ProjectView({ className: style.sidebarItem }),
            new PropertyView({ className: style.sidebarItem }),
            div({
                className: style.sidebarResizer,
                onmousedown: (e: MouseEvent) => this._startSidebarResize(e),
            }),
        );
        this._aiSidebarEl = this._createAiSidebar();
        this._aiToggleBtn = this._createAiToggle();
        this._viewportContainer.appendChild(this._aiToggleBtn);
        this.append(
            div(
                { className: style.root },
                new RibbonUI(this.app, this.ribbonContent),
                div(
                    { className: style.content },
                    this._sidebarEl,
                    this._viewportContainer,
                    this._aiSidebarEl,
                ),
                new Statusbar(style.statusbar),
            ),
        );
        this._applyAiSidebarVisibility();
        this.app.mainWindow?.appendChild(this);
    }

    private _createAiSidebar(): HTMLDivElement {
        const iframe = document.createElement("iframe");
        iframe.className = style.aiIframe;
        iframe.src = "/chat/";
        iframe.title = "Chili3D-AI Assistant";
        // Same-origin so the iframe can reach window.parent.chili3dApp.
        return div(
            {
                className: style.aiSidebar,
                style: `width: ${this._aiSidebarWidth}px;`,
            },
            div({
                className: style.aiSidebarResizer,
                onmousedown: (e: MouseEvent) => this._startAiSidebarResize(e),
            }),
            iframe,
        );
    }

    private _createAiToggle(): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `${style.aiToggle} ${style.aiToggleTwinkle}`;
        btn.title = "Toggle AI assistant";
        // Inline SVG so we don't have to extend the icon font. Four-pointed
        // star glyph — the common "AI sparkle" mark.
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M12 2.5l2.2 5.8 5.8 2.2-5.8 2.2L12 18.5l-2.2-5.8L4 10.5l5.8-2.2L12 2.5z"/>
            <path d="M18.5 14l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9.9-2.2z" opacity="0.7"/>
        </svg>`;
        btn.onclick = () => this._toggleAiSidebar();
        // Run the CSS twinkle exactly twice on project open, then strip the
        // class so the button sits quietly afterwards. `animationend` fires
        // once the iteration count (2) completes.
        btn.addEventListener("animationend", () => btn.classList.remove(style.aiToggleTwinkle), {
            once: true,
        });
        return btn;
    }

    private _applyAiSidebarVisibility() {
        if (!this._aiSidebarEl) return;
        this._aiSidebarEl.style.display = this._aiSidebarVisible ? "" : "none";
        if (this._aiToggleBtn) {
            this._aiToggleBtn.classList.toggle(style.aiToggleActive, this._aiSidebarVisible);
        }
    }

    private _toggleAiSidebar() {
        this._aiSidebarVisible = !this._aiSidebarVisible;
        this._applyAiSidebarVisibility();
        this._persistAiSidebarState();
    }

    private _startSidebarResize(e: MouseEvent) {
        e.preventDefault();
        this._isResizingSidebar = true;
        if (this.app.mainWindow) this.app.mainWindow.style.cursor = "ew-resize";
        const onMouseMove = (ev: MouseEvent) => {
            if (!this._isResizingSidebar) return;
            if (!this._sidebarEl) return;
            const sidebarRect = this._sidebarEl.getBoundingClientRect();
            let newWidth = ev.clientX - sidebarRect.left;
            const minWidth = 75;
            const maxWidth = Math.floor(window.innerWidth * 0.85);
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
            this._sidebarWidth = newWidth;
            this._sidebarEl.style.width = `${newWidth}px`;
        };
        const onMouseUp = () => {
            this._isResizingSidebar = false;
            if (this.app.mainWindow) this.app.mainWindow.style.cursor = "";
            this.app.mainWindow?.removeEventListener("mousemove", onMouseMove);
            this.app.mainWindow?.removeEventListener("mouseup", onMouseUp);
        };
        this.app.mainWindow?.addEventListener("mousemove", onMouseMove);
        this.app.mainWindow?.addEventListener("mouseup", onMouseUp);
    }

    private _startAiSidebarResize(e: MouseEvent) {
        e.preventDefault();
        this._isResizingAiSidebar = true;
        if (this.app.mainWindow) this.app.mainWindow.style.cursor = "ew-resize";
        const overlay = div({
            className: style.aiIframeOverlay,
        });
        this._aiSidebarEl?.appendChild(overlay);
        const onMouseMove = (ev: MouseEvent) => {
            if (!this._isResizingAiSidebar) return;
            if (!this._aiSidebarEl) return;
            const rect = this._aiSidebarEl.getBoundingClientRect();
            let newWidth = rect.right - ev.clientX;
            const maxWidth = Math.floor(window.innerWidth * 0.6);
            newWidth = Math.max(AI_SIDEBAR_MIN_WIDTH, Math.min(maxWidth, newWidth));
            this._aiSidebarWidth = newWidth;
            this._aiSidebarEl.style.width = `${newWidth}px`;
        };
        const onMouseUp = () => {
            this._isResizingAiSidebar = false;
            if (this.app.mainWindow) this.app.mainWindow.style.cursor = "";
            overlay.remove();
            this.app.mainWindow?.removeEventListener("mousemove", onMouseMove);
            this.app.mainWindow?.removeEventListener("mouseup", onMouseUp);
            this._persistAiSidebarState();
        };
        this.app.mainWindow?.addEventListener("mousemove", onMouseMove);
        this.app.mainWindow?.addEventListener("mouseup", onMouseUp);
    }

    connectedCallback(): void {
        PubSub.default.sub("showSelectionControl", this.showSelectionControl);
        PubSub.default.sub("editMaterial", this._handleMaterialEdit);
        PubSub.default.sub("clearSelectionControl", this.clearSelectionControl);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("showSelectionControl", this.showSelectionControl);
        PubSub.default.remove("editMaterial", this._handleMaterialEdit);
        PubSub.default.remove("clearSelectionControl", this.clearSelectionControl);
    }

    private readonly showSelectionControl = (controller: AsyncController) => {
        this._selectionController.setControl(controller);
        this._selectionController.style.visibility = "visible";
        this._selectionController.style.zIndex = "1000";
    };

    private readonly clearSelectionControl = () => {
        this._selectionController.setControl(undefined);
        this._selectionController.style.visibility = "hidden";
    };

    private readonly _handleMaterialEdit = (
        document: IDocument,
        editingMaterial: Material,
        callback: (material: Material) => void,
    ) => {
        const context = new MaterialDataContent(document, callback, editingMaterial);
        this._viewportContainer.append(new MaterialEditor(context));
    };
}

customElements.define("chili-editor", Editor);
