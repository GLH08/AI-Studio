# Spec: AI Studio - macOS Liquid Glass UI Redesign

## Objective

将 AI Studio 前端重设计为 macOS Liquid Glass 风格。保留所有现有功能（图片/视频生成、代理、图床），仅改变视觉呈现。

**设计方向**: Apple macOS Sequoia 的液态玻璃效果 - 半透明毛玻璃层次、柔和阴影、圆润边角、精致动效。

---

## Design System

### Color Palette (CSS Variables)

**Dark Theme (Default)**
```css
[data-theme="dark"] {
  --glass-bg: rgba(255, 255, 255, 0.08);
  --glass-bg-hover: rgba(255, 255, 255, 0.12);
  --glass-bg-active: rgba(255, 255, 255, 0.16);
  --glass-border: rgba(255, 255, 255, 0.14);
  --glass-border-strong: rgba(255, 255, 255, 0.24);
  --text-primary: rgba(255, 255, 255, 0.95);
  --text-secondary: rgba(255, 255, 255, 0.65);
  --text-tertiary: rgba(255, 255, 255, 0.45);
  --bg-primary: #1c1c1e;
  --bg-secondary: #2c2c2e;
  --bg-tertiary: #3a3a3c;
}
```

**Light Theme**
```css
[data-theme="light"] {
  --glass-bg: rgba(255, 255, 255, 0.60);
  --glass-bg-hover: rgba(255, 255, 255, 0.80);
  --glass-bg-active: rgba(255, 255, 255, 0.90);
  --glass-border: rgba(0, 0, 0, 0.10);
  --glass-border-strong: rgba(0, 0, 0, 0.20);
  --text-primary: rgba(0, 0, 0, 0.95);
  --text-secondary: rgba(0, 0, 0, 0.65);
  --text-tertiary: rgba(0, 0, 0, 0.45);
  --bg-primary: #f5f5f7;
  --bg-secondary: #e8e8ed;
  --bg-tertiary: #d2d2d7;
}
```

**Accent Colors (Both Themes)**
```css
:root {
  --accent-blue: #007AFF;
  --accent-purple: #BF5AF2;
  --accent-pink: #FF375F;
  --accent-cyan: #5AC8FA;
  --accent-gradient: linear-gradient(135deg, #007AFF 0%, #BF5AF2 50%, #FF375F 100%);
  --shadow-glass: 0 8px 32px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  --shadow-button: 0 4px 12px rgba(0, 122, 255, 0.3);
}
```

### Typography

- **Primary Font**: SF Pro Display (system-ui, -apple-system fallback)
- **Code/Mono**: SF Mono (monospace fallback)
- **Scale**: 13px base, 1.25 ratio

### Glass Effect (Core)

```css
.glass {
  background: var(--glass-bg);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: 18px;
  box-shadow: var(--shadow-glass);
}
```

### Motion

- **Duration**: 200-300ms
- **Easing**: cubic-bezier(0.25, 0.1, 0.25, 1)
- **Hover**: scale(1.02), brighter background
- **Active**: scale(0.98)

---

## Tech Stack

- **CSS Framework**: Tailwind CSS (已有) + 自定义 CSS 变量
- **Build**: 无需改变（CDN Tailwind 可用）
- **Icons**: Lucide Icons (CDN: `https://unpkg.com/lucide@latest`)

---

## Commands

```bash
npm start        # 启动生产服务器
npm run dev      # 开发模式
npm test         # 运行测试
```

---

## Project Structure

```
├── index.html          # 主页面 (重写 UI)
├── login.html          # 登录页 (同步更新)
├── app-frontend.js     # 前端逻辑 (保持不变，除非需要 DOM 类名调整)
├── app.js              # 后端 (不改动)
├── SPEC.md             # 本规格文档
└── styles/
    └── glass.css       # 可选：提取玻璃效果样式
```

---

## UI Components to Redesign

### 1. Sidebar (侧边栏)
- 玻璃效果毛玻璃，更柔和的圆角，悬停高亮
- 添加主题切换按钮

### 2. Cards (卡片)
- 玻璃效果，增强阴影，悬停动效

### 3. Buttons (按钮)
- Primary: 渐变背景 + 玻璃效果
- Secondary: 纯玻璃按钮
- 悬停发光效果

### 4. Inputs/Selects (输入框)
- 玻璃效果，更柔和的聚焦状态

### 5. Modal/Lightbox
- 玻璃面板，顶部模糊覆盖层

### 6. Background
- 更柔和的渐变，减少极端颜色
- 响应主题切换

---

## Code Style

### 类名约定
- 使用 Tailwind 工具类 + 自定义 CSS 变量
- 玻璃效果用 `.glass` class
- 动效用 `.glass-hover`, `.glass-active`

### 示例片段

```html
<!-- 玻璃卡片 -->
<div class="glass card-hover p-6">
  <h3 class="text-lg font-medium" style="color: var(--text-primary)">Card Title</h3>
  <p class="text-sm" style="color: var(--text-secondary)">Description</p>
</div>

<!-- 玻璃按钮 -->
<button class="glass-button px-6 py-3 rounded-xl font-medium
               transition-all hover:shadow-button active:scale-95">
  Generate
</button>

<!-- Lucide 图标 -->
<script src="https://unpkg.com/lucide@latest"></script>
<i data-lucide="sparkles" class="w-5 h-5"></i>
```

---

## Testing Strategy

- **手动测试**: 每次重构后检查页面是否正常加载
- **功能测试**: `npm test` 确认后端 API 不受影响
- **主题测试**: 切换明/暗主题，验证所有组件正确响应

---

## Boundaries

**Always:**
- 保持所有现有功能不变
- 保持后端 API 兼容性
- 移动端可用性
- 渐进式重构（每步可运行）

**Ask first:**
- 改变 HTML 结构（DOM 顺序）
- 改变 JavaScript 逻辑
- 添加新依赖

**Never:**
- 修改 `app.js` 后端逻辑
- 删除现有功能
- 破坏 API 兼容性

---

## Execution Plan

### Phase 1: CSS 设计系统
- [ ] 定义 CSS 变量（colors, shadows, glass effect）
- [ ] 创建玻璃效果基础类
- [ ] 实现主题切换机制
- [ ] 更新 Tailwind 配置

### Phase 2: 核心组件
- [ ] Sidebar 玻璃化 + 主题切换
- [ ] Cards 玻璃化
- [ ] Buttons 玻璃化
- [ ] Inputs/Selects 玻璃化

### Phase 3: 高级组件
- [ ] Modal/Lightbox 玻璃化
- [ ] 背景优化
- [ ] 动画微调

### Phase 4: Login 页面
- [ ] 同步更新 login.html

---

## Success Criteria

1. ✅ 所有页面正常加载，功能完整
2. ✅ 视觉呈现符合 macOS 液态玻璃风格
3. ✅ 支持明/暗主题切换
4. ✅ 移动端响应式正常
5. ✅ `npm test` 通过
6. ✅ 页面无 console error

---

## Open Questions

无 - 已确认：
- ✅ 图标库: Lucide Icons
- ✅ 主题: 支持明/暗切换