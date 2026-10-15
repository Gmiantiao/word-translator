# 拾词 · 品牌标志

![拾词 WordPicker](png/logo@2x.png)

## 概念

**「被荧光笔划过的一个 W」** —— 拾词做的是两件事：在网页上**划**出词，然后**收藏**它。
标志把这两件事压成一个形状：字母 W（Word / 词）压在一道略微倾斜的高亮笔刷上。
笔刷比 W 略宽、略歪，像手划出来的，不是排版排出来的。

标志只用两个元素，是为了 16px 的扩展工具栏图标也能立住：
黄条负责「划词」，白 W 负责「词」，紫色方块负责在浏览器里被认出来。

## 色彩

| 用途 | 色值 | 说明 |
|------|------|------|
| 主色·浅 | `#A78BFA` | 方块渐变起点（violet-400） |
| 主色·深 | `#6D28D9` | 方块渐变终点（violet-700），与产品 UI 的 `#7C3AED` 同族 |
| 高亮·浅 | `#FDE68A` | 笔刷渐变起点（amber-200） |
| 高亮·深 | `#FBBF24` | 笔刷渐变终点（amber-400） |
| 墨色 | `#1a1a2e` | 浅底上的字，取自产品 UI 正文色 |

> 产品里的默认高亮色是紫色本身（`#7C3AED`），logo 用琥珀色是为了在紫底上能看见，
> 同时借「荧光笔」的通用联想。

## 文件

```
brand/
├── logo-mark.svg        主图标（512×512 方块），扩展图标 / 头像 / favicon 用
├── logo-mark-small.svg  小尺寸变体：只留加大的 W，去掉高亮条（原因见文件内注释）
├── logo.svg             横版组合，浅色背景用
├── logo-dark.svg        横版组合，深色背景用
└── png/
    ├── logo-mark-1024.png / logo-mark-512.png   位图版主图标（透明底）
    ├── logo@2x.png                              横版组合 1240×400
    └── icon-16 / 48 / 128.png                   扩展图标尺寸（透明底，16 来自小尺寸变体）
```

## 用法

- **扩展图标**：`png/icon-{16,48,128}.png` 可直接替换 `icons/` 下的同名文件。
- **README / 网页**：浅色底用 `logo.svg`，深色底用 `logo-dark.svg`。GitHub 支持按主题切换：

  ```html
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo-dark.svg">
    <img src="brand/logo.svg" alt="拾词" width="310">
  </picture>
  ```

- **最小尺寸**：16px 以下不要用横版组合，只用 `logo-mark.svg`。
- **留白**：标志四周至少留出方块宽度的 1/4。

## 注意

`logo.svg` / `logo-dark.svg` 里的「拾词」是文字（不是轮廓），依赖系统字体栈
`PingFang SC → Hiragino Sans GB → Microsoft YaHei → Noto Sans SC`。
若要印刷或需要绝对一致的渲染，请先转成轮廓。
