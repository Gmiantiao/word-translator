# 🍜 面条捞词

> 浏览即捞词 — 划词翻译、捞词入碗、高亮复习，中英双语皆是养分

一个轻量级 Chrome 扩展，让你在浏览网页时随手捞出生词，翻译、入碗，并在后续浏览中自动高亮显示，帮助自然习得词汇。

---

## 📄 这个仓库同时是一个案例研究

### [AI 给了五样东西，一样都没落地 →](case-study/README.md)

2026 年 8 月 17 日，我让 AI 给这个项目做一次重新定位。它读了代码，给了五项判断与风险提示，最后问了一个问题——**那个问题没有被回答。**

这次协作产出了 **0 个 commit**。

完整复盘（逐轮对话原文 + 每条结论附可复现命令）：**→ [case-study/](case-study/)**

---

## 📸 截图

<p align="center">
  <img src="screenshots/01-translate.png" alt="划词翻译" width="400" />
  <img src="screenshots/02-collect.png" alt="一键收藏" width="400" />
</p>
<p align="center">
  <img src="screenshots/03-highlight.png" alt="页面高亮" width="400" />
  <img src="screenshots/04-config.png" alt="灵活配置" width="400" />
</p>

## ✨ 功能

### 🔤 划词翻译
- 在任意网页选中英文单词或短语，即时弹出翻译结果
- 自动获取 IPA 音标（使用免费词典 API，无需密钥）
- 支持 **中译英**：选中中文自动翻译成英文
- Google 翻译 + DeepSeek 双引擎可选

### 📝 收藏与笔记
- 一键收藏词汇，自动记录来源网址和上下文
- 支持为每个词条添加 30 字个性化备注
- 本地存储，离线可用

### 💡 AI 提问
- 选中文本后可向 AI 追问（基于 DeepSeek）
- 多轮对话，深入理解词汇用法

### 🌈 高亮复习
- 已收藏的词汇在任意网页自动高亮
- 自定义高亮颜色，悬停查看释义
- 点击高亮词即可查看详情或取消收藏

### ☁️ Notion 同步
- 将收藏词汇一键同步到 Notion 数据库
- 自动去重，支持笔记更新
- 收藏即同步，也可一键补同步历史词汇

### ⚙️ 灵活配置
- **多翻译引擎**：Google 翻译（免费）/ DeepSeek（需 API Key）
- **多目标语言**：简体中文、繁體中文、日本語、한국어、Español
- **开关控制**：一键开关划词功能、中译英、音标显示、AI 提问
- **导出**：支持 HTML / CSV 格式导出收藏列表

## 📦 安装

1. 下载或克隆此仓库
2. 打开 Chrome，进入 `chrome://extensions/`
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本仓库根目录

## 🛠 技术栈

- **Chrome Extension Manifest V3**
- 原生 JavaScript（无框架依赖）
- Service Worker 后台
- Content Script 页面注入
- Chrome Storage API 本地持久化

## 📁 项目结构

```
word-translator/
├── manifest.json           # 扩展配置
├── background/
│   └── service-worker.js   # 后台服务（翻译、Notion同步、词库管理）
├── content/
│   ├── index.js            # 页面注入脚本（划词、弹窗、高亮）
│   └── index.css           # 弹窗样式
├── popup/
│   ├── index.html          # 弹出面板（词汇列表、设置）
│   ├── index.js            # 面板逻辑
│   └── index.css           # 面板样式
├── options/
│   ├── index.html          # Notion 配置页
│   ├── index.js            # 配置逻辑
│   └── index.css           # 配置页样式
├── words/
│   ├── index.html          # 全部词汇浏览页
│   ├── index.js            # 词汇管理逻辑
│   └── index.css           # 词汇页样式
├── icons/                  # 扩展图标
├── test/                   # 回归测试（node 直接跑，无需浏览器、无需构建）
│   ├── sw-test.js          # 后台服务 —— 会真实调用 TypeSafe
│   ├── content-test.js     # 内容脚本：选区门槛、面板渲染
│   └── popup-test.js       # 弹出面板：密钥掩码、id 与 HTML 交叉核对
└── promo/                  # 宣传页素材
```

## 🔑 API 配置

| 功能 | 是否需要密钥 | 说明 |
|------|:---:|------|
| Google 翻译 | ❌ | 内置免费使用 |
| DeepSeek 翻译 | ✅ | 需 [DeepSeek API Key](https://platform.deepseek.com/) |
| AI 提问 | ✅ | 与 DeepSeek 共用 Key |
| 音标查询 | ❌ | 免费词典 API |
| Notion 同步 | ✅ | 需 [Notion Integration](https://www.notion.so/my-integrations) |

## 🧪 测试

```bash
node test/content-test.js    # 内容脚本：选区门槛、面板渲染（不联网）
node test/popup-test.js      # 弹出面板：密钥掩码、id 与 HTML 交叉核对（不联网）
TYPESAFE_ENV_FILE=../jev/.env node test/sw-test.js   # 后台服务（会真实调用 API）
```

三个脚本把**真实的扩展源码**加载进 Node,用桩替换 `chrome.*` 和 DOM —— 不需要浏览器,
也不需要引入任何依赖或构建步骤。

`sw-test.js` 会真实请求 TypeSafe(输入计费,单次约百万分之几美元)。缺 key 时它会打印用法
并以退出码 2 退出,所以也可以安全地放进 CI 之外的本地流程。

## 📄 License

MIT
