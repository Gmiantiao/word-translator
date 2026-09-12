# 划词翻译 单击高亮词弹出取消收藏 — 2026-05-25

## 目标
用户单击已收藏高亮的单词时，弹出浮窗显示翻译 + ★ 取消收藏按钮。

## 修改文件
- `content/index.js`

## 改动内容

### `onMouseUp` 新增高亮词检测（第54-60行）
在 `mouseup` 事件处理中，先检查点击目标是否在 `.wp-highlight` 内：
```js
const highlightEl = e.target.closest('.wp-highlight');
if (highlightEl && highlightEl.dataset.wpWord) {
  if (currentPopup) removePopup();
  showHighlightPopup(highlightEl.dataset.wpWord, highlightEl.getBoundingClientRect());
  return;
}
```

### 新增 `showHighlightPopup` 函数（第188-249行）
- 从本地收藏数据中找到该词条
- 构建与翻译浮窗一致的 DOM（header + 翻译 + footer）
- ★ 按钮初始为已填充状态（`wp-collected`）
- 点击 ★ 触发取消收藏 → `removeWord` → `removeHighlightForWord` → 关闭浮窗

## 流程
1. 用户单击紫色高亮词 → `onMouseUp` 匹配到 `.wp-highlight`
2. 关闭已有浮窗 → 调用 `showHighlightPopup`
3. 弹出浮窗显示翻译 + 实心 ★
4. 点 ★ → 取消收藏 + 移除高亮 + 关闭浮窗