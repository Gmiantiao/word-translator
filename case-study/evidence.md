# 证据清单

本文列出的每条结论都可在本仓库复现。命令默认在仓库根目录执行。

**所有命令都锚定到具体 commit，而不是工作区或 `HEAD`。** 两个有历史意义的锚点是：

| 锚点 | 含义 | 日期 |
|---|---|---|
| `d36c21b` | 2026-08-17 那次协作发生时，代码的最后状态 | 2026-08-13 |
| `54d3f36` | `v2/` 物证归档进 git 的那次提交 | 2026-09-12 |

用 `git show <commit>:<path>` 读某棵树里的内容，用 `git diff <commit>:<path> <commit>:<path>` 比较两棵树——两者都不受工作区后续改动影响。这是本清单能长期成立的前提（理由见文末）。

---

## 1. 项目规模与开发周期

开发期提交数（截至最后一次功能提交 `d36c21b`）：

```bash
git rev-list --count d36c21b
```

结果：`11`。时间跨度 **2026-06-12 15:59 → 2026-08-13 13:07**，共 62 天。

> 用 `d36c21b` 而非 `HEAD` 计数，是因为本案例自身的归档提交会排在它之后；这样引用不会随文档提交而失效。

完整时间线（截至 `v2/` 归档；`--reverse` 是最旧在前，故归档提交排在**最后**）：

```bash
git log --reverse --format='%ad | %s' --date=format:'%Y-%m-%d %H:%M' 54d3f36
```

结果 13 行。开发期的前三个提交集中在 9 分钟内：

```
2026-06-12 15:59 | Initial commit: 拾词 Chrome 扩展 v1.1.0
2026-06-12 16:01 | Add README with project documentation
2026-06-12 16:08 | Add screenshots and update README with feature images
```

代码规模（JavaScript 与配置）：

```bash
git ls-tree -r --name-only d36c21b \
  | grep -E '^(manifest\.json|(background|content|popup|options|words)/.*\.js)$' \
  | while read f; do git show "d36c21b:$f"; done | wc -l
```

结果：**2972 行**。计入页面与样式后为 **5386 行**：

```bash
git ls-tree -r --name-only d36c21b \
  | grep -E '^(manifest\.json|(background|content|popup|options|words)/.*\.(js|css|html))$' \
  | while read f; do git show "d36c21b:$f"; done | wc -l
```

全部原生实现，无框架依赖。

---

## 2. `v2/` 与原版代码逐字节相同

```bash
for d in background content icons options popup words; do git diff d36c21b:$d 54d3f36:v2/$d; done
```

结果：**无输出**（退出码 0）—— 六个代码目录逐字节相同。

```bash
diff <(git show d36c21b:manifest.json) <(git show 54d3f36:v2/manifest.json)
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
git log --oneline -S"askAI" d36c21b -- content/index.js background/service-worker.js
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

> 另注：2026-09-21 另有两个与本次协作无关的功能提交（`975d0bd` 划词面板接入 TypeSafe 英语判定、`c58e530` API Key 掩码）。它们落在上面区间之外，且本节其余命令均已锚定到 `d36c21b` / `54d3f36`，因此不受影响。

那三个产物（`README.v2.md`、`STORE_LISTING.v2.md`、`v2/`）生成于 2026-08-17，此后一直停留在本地工作区，直到 2026-09-12 与本文档一并提交。

也就是说：那次协作之后，项目在**一个月内没有产生任何提交**。

---

## 5. 「移除音标功能」留下了未清理的残留

功能已于 `d36c21b`（2026-08-13）移除，但代码中仍保留大量占位：

```bash
git grep -n "phonetic" d36c21b -- 'background/*.js' 'content/*.js' 'popup/*.js' 'options/*.js' 'words/*.js'
```

结果 7 处，全部集中在 `background/service-worker.js`，行号 114 / 148 / 223 / 281 / 351 / 392 / 443。其中两处：

```
background/service-worker.js:114:    const { word, translation, phonetic, sourceUrl } = properties;
background/service-worker.js:148:      { content: (phonetic || '').slice(0, 2000) }
```

其余为 `phonetic: ''` 空值占位。

另有一处 Notion 字段，字段名用的是**中文**，`phonetic` 检索不到，需单独检索：

```bash
git grep -n "音标" d36c21b -- 'background/*.js'
```

结果：

```
background/service-worker.js:97:    if (richTextCount < 3) newProps['音标'] = { rich_text: {} };
```

即收藏同步到 Notion 时，仍会为一个已移除的功能创建字段。

同时 `README.md` 与 `README.v2.md` 中仍写着「自动获取 IPA 音标」—— **文档与代码不一致**。

---

## 6. README 声称的 CSV 支持未实现

`README.md:49`：

> **导出**：支持 HTML / CSV 格式导出收藏列表

`README.v2.md:44`：

> **批量导入**词条，**HTML / CSV** 格式导出收藏

实际情况：

- **导出**（`words/index.js:267`，`d36c21b` 中的行号）只实现了 HTML，无 CSV：

  ```javascript
  const html = buildWordHtml(wordsToDownload);
  ```

- **导入**（`words/index.js:549` 的 `parseImportText`）只支持 JSON 与行分隔（`|`、制表符、` - `、` — `），无逗号解析。

全仓库检索 `csv`（不区分大小写，限文本文件）：

```bash
git grep -in "csv" d36c21b -- '*.md' '*.html' '*.js' '*.css' '*.json'
```

结果 3 处，**全部是文档与宣传文案，无一处是实现**：

```
README.md:49:            - **导出**：支持 HTML / CSV 格式导出收藏列表
STORE_LISTING.md:55:     • HTML / CSV 格式导出词汇表
promo/04-config.html:141: JSON · 文本 · CSV
```

**文档与代码不一致。**

---

## 7. 决策笔记中的行号已失效

[`decision-note-2026-05-25.md`](./decision-note-2026-05-25.md)（原文件名 `划词翻译-单击取消收藏-2026-05-25.md`，在初始提交中即被包含，日期早于仓库建立）标注：

> 新增 `showHighlightPopup` 函数（第188-249行）

实际位置：

```bash
git show d36c21b:content/index.js | grep -n "function showHighlightPopup"
```

结果：`526:  async function showHighlightPopup(...)`

笔记写于 2026-05-25，至 `d36c21b`（2026-08-13）时，所记录的行号已偏移 300 余行。

---

## 为什么所有命令都锚定到 commit

本仓库同时是案例的**载体**和案例的**对象**——它会继续被开发，而每一次开发都会让「工作区 vs 工作区」的比较失去意义。

这一点已经真实发生过一次：2026-09-21 的两个功能提交只改了根目录、没有同步 `v2/`，于是原先那条 `for d in …; do diff -rq "$d" "v2/$d"; done`（比较两个工作区目录）从「无输出」变成了 5 行差异，本清单第 2 节当场失效。`wc -l` 的总数、`grep` 的行号同理。

改成两侧都锚到 commit 之后，命令读的是两棵不可变的树，与工作区再无关系。代价是命令变长；收益是结论不会随开发漂移。

---

## 关于 2026-08-17 会话记录

该次协作的完整逐轮记录存放于：

```
~/.claude/projects/-Users-kuai-workspace/9928ab86-0c71-49f0-91ca-5ffc55f89cef.jsonl
```

本案例正文中引用的对话原文均出自该文件。该路径在本仓库之外，如需将完整记录一并归档到本仓库，请显式指定来源与目标路径。
