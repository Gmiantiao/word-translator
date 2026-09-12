# 证据清单

本文列出的每条结论都可在本仓库复现。命令默认在仓库根目录执行。

---

## 1. 项目规模与开发周期

```bash
git log --reverse --format='%ad | %s' --date=format:'%Y-%m-%d %H:%M'
```

结果：11 个 commit，时间跨度 **2026-06-12 15:59 → 2026-08-13 13:07**，共 62 天。

其中前三个 commit 集中在 9 分钟内：

```
2026-06-12 15:59 | Initial commit: 拾词 Chrome 扩展 v1.1.0
2026-06-12 16:01 | Add README with project documentation
2026-06-12 16:08 | Add screenshots and update README with feature images
```

代码规模：

```bash
wc -l manifest.json background/*.js content/*.js popup/*.js options/*.js words/*.js
```

结果：约 4500 行原生 JavaScript，无框架依赖。

---

## 2. `v2/` 与原版代码逐字节相同

```bash
diff -rq . v2/ --exclude=manifest.json
```

结果：**无输出** —— 除 manifest 外所有文件完全一致。

```bash
diff manifest.json v2/manifest.json
```

结果：仅两行不同

```
3c3
<   "name": "拾词",
---
>   "name": "拾词 v2",
5c5
<   "description": "浏览即拾词 — 划词翻译、收藏注释、高亮复习，中英双语皆是养分",
---
>   "description": "划词即入口 — 选中即翻译、即问 AI、即收藏，阅读里每一段都顺手拾起",
```

---

## 3. 「AI 提问」在初始提交中就已存在

```bash
git log --oneline -S"askAI" -- content/index.js background/service-worker.js
```

结果：

```
9b3dc49 Initial commit: 拾词 Chrome 扩展 v1.1.0
```

即该功能自 2026-06-12 首次提交起就在产品内，早于 2026-08-17 的重新定位会话两个月。

---

## 4. 2026-08-17 那次协作产出 0 个 commit

```bash
git log --oneline --since=2026-08-14 --until=2026-09-11
```

结果：**无输出**。

最后一次功能提交是 `d36c21b`（2026-08-13），早于该会话；此后直到本文档提交之前（2026-09-12），仓库没有任何提交。

> 说明：此处用固定的日期区间而非 `--since=2026-08-17`，因为本文档自身的提交会落在该条件内，导致命令结果随文档提交而失效。区间中不含文档提交日，结论保持稳定。

那三个产物（`README.v2.md`、`STORE_LISTING.v2.md`、`v2/`）生成于 2026-08-17，此后一直停留在本地工作区，直到 2026-09-12 与本文档一并提交。

也就是说：那次协作之后，项目在**一个月内没有产生任何提交**。

---

## 5. 「移除音标功能」留下了未清理的残留

功能已于 `d36c21b`（2026-08-13）移除，但代码中仍保留大量占位：

```bash
grep -rn "phonetic" --include="*.js" background/ content/ popup/ options/ words/
```

典型残留：

- `background/service-worker.js:97` — Notion 同步时仍会创建「音标」字段
- `background/service-worker.js:114` — 仍解构 `phonetic` 属性
- 多处 `phonetic: ''` 空值占位

同时 `README.md` 与 `README.v2.md` 中仍写着「自动获取 IPA 音标」—— **文档与代码不一致**。

---

## 6. README 声称的 CSV 支持未实现

`README.md:49`：

> **导出**：支持 HTML / CSV 格式导出收藏列表

`README.v2.md:44`：

> **批量导入**词条，**HTML / CSV** 格式导出收藏

实际情况：

- **导出**（`words/index.js:267`）只实现了 HTML，无 CSV：

  ```javascript
  const html = buildWordHtml(wordsToDownload);
  ```

- **导入**（`words/index.js:548` 的 `parseImportText`）只支持 JSON 与行分隔（`|`、制表符、` - `、` — `），无逗号解析。

全仓库检索 `csv`（不区分大小写），唯一命中是宣传页里的一句文案 `promo/04-config.html:141`，属于营销文字，非实现。

**文档与代码不一致。**

---

## 7. 决策笔记中的行号已失效

[`decision-note-2026-05-25.md`](./decision-note-2026-05-25.md)（原文件名 `划词翻译-单击取消收藏-2026-05-25.md`，在初始提交中即被包含，日期早于仓库建立）标注：

> 新增 `showHighlightPopup` 函数（第188-249行）

实际位置：

```bash
grep -n "function showHighlightPopup" content/index.js
```

结果：`526:  async function showHighlightPopup(...)`

笔记写于 2026-05-25，至 2026-08-13 最后一次提交时，所记录的行号已偏移 300 余行。

---

## 关于 2026-08-17 会话记录

该次协作的完整逐轮记录存放于：

```
~/.claude/projects/-Users-kuai-workspace/9928ab86-0c71-49f0-91ca-5ffc55f89cef.jsonl
```

本案例正文中引用的对话原文均出自该文件。如需将完整记录一并归档到本仓库，请显式指定来源与目标路径。
