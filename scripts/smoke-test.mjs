/**
 * 无头冒烟测试：用桩替代 siyuan 模块，验证插件逻辑能跑通。
 * 只测纯逻辑（索引加载、搜索过滤、文件名拼装、esc），不碰真实 UI。
 *
 * 运行：node scripts/smoke-test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "index.js"), "utf8");

let pass = 0;
let fail = 0;
const check = (name, cond, extra) => {
    if (cond) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`);
    }
};

/* ── 桩：getAllEditor 返回的编辑器 ──────────────── */
const DOC_ID = "20260101-rootdoc";
let iconRefreshed = null;
const fakeProtyle = {
    id: "protyle-1",
    block: { rootID: DOC_ID, id: DOC_ID },
    element: {
        classList: { contains: () => false },
        contains: () => false,
        querySelector: () => null,
    },
    title: { element: { querySelector: () => null } },
    background: {
        ial: {},
        render() {
            iconRefreshed = this.ial.icon;
        },
    },
    model: { parent: { setDocIcon: (v) => { iconRefreshed = v; } } },
};

/* ── 桩：siyuan 模块 ────────────────────────────── */
class FakePlugin {
    constructor() {
        this.name = "siyuan-plugin-LLM-icons";
        this.i18n = new Proxy({}, { get: (_, k) => String(k) });
        this.eventBus = { on() {} };
        this.commands = [];
        this.topBars = [];
        this.symbols = [];
    }
    addIcons(s) { this.symbols.push(s); }
    addCommand(c) { this.commands.push(c); }
    addTopBar(t) { this.topBars.push(t); }
    addStatusBar(b) { this.statusBars = this.statusBars || []; this.statusBars.push(b); }
    addBreadcrumbButton(b) { this.breadcrumbBtns = this.breadcrumbBtns || []; this.breadcrumbBtns.push(b); return b.id; }
    addToolbarItem(t) { this.toolbarItems = this.toolbarItems || []; this.toolbarItems.push(t); }
    async loadData() { return null; }
    async saveData(k, v) { (this.saved ||= {})[k] = v; }
}
const fakeDialog = class {
    constructor(opts) {
        this.opts = opts;
        this.element = { querySelector: () => null };
    }
    destroy() {}
};
const siyuanStub = {
    Plugin: FakePlugin,
    Dialog: fakeDialog,
    showMessage: () => {},
    getAllEditor: () => [{ protyle: fakeProtyle }],
};

/* ── 桩：浏览器环境 ─────────────────────────────── */
const brands = JSON.parse(fs.readFileSync(path.join(root, "src", "brands.json"), "utf8"));
const allFiles = brands.map((b) => ({
    name: b.p ? `${b.s}-${b.p}.svg` : `${b.s}.svg`,
    isDir: false,
}));

const fetchStub = async (url) => {
    const u = String(url);
    if (u.includes("brands.json")) {
        return { ok: true, json: async () => brands };
    }
    if (u.includes("/api/file/readDir")) {
        return { ok: true, status: 200, json: async () => ({ code: 0, data: allFiles }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
};

const sandbox = {
    console,
    fetch: fetchStub,
    document: {
        querySelector: () => null,
        querySelectorAll: () => [],
        body: { appendChild: () => {}, insertAdjacentHTML: () => {} },
        createElement: () => {
            const attrs = {};
            return {
                className: "",
                innerHTML: "",
                setAttribute: (k, v) => { attrs[k] = v; },
                getAttribute: (k) => attrs[k] ?? null,
                addEventListener: () => {},
            };
        },
    },
    window: { siyuan: {} },
    setTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    FormData: class { append() {} },
    Blob: class {},
    require: (m) => (m === "siyuan" ? siyuanStub : createRequire(import.meta.url)(m)),
    module: { exports: {} },
};
sandbox.exports = sandbox.module.exports;
vm.createContext(sandbox);

console.log("1) 语法解析");
let PluginClass;
try {
    vm.runInContext(src, sandbox, { filename: "index.js" });
    PluginClass = sandbox.module.exports;
    check("index.js 可解析且导出类", typeof PluginClass === "function");
} catch (err) {
    check("index.js 可解析", false, err.message);
    process.exit(1);
}

console.log("2) 生命周期");
const p = new PluginClass();
await p.onload();
check("onload 不抛错", true);
check("注册了 1 个命令", p.commands.length === 1, `实际 ${p.commands.length}`);
check("命令带快捷键", p.commands[0]?.hotkey === "⌥⌘Y");
check(
    "快捷键不与 DevTools 冲突",
    !["⌥⌘I", "⌥⌘J", "⌥⌘C"].includes(p.commands[0]?.hotkey),
    p.commands[0]?.hotkey
);
check("注册了顶栏按钮", p.topBars.length === 1);
check("注册了图标 symbol", p.symbols.length === 1);
check("品牌索引已加载", p.brands.length === 357, `实际 ${p.brands.length}`);

console.log("3) 数据完整性");
const required = ["s", "n", "g", "p", "v"];
const bad = p.brands.filter((b) => required.some((k) => b[k] === undefined));
check("每条都有必要字段", bad.length === 0, bad.slice(0, 2).map((b) => b.s).join(","));
check("无重复 slug", new Set(p.brands.map((b) => b.s)).size === p.brands.length);
const files = new Set(fs.readdirSync(path.join(root, "assets")));
const missing = p.brands
    .map((b) => (b.p ? `${b.s}-${b.p}.svg` : `${b.s}.svg`))
    .filter((f) => !files.has(f));
check("索引引用的图标文件都存在", missing.length === 0, missing.slice(0, 3).join(","));
const unused = [...files].filter(
    (f) => !p.brands.some((b) => (b.p ? `${b.s}-${b.p}.svg` : `${b.s}.svg`) === f)
);
check("assets 无多余文件", unused.length === 0, unused.slice(0, 3).join(","));

console.log("4) 搜索逻辑");
const biz = (kw, group = "") =>
    p.brands.filter((b) => {
        if (group && b.g !== group) return false;
        const k = kw.toLowerCase();
        return b.n.toLowerCase().includes(k) || b.s.includes(k) || (b.c && b.c.includes(k));
    });
check("英文名可搜 (claude)", biz("claude").length > 0);
check("slug 可搜 (deepseek)", biz("deepseek").length > 0);
check("中文名可搜 (豆包)", biz("豆包").some((b) => b.s === "doubao"));
check("中文名可搜 (智谱)", biz("智谱").length > 0);
check("中文名可搜 (通义)", biz("通义").length > 0);
check("分组过滤生效", biz("", "model").every((b) => b.g === "model"));
check("中文别名数量 >= 40", p.brands.filter((b) => b.c).length >= 40,
    `实际 ${p.brands.filter((b) => b.c).length}`);

console.log("5) 名称清洗");
const dirty = p.brands.filter((b) => /[（(][^)）]*[\u4e00-\u9fff][^)）]*[)）]/.test(b.n));
check("显示名不含中文括号", dirty.length === 0, dirty.slice(0, 2).map((b) => b.n).join(","));

console.log("6) 文档 id 与界面刷新");
check("activeDocId 取自 getAllEditor", p.activeDocId() === DOC_ID, p.activeDocId());
check("protyleOf 能按 id 找到实例", p.protyleOf(DOC_ID) === fakeProtyle);
check("找不到时返回 null", p.protyleOf("nonexistent") === null);
iconRefreshed = null;
const refreshed = p.refreshTitleIcon(DOC_ID, "llm-icons/openai.svg");
check("refreshTitleIcon 返回 true", refreshed === true);
check("刷新后 ial.icon 已更新", fakeProtyle.background.ial.icon === "llm-icons/openai.svg");
check("图标值同步到了标签页", iconRefreshed === "llm-icons/openai.svg", String(iconRefreshed));

console.log("7) 注入入口");
check("注册了面包屑按钮", (p.breadcrumbBtns || []).length === 1);
check("面包屑按钮带图标与标题",
    p.breadcrumbBtns?.[0]?.icon === "iconLLMIcons" && !!p.breadcrumbBtns?.[0]?.title);
check("面包屑按钮有回调", typeof p.breadcrumbBtns?.[0]?.callback === "function");
console.log("9) HTML 转义");
check("转义 <script>", p.esc("<script>") === "&lt;script&gt;");
check("转义引号", p.esc('a"b') === "a&quot;b");
check("null 安全", p.esc(null) === "");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
