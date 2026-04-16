// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    Config,
    Constants,
    debounce,
    I18n,
    type IApplication,
    type IWindow,
    PubSub,
    Ribbon,
    RibbonTab,
    type RibbonTabProfile,
} from "@chili3d/core";
import { showDialog } from "./dialog";
import { Editor } from "./editor";
import { showFloatPanel } from "./floatPanel";
import { Home } from "./home";
import { Permanent } from "./permanent";
import { Toast } from "./toast";

const quickCommands: CommandKeys[] = ["doc.save", "doc.saveToFile", "edit.undo", "edit.redo"];

export class MainWindow extends HTMLElement implements IWindow {
    readonly ribbon: Ribbon;
    private _inited: boolean = false;
    private _home?: Home;
    private _editor?: Editor;

    constructor(
        readonly tabs: RibbonTabProfile[],
        readonly iconFont: string,
        dom?: HTMLElement,
    ) {
        super();
        this.tabIndex = 0;
        this.ensureDom(dom);
        this.ribbon = new Ribbon(quickCommands, tabs.map(RibbonTab.fromProfile));
    }

    protected ensureDom(dom?: HTMLElement) {
        if (dom) {
            dom.append(this);
        } else {
            document.body.appendChild(this);
        }

        this.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        this.addEventListener("scroll", (e) => {
            this.scrollTop = 0;
        });
    }

    async init(app: IApplication): Promise<void> {
        if (this._inited) {
            throw new Error("MainWindow is already inited");
        }
        this._inited = true;

        I18n.changeLanguage(Config.instance.language);

        await this.loadCss();
        await this.fetchIconFont();

        this.applyTheme();
        this._initEditor(app);
        this._initEventHandlers(app);
        // Skip the welcome screen on first run: if the user has no recent
        // documents there's nothing useful to show there, so we drop them
        // straight into a fresh document. On subsequent runs the recents
        // screen remains the landing page.
        const hasRecents = await this._hasRecentDocuments(app);
        if (hasRecents) {
            await this._initHome(app);
        } else {
            PubSub.default.pub("executeCommand", "doc.new");
        }
    }

    private async _hasRecentDocuments(app: IApplication): Promise<boolean> {
        try {
            const page = await app.storage.page(Constants.DBName, Constants.RecentTable, 0);
            return Array.isArray(page) && page.length > 0;
        } catch {
            return false;
        }
    }

    protected async loadCss() {
        await import("./mainWindow.module.css");
    }

    protected async fetchIconFont() {
        const response = await fetch(this.iconFont);
        const text = await response.text();

        new Function(text)();
    }

    private _initEventHandlers(app: IApplication) {
        const displayHome = debounce(this.displayHome, 100);
        PubSub.default.sub("showToast", Toast.info);
        PubSub.default.sub("displayError", Toast.error);
        PubSub.default.sub("showDialog", showDialog);
        PubSub.default.sub("showFloatPanel", showFloatPanel);
        PubSub.default.sub("showPermanent", Permanent.show);
        PubSub.default.sub("activeViewChanged", (view) => displayHome(app, view === undefined));
        PubSub.default.sub("displayHome", (show) => displayHome(app, show));

        Config.instance.onPropertyChanged(this.handleConfigChanged);
        window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
            if (Config.instance.themeMode === "system") {
                this.applyTheme();
            }
        });
    }

    private readonly displayHome = (app: IApplication, displayHome: boolean) => {
        if (this._home) {
            this._home.remove();
            this._home = undefined;
        }
        if (displayHome) {
            this._initHome(app);
        }
    };

    private async _initHome(app: IApplication) {
        this._home = new Home(app);
        await this._home.render();
    }

    private async _initEditor(app: IApplication) {
        this._editor = new Editor(app, this.ribbon);
    }

    private applyTheme() {
        const themeMode = Config.instance.themeMode;
        let theme: "light" | "dark";

        if (themeMode === "system") {
            theme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        } else {
            theme = themeMode;
        }

        document.documentElement.setAttribute("theme", theme);
    }

    private readonly handleConfigChanged = (prop: keyof Config) => {
        if (prop === "themeMode") {
            this.applyTheme();
        }

        if (prop === "language") {
            I18n.changeLanguage(Config.instance.language);
        }

        const shouldSaveProps: (keyof Config)[] = ["themeMode", "language", "navigation3D"];
        if (shouldSaveProps.includes(prop)) {
            Config.instance.saveToStorage();
        }
    };
}

customElements.define("chili3d-main-window", MainWindow);
