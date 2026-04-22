// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

const STORAGE_KEY = "chili3d-ai-about-seen";

export class AboutAiModal extends HTMLElement {
    private readonly dialog: HTMLDialogElement;

    constructor() {
        super();
        this.dialog = this.buildDialog();
        this.appendChild(this.dialog);
    }

    show() {
        this.dialog.showModal();
    }

    private close = () => {
        this.dialog.close();
        this.remove();
        try {
            localStorage.setItem(STORAGE_KEY, "1");
        } catch {
            // ignore storage errors (private mode, quota, etc.)
        }
    };

    private buildDialog(): HTMLDialogElement {
        const dialog = document.createElement("dialog");
        dialog.style.cssText = `
            border: none;
            padding: 0;
            max-width: 480px;
            width: calc(100% - 32px);
            border-radius: 10px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
            background-color: var(--panel-background-color, #2b2b2b);
            color: var(--foreground-color, #eee);
        `;
        dialog.addEventListener("cancel", (e) => {
            e.preventDefault();
            this.close();
        });

        const style = document.createElement("style");
        style.textContent = `
            dialog::backdrop {
                background-color: var(--backdrop-color, rgba(0, 0, 0, 0.5));
                backdrop-filter: blur(3px);
            }
        `;
        dialog.appendChild(style);

        const header = document.createElement("div");
        header.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px 8px;
        `;

        const title = document.createElement("h2");
        title.textContent = "About Chili3D AI";
        title.style.cssText = `
            margin: 0;
            font-size: 1.25em;
            font-weight: 600;
        `;

        const closeBtn = document.createElement("button");
        closeBtn.setAttribute("aria-label", "Close");
        closeBtn.textContent = "×";
        closeBtn.style.cssText = `
            background: transparent;
            border: none;
            color: inherit;
            font-size: 1.5em;
            line-height: 1;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
        `;
        closeBtn.addEventListener("mouseenter", () => {
            closeBtn.style.backgroundColor = "var(--hover-background-color, rgba(255,255,255,0.08))";
        });
        closeBtn.addEventListener("mouseleave", () => {
            closeBtn.style.backgroundColor = "transparent";
        });
        closeBtn.addEventListener("click", this.close);

        header.append(title, closeBtn);

        const body = document.createElement("div");
        body.style.cssText = `
            padding: 8px 20px 16px;
            line-height: 1.5;
            font-size: 0.95em;
        `;
        const intro = document.createElement("p");
        intro.style.margin = "0 0 12px";
        intro.append(
            "A fork of ",
            this.link("Chili3D", "https://github.com/xiangechen/chili3d"),
            " by ",
            this.link("仙阁 (Xiange Chen)", "https://github.com/xiangechen"),
            ", with an added AI chat interface and tools for creating and editing geometry through natural language.",
        );

        const outro = document.createElement("p");
        outro.style.cssText = "margin: 0; opacity: 0.75; font-size: 0.9em;";
        outro.textContent = "Original modeling, sketching, and editing capabilities are unchanged.";

        body.append(intro, outro);

        const footer = document.createElement("div");
        footer.style.cssText = `
            display: flex;
            justify-content: flex-end;
            padding: 12px 20px 16px;
        `;

        const gotItBtn = document.createElement("button");
        gotItBtn.textContent = "Got it";
        gotItBtn.style.cssText = `
            padding: 8px 20px;
            font-size: 1em;
            border-radius: 6px;
            border: 1px solid var(--border-color, #555);
            background-color: var(--primary-color, #0078d4);
            color: var(--title-checked, #fff);
            cursor: pointer;
        `;
        gotItBtn.addEventListener("click", this.close);
        footer.appendChild(gotItBtn);

        dialog.append(header, body, footer);
        return dialog;
    }

    private link(text: string, href: string): HTMLAnchorElement {
        const a = document.createElement("a");
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = text;
        a.style.color = "var(--primary-color, #4ea1f7)";
        return a;
    }
}

customElements.define("chili-about-ai", AboutAiModal);

export function showAboutAiModalOnce() {
    try {
        if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {
        // if storage is unavailable, still show the modal
    }
    const modal = new AboutAiModal();
    document.body.appendChild(modal);
    modal.show();
}
