#!/usr/bin/env node
/**
 * 生成插件资源：
 *   - src/brands.json   品牌索引（供 index.js 搜索用）
 *   - assets/*.svg      图标文件（彩色优先，仅收录 TOC 里的品牌）
 *
 * 数据源：Lobe Icons (https://github.com/lobehub/lobe-icons)，MIT License
 *   - TOC  (es/toc2.mjs)      品牌元数据：fullTitle / docsUrl / group / 变体能力
 *   - SVG  (icons/*.svg)      静态图标
 *
 * 用法（二选一）：
 *   node scripts/build-index.mjs --toc <toc2.mjs> --svg <svg 目录>
 *   或直接把 lobe-icons 仓库源码放到 ../lobe-icons-src 后运行 npm run build:index
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : fallback;
};

const tocFile = arg("toc", path.join(root, "..", "lobe-icons-src", "es", "toc2.mjs"));
const svgDir = arg("svg", path.join(root, "..", "lobe-icons-src", "icons"));

for (const [label, p] of [["TOC", tocFile], ["SVG 目录", svgDir]]) {
    if (!fs.existsSync(p)) {
        console.error(`找不到${label}：${p}`);
        console.error("请用 --toc / --svg 指定，或把 lobe-icons 源码放到 ../lobe-icons-src");
        process.exit(1);
    }
}

const tocSrc = fs.readFileSync(tocFile, "utf8");
const toc = JSON.parse(tocSrc.slice(tocSrc.indexOf("["), tocSrc.lastIndexOf("]") + 1));

const svgFiles = new Set(fs.readdirSync(svgDir).filter((f) => f.endsWith(".svg")));
const baseOf = (f) =>
    f.replace(/-(color|text|text-cn|brand|brand-color)\.svg$/, "").replace(/\.svg$/, "");
const bases = new Set([...svgFiles].map(baseOf));

const outAssets = path.join(root, "assets");
fs.rmSync(outAssets, { recursive: true, force: true });
fs.mkdirSync(outAssets, { recursive: true });

const aliasFile = path.join(__dirname, "cn-alias.json");
const alias = fs.existsSync(aliasFile)
    ? JSON.parse(fs.readFileSync(aliasFile, "utf8"))
    : {};

const brands = [];
const skipped = [];

for (const x of toc) {
    const base = x.docsUrl.replace(/-/g, "");
    if (!bases.has(base)) {
        skipped.push(x.docsUrl);
        continue;
    }
    const p = x.param || {};
    const variants = [];
    if (p.hasColor) variants.push("color");
    if (p.hasText) variants.push("text");
    if (p.hasTextCn) variants.push("text-cn");
    if (p.hasBrand) variants.push("brand");
    if (p.hasBrandColor) variants.push("brand-color");

    // 彩色优先，其次单色 —— 保证选择器里有品牌观感。
    // 上游 TOC 的 hasColor 偶尔与实际文件不符（如 command-code），这里按序回退。
    const candidates = [];
    if (variants.includes("color")) candidates.push(`${base}-color.svg`);
    candidates.push(`${base}.svg`);
    if (variants.includes("brand-color")) candidates.push(`${base}-brand-color.svg`);
    if (variants.includes("brand")) candidates.push(`${base}-brand.svg`);

    const primaryFile = candidates.find((f) => svgFiles.has(f));
    if (!primaryFile) {
        skipped.push(x.docsUrl);
        continue;
    }
    // 记录实际使用的变体，供前端判断
    const actualVariant = primaryFile.startsWith(`${base}-`)
        ? primaryFile.slice(base.length + 1, -4)
        : "";
    fs.copyFileSync(path.join(svgDir, primaryFile), path.join(outAssets, primaryFile));

    // fullTitle 形如 "Ai360 (360智脑)" / "AI Studio (Google)"：
    // 括号内是中文才当作别名，否则保留完整名（"(Google)" 之类不是别名）
    let name = x.fullTitle;
    let cnFromTitle = "";
    const m = name.match(/^(.*?)\s*[（(]([^)）]+)[)）]\s*$/);
    if (m) {
        const outside = m[1].trim();
        const inside = m[2].trim();
        const hasCJK = /[\u4e00-\u9fff]/.test(inside);
        if (hasCJK) {
            name = outside;
            cnFromTitle = inside;
        }
    }

    brands.push({
        s: base,
        n: name,
        c: alias[base] || cnFromTitle,
        g: x.group || "",
        k: x.color || "",
        v: variants,
        // 打包时实际选用的变体，前端直接用它拼文件名，避免再猜一次
        p: actualVariant,
    });
}

brands.sort((a, b) => a.n.localeCompare(b.n, "en"));
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.writeFileSync(path.join(root, "src", "brands.json"), JSON.stringify(brands));

const assets = fs.readdirSync(outAssets);
const bytes = assets.reduce((n, f) => n + fs.statSync(path.join(outAssets, f)).size, 0);
console.log(`品牌 ${brands.length} 个 / 图标 ${assets.length} 个 / ${(bytes / 1024).toFixed(0)} KB`);
console.log(`中文别名覆盖 ${brands.filter((b) => b.c).length} 个`);
if (skipped.length) console.warn(`跳过 ${skipped.length} 个：${skipped.slice(0, 8).join(", ")}`);
