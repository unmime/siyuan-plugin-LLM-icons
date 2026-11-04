# LLM Icons

AI / LLM brand logos for SiYuan notes — insert them into the text, or set them as document icons. **357 brands**, searchable by English or Chinese name.

Icons come from [Lobe Icons](https://github.com/lobehub/lobe-icons) (MIT License).

## Usage

The entry is a **four-point sparkle icon**, available in three places:

- **Emoji panel** — open the emoji picker from the document icon, click the sparkle in its header row.
  It switches in place to brand icons with its own search box — no extra window.
  What clicking does depends on how the panel was opened:
  - opened from the **document title icon** → the chosen icon **replaces the document icon**
  - opened from **insert emoji in the body** → the chosen icon is **inserted at the cursor**

- **Bottom bar** — the leftmost sparkle in the editor breadcrumb (if your theme moves the breadcrumb to the bottom, it's the left end of that floating pill)
- **Top bar** — the sparkle in the top-right toolbar
- **Hotkey** — `⌥⌘Y` (macOS) / `Alt+Ctrl+Y`

You can also right-click the icon next to the document title.

The panel opens with the cursor already in the search box — type to filter, then press **Enter**
or click a card to insert.

Type a brand name (English or Chinese both work), or filter with the chips: **All / Popular / Models / Providers / Apps / Chinese**.

- **Left click a card** — insert the icon at the cursor
- **Hover, then click the top-right button** — set it as the document icon
- **Right click a card** — both actions in a menu

Inserted icons go to `assets/llm-icons/`, so they travel with the document.


## Coverage

| Type | Count |
| --- | --- |
| Models | 74 |
| Providers | 147 |
| Applications | 136 |

Includes OpenAI, Claude, Gemini, DeepSeek, Qwen, Doubao, Moonshot/Kimi, Zhipu, Baichuan, Hunyuan, Wenxin, MiniMax, Mistral, Llama, Grok and more.

## How it works

Icon files are stored in `data/emojis/llm-icons/`, the same location SiYuan uses for custom emoji. As a result:

- They sync with your workspace and work across devices
- Icons are written **on demand** — only the ones you actually pick get copied, instead of all 357 up front

## License & attribution

- Plugin code: MIT
- Icon assets: [Lobe Icons](https://github.com/lobehub/lobe-icons), MIT License, Copyright © 2023 LobeHub
- All brand logos are trademarks of their respective owners. This plugin uses them solely for document identification purposes and implies no affiliation or endorsement.
