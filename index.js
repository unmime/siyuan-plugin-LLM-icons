/**
 * LLM Icons for SiYuan
 *
 * 把 AI / LLM 品牌 logo 设为文档图标。
 *
 * 以下机制均已在本机思源 3.8.9 实机验证：
 * - 图标值格式为 `<组名>/<文件名>`，内核通过 `/emojis/<组>/<文件>` 提供静态服务；
 * - 内核支持该目录下的 SVG（返回 image/svg+xml）；
 * - 图标文件写入 `data/emojis/<组>/`，会随工作区同步；
 * - 设置图标走 `/api/attr/setBlockAttrs`，属性名 `icon`；
 * - 插件自身目录可通过 `/plugins/<name>/<path>` 直接访问静态资源。
 *
 * 图标来源：Lobe Icons (https://github.com/lobehub/lobe-icons)，MIT License。
 * 商标归各品牌所有，本插件仅用于文档标识。
 */
const { Plugin, Dialog, Menu, showMessage, getAllEditor } = require("siyuan");

const PLUGIN_NAME = "siyuan-plugin-LLM-icons";
const EMOJI_GROUP = "llm-icons";
const ASSET_DIR = "llm-icons";

// 「常用」分类：按实际使用频率人工排序，避免用户在 357 个里翻
const POPULAR = [
    "openai", "claude", "gemini", "deepseek", "qwen", "doubao",
    "moonshot", "chatglm", "hunyuan", "wenxin", "minimax",
    "mistral", "meta", "grok", "perplexity", "ollama", "groq",
    "cursor", "github", "huggingface", "siliconcloud", "baichuan",
    "stepfun", "baidu", "volcengine", "cohere", "midjourney",
];

module.exports = class LLMIcons extends Plugin {
    async onload() {
        this.brands = [];
        // assets 上传会带时间戳后缀，重复插入会堆副本，这里按 slug 缓存已上传路径
        this.assetCache = new Map();

        this.addIcons(
            // 四角星芒 + 小星点，读作「AI」，和网格/圆点类图标区分开
            `<symbol id="iconLLMIcons" viewBox="0 0 32 32">
                <path d="M13 3.5c.55 0 1.03.36 1.19.89l1.62 5.3 5.3 1.62a1.25 1.25 0 0 1 0 2.38l-5.3 1.62-1.62 5.3a1.25 1.25 0 0 1-2.38 0l-1.62-5.3-5.3-1.62a1.25 1.25 0 0 1 0-2.38l5.3-1.62 1.62-5.3c.16-.53.64-.89 1.19-.89z"/>
                <path d="M23.5 17.5c.4 0 .75.26.87.64l.83 2.66 2.66.83a.9.9 0 0 1 0 1.74l-2.66.83-.83 2.66a.9.9 0 0 1-1.74 0l-.83-2.66-2.66-.83a.9.9 0 0 1 0-1.74l2.66-.83.83-2.66c.12-.38.47-.64.87-.64z" opacity=".75"/>
            </symbol>
            <symbol id="iconLLMDoc" viewBox="0 0 32 32">
                <path d="M8.5 4h10.5l6 6v18a2 2 0 0 1-2 2H8.5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="2.2"/>
                <path d="M19 4v7h6" fill="none" stroke="currentColor" stroke-width="2.2"/>
            </symbol>`
        );

        this.addCommand({
            langKey: "openPicker",
            // 避开 ⌥⌘I / ⌥⌘J / ⌥⌘C —— 这几个是 Electron 打开 DevTools 的默认键
            hotkey: "⌥⌘Y",
            callback: () => this.openPicker(),
        });

        this.addTopBar({
            icon: "iconLLMIcons",
            title: this.i18n.topbarTitle,
            position: "right",
            callback: () => this.openPicker(),
        });

        // 面包屑按钮：主题把面包屑移到底部时，它就出现在那条胶囊里
        try {
            this.addBreadcrumbButton({
                id: "llm-icons",
                icon: "iconLLMIcons",
                title: this.i18n.topbarTitle,
                callback: (event, protyle) => {
                    if (event && event.preventDefault) event.preventDefault();
                    this.activeProtyle = protyle;
                    this.openPicker();
                },
            });
        } catch (err) {
            console.warn("[LLM Icons] breadcrumb button failed", err);
        }

        // 表情面板里也放一个入口（面板头部的图标排）
        this.watchEmojiDialog();

        // 文档标题图标右键菜单入口
        this.eventBus.on("click-editortitleicon", (e) => {
            const d = e.detail;
            if (!d || !d.menu) return;
            d.menu.addItem({
                icon: "iconLLMIcons",
                label: this.i18n.menuOpen,
                click: () => this.openPicker(d.data && d.data.id),
            });
        });

        await this.loadBrands();
    }

    onunload() {
        if (this.emojiObserver) {
            this.emojiObserver.disconnect();
            this.emojiObserver = null;
        }
    }

    /**
     * 把 AI 品牌图标做成表情面板里的一个真正 tab。
     *
     * 思源表情面板的结构：
     *   .emojis__tabheader  里一排 [data-type="tab-xxx"] 图标
     *   .emojis__tabbody    里对应一排 <div data-type="tab-xxx">，非当前的加 fn__none
     * 每个 tabbody 自带搜索框，所以这里也自带一个，做到「就在面板里搜」。
     */
    watchEmojiDialog() {
        const inject = () => {
            document.querySelectorAll(".emojis__tabheader").forEach((header) => {
                if (header.querySelector(".lmi-emoji-tab")) return;
                const dialog = header.closest(".b3-dialog");
                const body = dialog && dialog.querySelector(".emojis__tabbody");
                const linkTab = header.querySelector('[data-type="tab-link"]');
                if (!body || !linkTab) return;

                // ── tab 图标 ──
                const tab = document.createElement("div");
                tab.className = "lmi-emoji-tab ariaLabel block__icon block__icon--show";
                tab.setAttribute("data-type", "tab-llm");
                tab.setAttribute("aria-label", this.i18n.topbarTitle);
                tab.innerHTML = '<svg><use xlink:href="#iconLLMIcons"></use></svg>';

                // ── tab 内容 ──
                const pane = document.createElement("div");
                pane.className = "fn__none lmi-ep";
                pane.setAttribute("data-type", "tab-llm");
                pane.innerHTML = `
                    <div class="fn__hr"></div>
                    <div class="fn__flex">
                        <span class="fn__space"></span>
                        <label class="b3-form__icon fn__flex-1" style="overflow:initial;">
                            <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
                            <input spellcheck="false" class="b3-form__icon-input b3-text-field fn__block lmi-ep-search" placeholder="${this.esc(this.i18n.searchPlaceholder)}">
                        </label>
                        <span class="fn__space"></span>
                    </div>
                    <div class="fn__hr"></div>
                    <div class="lmi-ep-grid"></div>
                `;

                const input = pane.querySelector(".lmi-ep-search");
                const grid = pane.querySelector(".lmi-ep-grid");
                let built = false;
                let keyword = "";

                /**
                 * 这个表情面板是"设置图标"还是"插入正文"打开的？
                 *
                 * 思源内部用 B 变量区分（doc / notebook / insert），但没暴露给我们。
                 * 可观察的差异：垃圾桶按钮只在非 insert 模式下显示
                 * （源码里是 `${B==="insert"?" fn__none":""}`）。
                 */
                const isIconMode = () => {
                    const rm = dialog.querySelector('[data-action="remove"]');
                    return !!rm && !rm.classList.contains("fn__none");
                };

                /** 用一个图标：标头模式替换图标，插入模式插正文 */
                const useBrand = async (brand, el) => {
                    if (el) el.style.opacity = "0.45";
                    let ok = false;
                    if (isIconMode()) {
                        ok = await this.applyIcon(this.activeDocId(), brand);
                    } else {
                        ok = await this.insertToBody(brand);
                    }
                    if (el) el.style.opacity = "";
                    if (ok) dialog.remove();
                    return ok;
                };

                const render = () => {
                    const kw = keyword.trim().toLowerCase();
                    const pool = kw
                        ? this.brands.filter(
                              (b) =>
                                  b.n.toLowerCase().includes(kw) ||
                                  b.s.includes(kw) ||
                                  (b.c && b.c.includes(kw))
                          )
                        : POPULAR.map((slug) => this.brands.find((b) => b.s === slug)).filter(Boolean);

                    if (!pool.length) {
                        grid.innerHTML = `<div class="lmi-ep-empty">${this.esc(this.i18n.noResult)}</div>`;
                        return;
                    }
                    grid.innerHTML = pool
                        .map((b) => {
                            const file = this.fileOf(b);
                            const short = this.shortOf(b);
                            return `<div class="lmi-ep-item" data-slug="${b.s}" title="${this.esc(short)}">
                                <img src="/plugins/${PLUGIN_NAME}/assets/${file}" loading="lazy" decoding="async" alt="">
                            </div>`;
                        })
                        .join("");
                };

                grid.addEventListener("click", async (e) => {
                    const item = e.target.closest(".lmi-ep-item");
                    if (!item) return;
                    const brand = this.brands.find((b) => b.s === item.getAttribute("data-slug"));
                    if (!brand) return;
                    await useBrand(brand, item);
                });

                this.bindSearchInput(input, {
                    onQuery: (v) => {
                        keyword = v;
                        render();
                    },
                    onEnter: async () => {
                        const first = grid.querySelector(".lmi-ep-item");
                        if (!first) return;
                        const brand = this.brands.find((b) => b.s === first.getAttribute("data-slug"));
                        if (!brand) return;
                        await useBrand(brand, first);
                    },
                });

                const activate = () => {
                    header.querySelectorAll('[data-type^="tab-"]').forEach((t) => {
                        t.classList.toggle("block__icon--active", t === tab);
                    });
                    [...body.children].forEach((c) => c.classList.add("fn__none"));
                    pane.classList.remove("fn__none");
                    if (!built) {
                        built = true;
                        render();
                    }
                    setTimeout(() => input.focus(), 30);
                };

                tab.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    activate();
                });

                // 点到别的 tab 时把我的内容收起来
                header.addEventListener(
                    "click",
                    (e) => {
                        const t = e.target.closest('[data-type^="tab-"]');
                        if (t && t !== tab) tab.classList.remove("block__icon--active");
                    },
                    true
                );

                const space = linkTab.nextElementSibling;
                if (space && space.classList.contains("fn__space")) {
                    space.insertAdjacentElement("afterend", tab);
                } else {
                    linkTab.insertAdjacentElement("afterend", tab);
                }
                body.appendChild(pane);
            });
        };

        inject();
        this.emojiObserver = new MutationObserver(() => inject());
        this.emojiObserver.observe(document.body, { childList: true, subtree: true });
    }

    /* ── 数据 ────────────────────────────────────── */

    async loadBrands() {
        try {
            const resp = await fetch(`/plugins/${PLUGIN_NAME}/src/brands.json`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            this.brands = await resp.json();
        } catch (err) {
            console.error("[LLM Icons] 品牌索引加载失败", err);
            showMessage(`${this.i18n.applyFailed}: brands.json`);
        }
    }

    /* ── 图标文件 ────────────────────────────────── */

    /** 网格里显示的短名：去掉结尾的括号补充，如 "Antigravity (Google)" */
    shortOf(brand) {
        return brand.n.replace(/\s*[（(][^)）]*[)）]\s*$/, "").trim() || brand.n;
    }

    /** 图标文件名：有彩色版用彩色版，否则用单色 */
    fileOf(brand) {
        return brand.p ? `${brand.s}-${brand.p}.svg` : `${brand.s}.svg`;
    }

    async readGroup() {
        try {
            const resp = await fetch("/api/file/readDir", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: `/data/emojis/${EMOJI_GROUP}` }),
            });
            const json = await resp.json();
            return json.code === 0 && Array.isArray(json.data) ? json.data : null;
        } catch {
            return null;
        }
    }

    async putEmojiFile(name, blob) {
        const form = new FormData();
        form.append("path", `/data/emojis/${EMOJI_GROUP}/${name}`);
        form.append("isDir", "false");
        form.append("modTime", String(Math.floor(Date.now() / 1000)));
        form.append("file", blob, name);
        const resp = await fetch("/api/file/putFile", { method: "POST", body: form });
        const json = await resp.json();
        if (json.code !== 0) throw new Error(json.msg || "putFile failed");
        return `${EMOJI_GROUP}/${name}`;
    }

    /** 需要时把插件自带 SVG 写入工作区，返回可直接用作图标的相对值 */
    async materialize(brand) {
        const file = this.fileOf(brand);
        const list = await this.readGroup();  // null 表示目录还不存在
        if (list && list.some((f) => !f.isDir && f.name === file)) {
            return `${EMOJI_GROUP}/${file}`;
        }
        if (!list) {
            // 先写个占位文件把目录建出来
            await this.putEmojiFile(".keep", new Blob([""], { type: "text/plain" }));
        }

        const resp = await fetch(`/plugins/${PLUGIN_NAME}/assets/${file}`);
        if (!resp.ok) throw new Error(`读取 ${file} 失败 (${resp.status})`);
        return this.putEmojiFile(file, await resp.blob());
    }

    /* ── 插入正文 ────────────────────────────────── */

    /** 把插件里的 SVG 上传到 assets，返回 /assets/ 路径（正文插图用这个，导出后才不会丢） */
    async ensureAsset(brand) {
        if (this.assetCache.has(brand.s)) return this.assetCache.get(brand.s);

        const file = this.fileOf(brand);
        const resp = await fetch(`/plugins/${PLUGIN_NAME}/assets/${file}`);
        if (!resp.ok) throw new Error(`读取 ${file} 失败 (${resp.status})`);
        const blob = await resp.blob();

        const form = new FormData();
        form.append("assetsDirPath", `/assets/${ASSET_DIR}/`);
        form.append("file[]", blob, file);

        const up = await fetch("/api/asset/upload", { method: "POST", body: form });
        const json = await up.json();
        if (json.code !== 0) throw new Error(json.msg || "upload failed");

        const succ = (json.data && json.data.succMap) || {};
        const raw = succ[file] || Object.values(succ)[0];
        if (!raw) throw new Error("upload 未返回路径");
        const path = raw.charAt(0) === "/" ? raw : "/" + raw;
        this.assetCache.set(brand.s, path);
        return path;
    }

    /** 收集所有可用的 protyle 实例（含隐藏标签页，按活跃度排序） */
    collectProtyles() {
        const list = [];
        const push = (p) => {
            if (p && typeof p.insert === "function" && list.indexOf(p) === -1) list.push(p);
        };
        const visible = (p) => p && p.element && !p.element.classList.contains("fn__none");

        const active = this.protyleOf(this.activeDocId());
        if (active) push(active);

        (getAllEditor() || []).forEach((e) => push(e && e.protyle));

        // 可见的排前面，避免插进后台标签页
        return list.sort((a, b) => (visible(b) ? 1 : 0) - (visible(a) ? 1 : 0));
    }

    /** 当前光标所在块，供 API 兜底定位 */
    currentBlockContext() {
        const sel = window.getSelection();
        let node = sel && sel.anchorNode;
        let el = null;
        while (node) {
            if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute("data-node-id")) {
                el = node;
                break;
            }
            node = node.parentNode;
        }
        if (!el) return null;
        const parent = el.parentElement && el.parentElement.closest("[data-node-id]");
        return {
            id: el.getAttribute("data-node-id"),
            parentId: parent ? parent.getAttribute("data-node-id") : "",
        };
    }

    /** 优先用 protyle 直接插入，失败则走 /api/block/insertBlock */
    async insertToBody(brand) {
        const src = await this.ensureAsset(brand);
        const alt = String(brand.n || brand.s).replace(/[[\]()]/g, " ").trim();
        const html = `<img src="${this.esc(src)}" alt="${this.esc(alt)}">`;

        for (const protyle of this.collectProtyles()) {
            const wysiwyg = protyle && protyle.wysiwyg && protyle.wysiwyg.element;
            if (!wysiwyg || !wysiwyg.isConnected) continue;
            const before = wysiwyg.querySelectorAll("img").length;
            try {
                if (typeof protyle.focus === "function") protyle.focus();
                protyle.insert(html, false);
            } catch {
                continue;
            }
            // 确认真的插进去了，否则换下一个编辑器
            if (wysiwyg.querySelectorAll("img").length > before) return true;
        }
        return this.insertViaApi(src, alt);
    }

    async insertViaApi(src, alt) {
        const ctx = this.savedBlockCtx || this.currentBlockContext();
        let docId = this.activeDocId();
        if (!docId && ctx && ctx.id) docId = ctx.id;
        if (!docId) return false;

        const parentId = (ctx && ctx.parentId) || docId;
        const payload = {
            dataType: "markdown",
            data: `![${alt}](${src})`,
            parentID: parentId,
        };
        if (ctx && ctx.id && ctx.id !== parentId) payload.previousID = ctx.id;

        try {
            const resp = await fetch("/api/block/insertBlock", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const json = await resp.json();
            return json.code === 0;
        } catch {
            return false;
        }
    }

    /* ── 应用图标 ────────────────────────────────── */

    async applyIcon(blockId, brand) {
        if (!blockId) {
            showMessage(this.i18n.noBlock);
            return false;
        }
        try {
            const iconValue = await this.materialize(brand);
            const resp = await fetch("/api/attr/setBlockAttrs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: blockId, attrs: { icon: iconValue } }),
            });
            const json = await resp.json();
            if (json.code !== 0) throw new Error(json.msg || "setBlockAttrs failed");

            // 数据已写入，但界面不会自动更新，需手动刷新标题图标
            this.refreshTitleIcon(blockId, iconValue);

            showMessage(this.i18n.applied, 2000, "info");
            return true;
        } catch (err) {
            console.error("[LLM Icons]", err);
            showMessage(`${this.i18n.applyFailed}: ${err.message}`);
            return false;
        }
    }

    /**
     * 当前激活文档的 id。
     *
     * 不能用 `.protyle-title[data-node-id]`：思源的标题元素模板里没有这个属性
     * （见 protyle-title 的构造代码），选择器永远为空，导致点图标没反应。
     * 正确做法是走 getAllEditor() 拿 protyle 实例，读 block.rootID —— 这也是
     * 思源内部应用图标后刷新界面时用的同一个来源。
     */
    activeDocId() {
        // 从编辑器工具栏进来时带了 protyle，优先用它，避免多标签页取错
        if (this.activeProtyle && this.activeProtyle.block) {
            return this.activeProtyle.block.rootID || "";
        }
        const list = typeof getAllEditor === "function" ? getAllEditor() : [];
        const editors = list.filter((e) => e && e.protyle && e.protyle.block);

        // 优先：可见且包含当前焦点的编辑器
        const active = document.activeElement;
        if (active) {
            const hit = editors.find(
                (e) =>
                    !e.protyle.element.classList.contains("fn__none") &&
                    e.protyle.element.contains(active)
            );
            if (hit) return hit.protyle.block.rootID || "";
        }

        // 其次：任何可见的编辑器（排除 fn__none 的后台标签页）
        const visible = editors.find(
            (e) => !e.protyle.element.classList.contains("fn__none")
        );
        if (visible) return visible.protyle.block.rootID || "";

        return editors[0]?.protyle.block.rootID || "";
    }

    /** 找到指定文档对应的 protyle 实例，用于刷新界面 */
    protyleOf(docId) {
        const list = typeof getAllEditor === "function" ? getAllEditor() : [];
        return (
            list
                .filter((e) => e && e.protyle && e.protyle.block)
                .find((e) => e.protyle.block.rootID === docId)?.protyle || null
        );
    }

    /**
     * 设置完属性后刷新界面。
     *
     * /api/attr/setBlockAttrs 只写数据，不更新 DOM。思源自己在收到 setAttrs 事务时
     * 是这么刷新的（见 common.js 里处理 icon 变化的分支）：
     *     background.ial.icon = ...; background.render(ial, block.rootID)
     * 这里调用同一个方法，而不是手动拼 DOM —— 后者会漏掉主题、尺寸等细节。
     */
    refreshTitleIcon(docId, iconValue) {
        const protyle = this.protyleOf(docId);
        if (!protyle) return false;

        try {
            const bg = protyle.background;
            if (bg && typeof bg.render === "function") {
                if (!bg.ial) bg.ial = {};
                bg.ial.icon = iconValue;
                bg.render(bg.ial, protyle.block.rootID);
            }
            // 同步更新文件树里的文档图标
            protyle.model?.parent?.setDocIcon?.(iconValue);
            return true;
        } catch (err) {
            console.warn("[LLM Icons] refresh failed", err);
            return false;
        }
    }

    /* ── 选择器 ──────────────────────────────────── */

    openPicker(docId) {
        const targetId = typeof docId === "string" ? docId : this.activeDocId();
        // 打开瞬间记下光标位置：对话框一弹，选区就没了
        this.savedBlockCtx = this.currentBlockContext();

        const GROUPS = [
            { id: "all", label: this.i18n.filterAll },
            { id: "popular", label: this.i18n.filterPopular },
            { id: "model", label: this.i18n.filterModel },
            { id: "provider", label: this.i18n.filterProvider },
            { id: "application", label: this.i18n.filterApplication },
            { id: "cn", label: this.i18n.filterCn },
        ];

        const dialog = new Dialog({
            title: this.i18n.pickerTitle,
            width: "920px",
            height: "680px",
            content: `<div class="b3-dialog__content" style="overflow:hidden;display:flex;padding:12px 16px">
    <div class="lmi">
        <div class="lmi-bar">
            <input class="b3-text-field lmi-search" placeholder="${this.esc(this.i18n.searchPlaceholder)}" autocomplete="off" spellcheck="false">
        </div>
        <div class="lmi-chips"></div>
        <div class="lmi-meta">
            <span class="lmi-count"></span>
            <span class="lmi-hint">${this.esc(this.i18n.hint)}</span>
        </div>
        <div class="lmi-scroll"><div class="lmi-grid"></div></div>
    </div>
</div>`,
        });

        const root = dialog.element;
        const input = root.querySelector(".lmi-search");
        const scroll = root.querySelector(".lmi-scroll");
        const grid = root.querySelector(".lmi-grid");
        const chips = root.querySelector(".lmi-chips");
        const countEl = root.querySelector(".lmi-count");

        let keyword = "";
        let group = "popular";
        let visible = [];
        let shown = 0;
        const PAGE = 120;

        const inGroup = (b) => {
            if (group === "all") return true;
            if (group === "popular") return POPULAR.includes(b.s);
            if (group === "cn") return !!b.c;
            return b.g === group;
        };

        const filter = () => {
            const kw = keyword.trim().toLowerCase();
            // 「常用」按预设顺序展示，其余按字母序
            const pool =
                group === "popular"
                    ? POPULAR.map((slug) => this.brands.find((b) => b.s === slug)).filter(Boolean)
                    : this.brands;
            return pool.filter((b) => {
                if (!inGroup(b)) return false;
                if (!kw) return true;
                return (
                    b.n.toLowerCase().includes(kw) ||
                    b.s.includes(kw) ||
                    (b.c && b.c.includes(kw))
                );
            });
        };

        const cardHtml = (b) => {
            const file = this.fileOf(b);
            // 网格里只显示主名，括号说明放 tooltip，避免被截断成 "Antigravity (..."
            const short = this.shortOf(b);
            const title = b.c ? `${b.n} / ${b.c}` : b.n;
            return `<div class="lmi-card" data-slug="${b.s}" title="${this.esc(title)}">
    <div class="lmi-art"><img src="/plugins/${PLUGIN_NAME}/assets/${file}" alt="${this.esc(short)}" loading="lazy" decoding="async"></div>
    <span class="lmi-name">${this.esc(short)}</span>
    <div class="lmi-acts">
        <button data-act="docicon" aria-label="${this.esc(this.i18n.setAsDocIcon)}" title="${this.esc(this.i18n.setAsDocIcon)}"><svg><use xlink:href="#iconLLMDoc"></use></svg></button>
    </div>
</div>`;
        };

        const renderGrid = (reset) => {
            if (reset) {
                grid.innerHTML = "";
                shown = 0;
            }
            if (!visible.length) {
                if (reset) grid.innerHTML = `<div class="lmi-empty">${this.esc(this.i18n.noResult)}</div>`;
                return;
            }
            const more = grid.querySelector(".lmi-more");
            if (more) more.remove();

            const from = shown;
            const to = Math.min(visible.length, from + PAGE);
            if (from < to) {
                grid.insertAdjacentHTML("beforeend", visible.slice(from, to).map(cardHtml).join(""));
                shown = to;
            }
            if (to < visible.length) {
                grid.insertAdjacentHTML("beforeend", `<div class="lmi-more">${this.esc(this.i18n.scrollMore)}</div>`);
            }
        };

        const refresh = () => {
            visible = filter();
            renderGrid(true);
            const total = this.brands.length;
            // 未筛选时不显示 "全部 357"，避免 "共 357 个 · 收录 357 个" 这种重复文案
            countEl.textContent =
                visible.length === total
                    ? this.i18n.countAll.replace("$1", total)
                    : this.i18n.countFiltered
                          .replace("$1", visible.length)
                          .replace("$2", total);
        };

        const renderChips = () => {
            chips.innerHTML = GROUPS.map(
                (g) => `<button class="lmi-chip${g.id === group ? " on" : ""}" data-g="${g.id}">${this.esc(g.label)}</button>`
            ).join("");
        };

        chips.onclick = (e) => {
            const el = e.target.closest(".lmi-chip");
            if (!el) return;
            group = el.getAttribute("data-g");
            chips.querySelectorAll(".lmi-chip").forEach((c) => {
                c.classList.toggle("on", c.getAttribute("data-g") === group);
            });
            refresh();
        };

        grid.onclick = async (e) => {
            const card = e.target.closest(".lmi-card");
            if (!card) return;
            const brand = this.brands.find((b) => b.s === card.getAttribute("data-slug"));
            if (!brand) return;

            const btn = e.target.closest("button[data-act]");
            card.classList.add("busy");
            try {
                if (btn && btn.getAttribute("data-act") === "docicon") {
                    // 悬停按钮：设为文档图标
                    const ok = await this.applyIcon(targetId, brand);
                    if (ok) dialog.destroy();
                    return;
                }
                // 卡片本体：插入到正文光标处
                const ok = await this.insertToBody(brand);
                if (ok) {
                    showMessage(this.i18n.inserted.replace("$1", brand.n || brand.s), 2000, "info");
                    dialog.destroy();
                } else {
                    showMessage(this.i18n.insertFailed);
                }
            } finally {
                card.classList.remove("busy");
            }
        };

        grid.oncontextmenu = (e) => {
            const card = e.target.closest(".lmi-card");
            if (!card) return;
            e.preventDefault();
            const brand = this.brands.find((b) => b.s === card.getAttribute("data-slug"));
            if (!brand) return;
            const menu = new Menu("lmi-menu");
            menu.addItem({
                icon: "iconImage",
                label: this.i18n.insertBody,
                click: async () => {
                    const ok = await this.insertToBody(brand);
                    if (ok) {
                        showMessage(this.i18n.inserted.replace("$1", brand.n || brand.s), 2000, "info");
                        dialog.destroy();
                    } else {
                        showMessage(this.i18n.insertFailed);
                    }
                },
            });
            menu.addItem({
                icon: "iconDoc",
                label: this.i18n.setAsDocIcon,
                click: async () => {
                    if (await this.applyIcon(targetId, brand)) dialog.destroy();
                },
            });
            menu.open({ x: e.clientX, y: e.clientY });
        };

        this.bindSearchInput(input, {
            onQuery: (v) => {
                keyword = v;
                refresh();
            },
            onEnter: async () => {
                if (!visible.length) return;
                const brand = visible[0];
                const ok = await this.insertToBody(brand);
                if (ok) {
                    showMessage(this.i18n.inserted.replace("$1", brand.n || brand.s), 2000, "info");
                    dialog.destroy();
                }
            },
            onEscape: () => {
                if (input.value) {
                    input.value = "";
                    keyword = "";
                    refresh();
                } else {
                    dialog.destroy();
                }
            },
        });

        let ticking = false;
        scroll.addEventListener("scroll", () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                ticking = false;
                if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 240) {
                    renderGrid(false);
                }
            });
        });

        renderChips();
        refresh();
        setTimeout(() => input.focus(), 60);
    }

    /**
     * 绑定搜索框：处理好中文输入法。
     *
     * 关键点：用 IME 组词时按回车是「确认候选词」，不是「提交」。
     * 不做判断的话，输入 "dee" 再回车会直接插入第一个结果，用户根本没机会确认。
     * - 组词中（isComposing / keyCode 229）不响应回车
     * - 组词中不触发筛选，否则每敲一个字母就重渲染，输入法候选框会被打断
     */
    bindSearchInput(input, { onQuery, onEnter, onEscape }) {
        let composing = false;

        input.addEventListener("compositionstart", () => {
            composing = true;
        });
        input.addEventListener("compositionend", () => {
            composing = false;
            // 组词结束后再按最终文本筛一次
            onQuery(input.value);
        });
        input.addEventListener("input", () => {
            if (composing) return;
            onQuery(input.value);
        });
        input.addEventListener("keydown", (e) => {
            // 输入法正在组词，任何键都交给输入法处理
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") {
                e.preventDefault();
                if (onEnter) onEnter();
            } else if (e.key === "Escape") {
                if (onEscape) onEscape(e);
            }
        });
    }

    esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
        );
    }
};
