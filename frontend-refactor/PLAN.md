# AI Studio 前端重构设计方案 (Mac OS Liquid Glass 风格)

## 1. 核心设计理念 (Core Design Philosophy)

**视觉语言: Mac OS 液态玻璃 (Liquid Glass)**
*   **高斯模糊与色彩渗透:** 采用深色模式为基础，使用 `backdrop-filter: blur(40px) saturate(200%)` 实现极致的毛玻璃效果。配合动态流体渐变背景（极光色彩），使界面呈现出通透、温润的液态玻璃质感。
*   **微光描边与内阴影:** 所有的玻璃卡片、按钮、输入框均采用极细的半透明白色描边 (`border: 1px solid rgba(255, 255, 255, 0.15)`) 和顶部内发光 (`inset 0 1px 0 rgba(255, 255, 255, 0.1)` )，模拟真实玻璃的边缘高光。
*   **平滑动效:** 大量运用贝塞尔曲线缓动动画 (cubic-bezier)，让所有的悬停、缩放、聚焦状态显得自然流畅。

## 2. 全局布局结构 (Global Layout)

摈弃了传统的侧边栏固定导航，采用更现代的 **全屏画布 + 悬浮组件** 的布局方式。

### 2.1 悬浮顶部导航 (Floating Top Navigation)
居中悬浮在页面顶部的“胶囊式”导航条。集成了 Logo、核心功能切换 (Create, Gallery, Collection, Video) 的分段控制器 (Segmented Control)，以及用户头像/设置入口。

## 3. 各页面设计细节 (Page Specific Designs)

### 3.1 创作工作台 (index.html - Create View)
*   **画布居中 (Canvas-Centric):** 屏幕正中心是巨大的预览区，用于展示生成的图片或视频。在未生成时显示优雅的占位符。
*   **Spotlight 悬浮提示词栏:** 将提示词输入框 (Prompt) 和 Generate 按钮结合，做成类似 Mac Spotlight 的长条悬浮组件，固定在画布正下方，使用户视线高度聚焦。
*   **右侧透明参数检查器 (Inspector Panel):** 将所有细碎的配置（Provider, Mode, Model, Aspect Ratio, Image Count 等）统一收纳在屏幕右侧的悬浮玻璃面板中。面板内部使用分组和精美的 UI 控件（如分段按钮、滑块）。

### 3.2 资产画廊 (library.html - Unified Gallery View)
*   **规整网格布局 (Neat Grid Layout):** 根据您的要求，**不使用瀑布流 (Masonry)**，而是采用 `CSS Grid` 实现的严格对齐、比例统一的网格布局（例如固定 1:1 或固定高度的网格）。媒体内容采用 `object-cover` 填充。图片和视频使用灰色渐变方块作为占位符。
*   **侧边过滤面板:** 屏幕左侧提供一个小型的悬浮面板，用于切换视图 (All Media, Videos, Collection) 和过滤 Provider。
*   **优雅的悬停态:** 鼠标悬停在占位方块上时，会平滑升起一层半透明的暗色玻璃遮罩，浮现相关的 Prompt、模型信息标签以及操作按钮（复制、打开、隐藏、删除）。

### 3.3 登录页 (login.html - Login View)
*   纯净的居中玻璃卡片。背景采用更加浓郁、深邃且缓慢旋转的极光流体动画，营造极佳的第一印象。

## 4. 交付文件

本目录下提供了完整的静态 HTML 演示文件，您可以直接双击在浏览器中查看效果：
1. `login.html`
2. `index.html` (Create)
3. `library.html` (Gallery/Collection/Video)