/**
 * UI 集成测试：在真实 DOM（jsdom）里跑 openPicker，
 * 验证对话框结构、搜索过滤、分类筛选、点击应用图标、错误路径。
 *
 * 运行：node scripts/ui-test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "index.js"), "utf8");
const brands = JSON.parse(fs.readFileSync(path.join(root, "src", "brands.json"), "utf8"));

let pass = 0;
let fail = 0;
const check = (name, cond, extra) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
};

const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url: "http://127.0.0.1:6806/" });
const { window } = dom;

/* ── 记录网络调用 ──────────────────────────────── */
const calls = [];
const files = new Map();

const fetchStub = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || "GET" });

    if (u.includes("brands.json")) {
        return { ok: true, status: 200, json: async () => brands };
    }
    if (u.includes("/api/file/readDir")) {
        const list = [...files.keys()].map((n) => ({ name: n, isDir: false }));
        return { ok: true, status: 200, json: async () => ({ code: 0, data: list }) };
    }
    if (u.includes("/api/file/putFile")) {
        const p = opts.body?.__path || "";
        const name = p.split("/").pop();
        if (name) files.set(name, true);
        return { ok: true, status: 200, json: async () => ({ code: 0, data: null }) };
    }
    if (u.includes("/api/attr/setBlockAttrs")) {
        const body = JSON.parse(opts.body);
        calls.push({ url: u, method: "POST", attr: body });
        return { ok: true, status: 200, json: async () => ({ code: 0, data: null }) };
    }
    if (u.includes("/api/asset/upload")) {
        calls.push({ url: u, method: "POST", upload: true });
        return {
            ok: true, status: 200,
            json: async () => ({ code: 0, data: { succMap: { "openai-color.svg": "assets/llm-icons/openai-color.svg" } } }),
        };
    }
    if (u.includes("/api/block/insertBlock")) {
        calls.push({ url: u, method: "POST", insertBlock: true });
        return { ok: true, status: 200, json: async () => ({ code: 0 }) };
    }
    if (u.includes("/plugins/") && u.includes("/assets/")) {
        return { ok: true, status: 200, blob: async () => ({ type: "image/svg+xml" }) };
    }
    return { ok: false, status: 404, json: async () => ({ code: 404 }) };
};

class FD {
    constructor() { this.__path = ""; }
    append(k, v) { if (k === "path") this.__path = v; }
}

/* ── siyuan 模块桩 ─────────────────────────────── */
class FakePlugin {
    constructor() {
        this.name = "siyuan-plugin-LLM-icons";
        this.i18n = JSON.parse(fs.readFileSync(path.join(root, "i18n", "zh_CN.json"), "utf8"));
        this.eventBus = { on() {} };
    }
    addIcons() {}
    addCommand() {}
    addTopBar() {}
}

const messages = [];
const fakeDialog = class {
    constructor(opts) {
        this.opts = opts;
        const wrap = window.document.createElement("div");
        wrap.innerHTML = opts.content;
        this.element = wrap;
        window.document.body.appendChild(wrap);
    }
    destroy() {
        this.element.remove();
    }
};

/* 编辑器桩 */
const UI_DOC_ID = "20260202-uidoc";
let uiIconRefreshed = null;
const wysiwygEl = window.document.createElement("div");
wysiwygEl.className = "protyle-wysiwyg";
wysiwygEl.isConnected; // 占位
Object.defineProperty(wysiwygEl, "isConnected", { get: () => true });
window.document.body.appendChild(wysiwygEl);

let insertedHTML = "";
const fakeProtyle = {
    block: { rootID: UI_DOC_ID },
    element: { classList: { contains: () => false }, contains: () => true },
    wysiwyg: { element: wysiwygEl },
    focus() {},
    insert(html) {
        insertedHTML = html;
        const tpl = window.document.createElement("div");
        tpl.innerHTML = html;
        while (tpl.firstChild) wysiwygEl.appendChild(tpl.firstChild);
    },
    background: {
        ial: {},
        render() { uiIconRefreshed = this.ial.icon; },
    },
    model: { parent: { setDocIcon: (v) => { uiIconRefreshed = v; } } },
};

// Menu 在插件里是模块加载时解构的，后面换 stub 无效，
// 所以让桩自己记录所有实例，测试直接取最后一个
const menuInstances = [];
class FakeMenu {
    constructor() { this.items = []; menuInstances.push(this); }
    addItem(i) { this.items.push(i); }
    addSeparator() {}
    open() {}
    findByLabel(l) { return this.items.find((i) => i.label === l); }
}

const sandbox = {
    console,
    fetch: fetchStub,
    document: window.document,
    window: window,
    setTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    MutationObserver: window.MutationObserver,
    KeyboardEvent: window.KeyboardEvent,
    FormData: FD,
    Blob: class { constructor(p) { this.parts = p; } },
    require: (m) => (m === "siyuan" ? {
        Plugin: FakePlugin,
        Dialog: fakeDialog,
        Menu: FakeMenu,
        showMessage: (msg) => messages.push(msg),
        getAllEditor: () => [{ protyle: fakeProtyle }],
    } : null),
    module: { exports: {} },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "index.js" });
const Plugin = sandbox.module.exports;

const p = new Plugin();
await p.onload();

const q = (sel) => window.document.querySelector(sel);
const qa = (sel) => [...window.document.querySelectorAll(sel)];
const cards = () => qa(".lmi-card");

console.log("1) 打开选择器（Dashboard 风格）");
p.openPicker(UI_DOC_ID);
check("根容器 .lmi 存在", !!q(".lmi"));
check("有搜索框", !!q(".lmi-search"));
check("有分类 chips（6 个）", qa(".lmi-chip").length === 6, `实际 ${qa(".lmi-chip").length}`);
check("默认停在「常用」", qa(".lmi-chip").find((c) => c.dataset.g === "popular")?.classList.contains("on"));
check("首屏只展示常用（少而精）", cards().length <= 30, `实际 ${cards().length}`);
check("有计数行", !!q(".lmi-count"));
check("有滚动容器 .lmi-scroll", !!q(".lmi-scroll"));
check("有网格 .lmi-grid", !!q(".lmi-grid"));
check("旧 llmi-* 类名已清除", qa('[class*="llmi-"]').length === 0);

console.log("2) 首屏渲染与分页");
check("渲染出卡片", cards().length > 0, `实际 ${cards().length}`);
check("首屏最多 120 张（分页）", cards().length <= 120, `实际 ${cards().length}`);
// 常用只有 27 个，不该出现分页提示；全部分类才有
check("常用分类无需分页", !q(".lmi-more"));

console.log("3) 卡片结构");
const first = cards()[0];
check("卡片有 .lmi-art 图标容器", !!first.querySelector(".lmi-art img"));
check("卡片有 .lmi-name 文字", !!first.querySelector(".lmi-name"));
const imgSrc = first.querySelector("img").getAttribute("src");
check("img 走 /plugins/ 路径", imgSrc.startsWith("/plugins/siyuan-plugin-LLM-icons/assets/"));
check("img 是 svg", imgSrc.endsWith(".svg"));
check("卡片有 title 提示", !!first.getAttribute("title"));

console.log("4) 搜索过滤");
const input = q(".lmi-search");
// 搜索是全库范围，不受当前分类限制

input.value = "豆包";
input.dispatchEvent(new window.Event("input", { bubbles: true }));
check("中文搜索命中豆包", cards().length === 1 && cards()[0].dataset.slug === "doubao",
    cards().map((c) => c.dataset.slug).join(","));

input.value = "zzzzzz";
input.dispatchEvent(new window.Event("input", { bubbles: true }));
check("无结果显示空状态", !!q(".lmi-empty"));

input.value = "";
input.dispatchEvent(new window.Event("input", { bubbles: true }));
check("搜索清空后回到当前分类", cards().length > 0);

console.log("5) 分类 chips 筛选");
const modelChip = qa(".lmi-chip").find((c) => c.dataset.g === "model");
modelChip.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("chip 变为选中态", modelChip.classList.contains("on"));
const modelSet = new Set(brands.filter((b) => b.g === "model").map((b) => b.s));
const slugs = cards().map((c) => c.dataset.slug);
check("只显示 model 分类", slugs.length > 0 && slugs.every((s) => modelSet.has(s)),
    slugs.filter((s) => !modelSet.has(s)).slice(0, 3).join(","));
check("筛选后显示对比计数", /共 \d+ 个 · 全部 \d+ 个/.test(q(".lmi-count").textContent),
    q(".lmi-count").textContent);

const allChip = qa(".lmi-chip").find((c) => c.dataset.g === "all");
allChip.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("切回全部", allChip.classList.contains("on"));
check("全部时计数不重复", q(".lmi-count").textContent === `共 ${brands.length} 个品牌`,
    q(".lmi-count").textContent);
check("全部出现分页提示", !!q(".lmi-more"));

console.log("5.5) 常用 / 中文分类");
qa(".lmi-chip").find((c) => c.dataset.g === "popular")
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const popSlugs = cards().map((c) => c.dataset.slug);
check("常用分类只含预设品牌", popSlugs.length > 0 && popSlugs.includes("openai") && popSlugs.includes("claude"),
    popSlugs.slice(0, 6).join(","));
check("常用按频率排序（openai 在首位）", popSlugs[0] === "openai", popSlugs[0]);

qa(".lmi-chip").find((c) => c.dataset.g === "cn")
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const cnSlugs = cards().map((c) => c.dataset.slug);
const cnSet = new Set(brands.filter((b) => b.c).map((b) => b.s));
check("中文品牌分类只含有中文名的", cnSlugs.length > 0 && cnSlugs.every((s) => cnSet.has(s)),
    cnSlugs.filter((s) => !cnSet.has(s)).slice(0, 3).join(","));

allChip.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

console.log("6) 点击卡片 = 插入正文（不是改文档图标）");
calls.length = 0;
insertedHTML = "";
wysiwygEl.innerHTML = "";
const target = cards().find((c) => c.dataset.slug === "openai") || cards()[0];
target.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 100));

check("没有调用 setBlockAttrs", !calls.some((c) => c.attr));
check("调用了 asset 上传", calls.some((c) => c.upload));
const insertedImg = wysiwygEl.querySelector("img");
check("正文里插入了 img", !!insertedImg, insertedHTML || "(未插入)");
check("img 指向 /assets/", (insertedImg?.getAttribute("src") || "").startsWith("assets/llm-icons/")
    || (insertedImg?.getAttribute("src") || "").startsWith("/assets/llm-icons/"),
    insertedImg?.getAttribute("src"));
check("img 有 alt", !!insertedImg?.getAttribute("alt"));
check("对话框已关闭", !q(".lmi"));
check("提示已插入", messages.some((m) => m.includes("已插入")), messages.join("|"));

console.log("7) 悬停按钮 = 设为文档图标");
calls.length = 0;
uiIconRefreshed = null;
p.openPicker(UI_DOC_ID);
await new Promise((r) => setTimeout(r, 30));
const card2 = cards()[0];
const actBtn = card2.querySelector('button[data-act="docicon"]');
check("卡片有设为文档图标按钮", !!actBtn);
actBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 100));

const attrCall = calls.find((c) => c.attr);
check("点按钮才调 setBlockAttrs", !!attrCall);
check("块 id 正确", attrCall?.attr?.id === UI_DOC_ID, attrCall?.attr?.id);
check("icon 值为 <组>/<文件>.svg", /^llm-icons\/.+\.svg$/.test(attrCall?.attr?.attrs?.icon || ""),
    attrCall?.attr?.attrs?.icon);
check("界面刷新已触发", uiIconRefreshed === attrCall?.attr?.attrs?.icon, String(uiIconRefreshed));

console.log("8) 右键菜单两个选项都在");
p.openPicker(UI_DOC_ID);
await new Promise((r) => setTimeout(r, 30));
menuInstances.length = 0;
cards()[0].dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
const capturedMenu = menuInstances[menuInstances.length - 1];
check("右键弹出菜单", !!capturedMenu);
check("菜单含「插入到正文」", !!capturedMenu?.findByLabel("插入到正文"),
    capturedMenu?.items.map((i) => i.label).join(","));
check("菜单含「设为文档图标」", !!capturedMenu?.findByLabel("设为文档图标"),
    capturedMenu?.items.map((i) => i.label).join(","));

console.log("9) 无编辑器时降级到 API");
calls.length = 0;
const realProtyles = p.collectProtyles;
p.collectProtyles = () => [];
p.openPicker(UI_DOC_ID);
await new Promise((r) => setTimeout(r, 30));
cards()[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 120));
check("降级调用了 insertBlock", calls.some((c) => c.insertBlock));
p.collectProtyles = realProtyles;
window.document.querySelectorAll(".lmi").forEach((el) => el.remove());

console.log("10) 表情面板内嵌 tab");
// 造一个和思源一致的对话框结构
window.document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="b3-dialog"><div class="emojis">
        <div class="emojis__tabheader">
            <div data-type="tab-emoji" class="block__icon"></div><div class="fn__space"></div>
            <div data-type="tab-custom" class="block__icon"></div><div class="fn__space"></div>
            <div data-type="tab-dynamic" class="block__icon"></div><div class="fn__space"></div>
            <div data-type="tab-link" class="block__icon"></div><div class="fn__space"></div>
        </div>
        <div class="emojis__tabbody">
            <div data-type="tab-emoji"></div>
            <div class="fn__none" data-type="tab-dynamic"></div>
        </div>
     </div></div>`
);
p.watchEmojiDialog();

const tab = window.document.querySelector(".lmi-emoji-tab");
check("注入了 tab 图标", !!tab);
check("tab 带插件图标", /iconLLMIcons/.test(tab?.innerHTML || ""));
check("tab 带 data-type", tab?.getAttribute("data-type") === "tab-llm");
check("注入了对应内容面板", !!window.document.querySelector('.lmi-ep[data-type="tab-llm"]'));

tab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));

const pane = window.document.querySelector(".lmi-ep");
check("点击后内容面板展开", !pane.classList.contains("fn__none"));
check("tab 变为选中态", tab.classList.contains("block__icon--active"));
check("其他 tab 内容被收起",
    window.document.querySelector('.emojis__tabbody > [data-type="tab-emoji"]').classList.contains("fn__none"));
check("默认展示常用品牌", window.document.querySelectorAll(".lmi-ep-item").length === 27,
    String(window.document.querySelectorAll(".lmi-ep-item").length));
check("自带搜索框", !!window.document.querySelector(".lmi-ep-search"));

const epInput = window.document.querySelector(".lmi-ep-search");
epInput.value = "豆包";
epInput.dispatchEvent(new window.Event("input", { bubbles: true }));
check("面板内搜索生效", window.document.querySelectorAll(".lmi-ep-item").length === 1,
    String(window.document.querySelectorAll(".lmi-ep-item").length));
check("搜到的是豆包",
    window.document.querySelector(".lmi-ep-item")?.dataset.slug === "doubao");

epInput.value = "zzzzz";
epInput.dispatchEvent(new window.Event("input", { bubbles: true }));
check("无结果有空状态", !!window.document.querySelector(".lmi-ep-empty"));

check("重复调用不会注入第二个 tab", (() => {
    p.watchEmojiDialog();
    return window.document.querySelectorAll(".lmi-emoji-tab").length === 1;
})());

console.log("10.5) 中文输入法：组词时回车不提交");
p.openPicker(UI_DOC_ID);
await new Promise((r) => setTimeout(r, 30));
const imeInput = q(".lmi-search");
const imeDialogEl = q(".lmi");
const baseCount = cards().length;

// composition 事件必须派发在 input 本身上（它不会冒泡到子元素）
imeInput.dispatchEvent(new window.CompositionEvent("compositionstart", { bubbles: true }));
imeInput.value = "dee";
imeInput.dispatchEvent(new window.Event("input", { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
check("组词期间不重新筛选", cards().length === baseCount, `变成 ${cards().length}`);

imeInput.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })
);
await new Promise((r) => setTimeout(r, 80));
check("组词期间回车不插入", !!q(".lmi"), "对话框被关掉了");

imeInput.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true })
);
await new Promise((r) => setTimeout(r, 80));
check("keyCode 229 回车也不插入", !!q(".lmi"));

// 组词结束才用最终文本筛选
imeInput.dispatchEvent(new window.CompositionEvent("compositionend", { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
check("组词结束后重新筛选", cards().length === 1 && cards()[0].dataset.slug === "deepseek",
    `${cards().length} / ${cards()[0]?.dataset.slug}`);

// 非组词状态的回车应当正常提交（这里走标头模式，会设图标）
calls.length = 0;
imeInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
await new Promise((r) => setTimeout(r, 120));
check("正常回车仍然提交", calls.some((c) => c.attr || c.upload), "没有触发动作");
window.document.querySelectorAll(".lmi").forEach((el) => el.remove());

console.log("11) 标头模式选中图标 = 替换文档图标（不插正文）");
// 标头模式下垃圾桶可见，代表「设置图标」场景
window.document.querySelector(".b3-dialog").insertAdjacentHTML(
    "beforeend",
    '<span class="block__icon" data-action="remove"></span>'
);
calls.length = 0;
wysiwygEl.innerHTML = "";
uiIconRefreshed = null;

const iconPaneInput = window.document.querySelector(".lmi-ep-search");
iconPaneInput.value = "claude";
iconPaneInput.dispatchEvent(new window.Event("input", { bubbles: true }));
await new Promise((r) => setTimeout(r, 30));
window.document.querySelector(".lmi-ep-item").dispatchEvent(
    new window.MouseEvent("click", { bubbles: true })
);
await new Promise((r) => setTimeout(r, 120));

check("调用了 setBlockAttrs", calls.some((c) => c.attr));
check("没有插入到正文", !wysiwygEl.querySelector("img"));
check("没有上传 assets", !calls.some((c) => c.upload));
check("图标值格式正确",
    /^llm-icons\/.+\.svg$/.test(calls.find((c) => c.attr)?.attr?.attrs?.icon || ""),
    calls.find((c) => c.attr)?.attr?.attrs?.icon);
check("标题图标已刷新", !!uiIconRefreshed, String(uiIconRefreshed));
check("面板用完关闭", !window.document.querySelector(".emojis"));

console.log("12) 插入模式选中图标 = 插入正文");
window.document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="b3-dialog"><div class="emojis">
        <div class="emojis__tabheader">
            <div data-type="tab-link" class="block__icon"></div><div class="fn__space"></div>
            <span class="block__icon fn__none" data-action="remove"></span>
        </div>
        <div class="emojis__tabbody"><div data-type="tab-emoji"></div></div>
     </div></div>`
);
p.watchEmojiDialog(); // 面板已进 DOM，注入
await new Promise((r) => setTimeout(r, 30));
const tab2 = [...window.document.querySelectorAll(".lmi-emoji-tab")].pop();
tab2.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
calls.length = 0;
wysiwygEl.innerHTML = "";
[...window.document.querySelectorAll(".lmi-ep-item")][0].dispatchEvent(
    new window.MouseEvent("click", { bubbles: true })
);
await new Promise((r) => setTimeout(r, 120));
// 资产可能命中缓存不再重新上传，所以判断「有没有动文档图标」更本质
check("插入模式不改文档图标", !calls.some((c) => c.attr));
check("插入模式下正文出现图片", !!wysiwygEl.querySelector("img"));
check("插入模式图片指向 assets",
    (wysiwygEl.querySelector("img")?.getAttribute("src") || "").includes("/assets/llm-icons/"),
    wysiwygEl.querySelector("img")?.getAttribute("src"));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
