# 18 · 前端暗色模式适配审查报告 (Dark Mode Review)

> 上级：[00-index.md](00-index.md)  
> 前端全量审查：[16-frontend-code-review.md](16-frontend-code-review.md)  
> 审查日期：2026-09-07  
> 审查范围：`web/src/styles.css`、`web/src/ui/*`、`web/src/pages/*` 全部前端界面与样式

---

## 1. 总体结论与现状评估

当前 ha-cluster 前端整体采用**深度定制的原生暗色设计体系**（无第三方 UI 库依赖，基于原生 CSS 变量），视觉基调统一、风格沉浸。在常规使用中，整体暗色质感良好，但在**色彩规范化（Token 化）**、**无障碍对比度（WCAG）**、**浏览器原生控件边缘兼容**以及**多主题扩展架构**上存在若干明显缺陷与隐患。

### 核心指标概览
- **暗色模式定位**：强制单向暗色（Hardcoded Dark-only，声明 `color-scheme: dark;`，无主题切换机制）
- **核心色彩变量**：`:root` 声明了 9 个基底 CSS 变量（`--bg`, `--panel`, `--line`, `--text`, `--muted`, `--accent`, `--danger`, `--ok`, `--focus`）
- **色彩硬编码数量**：23 处硬编码 HEX/RGBA 颜色值未抽象为语义 Token
- **WCAG 2.1 AA 文本达标率**：100%（主要文字对比度 5.02:1 ~ 15.83:1 全部达标）
- **WCAG 2.1 UI 边框达标率**：0%（`--line: #2a3542` 在 `--bg` 和 `--panel` 下对比度仅 1.49:1 和 1.29:1，低于 3.0:1 基准）
- **原生控件适配缺陷**：缺少 Autofill 重置、未声明滚动条样式、缺少 `select option` 背景锁定与 `placeholder` 规范

---

## 2. 缺陷清单与严重级别（P0 / P1 / P2）

| 级别 | 问题项 | 涉及位置 | 影响表现与风险 |
|------|--------|----------|----------------|
| **P1** | 缺少浏览器输入自动填充（Autofill）暗色重置 | `web/src/styles.css`（全局缺少 `:-webkit-autofill` 规则） | Chrome/Edge 记住密码自动填充时，输入框背景被强制变为浅黄或亮白色，导致暗色模式被破坏、文字可读性严重下降 |
| **P1** | UI 边框与分割线对比度过低（低于 WCAG AA） | `web/src/styles.css:5` (`--line: #2a3542`) | `--line` 在 `--bg` 上对比度仅 **1.49:1**，在 `--panel` 上仅 **1.29:1**（标准要求 >= 3:1）。在低亮度或普通显示器上，输入框、卡片、表格边缘极难看清 |
| **P1** | 20+ 处硬编码魔法色值未纳入 CSS 变量体系 | `web/src/styles.css` 多处选择器 | 破坏设计系统一致性，后续若调整主题或引入浅色模式时需大量人肉查找替换，维护成本高 |
| **P2** | 缺少系统滚动条（Scrollbars）暗色声明 | `web/src/styles.css`（全局缺少 `scrollbar-color`） | 在 Windows / Linux 等未全局配置暗色主题的系统上，浏览器长列表（如侧栏、审计、表格）会渲染出刺眼的亮灰色默认滚动条 |
| **P2** | 原生 `<select>` 的 `<option>` 弹出层未锁定暗色背景 | `web/src/styles.css:131` | 部分移动端浏览器与旧版 WebKit 弹出 option 列表时可能继承系统浅色背景，导致白底白字或对比度混乱 |
| **P2** | `.ok` 状态色存在两处冲突定义 | `web/src/styles.css:164` vs `web/src/styles.css:371` | 前者为 `#98c379`，后者为 `var(--ok, #7dcea0)`，fallback 色值不一致，导致不同层叠上下文下的成功绿色出现细微色差 |
| **P2** | 未定义文本选区 `::selection` 与输入占位符 `::placeholder` | `web/src/styles.css` | 浏览器默认 selection 高亮与暗色强调色可能产生辨识度问题；默认 placeholder 在深黑底上辨识度偏低 |
| **P3** | 硬编码纯深色，缺少系统自适应（`prefers-color-scheme`）扩展能力 | `web/src/styles.css:2` | 无法响应用户系统的浅色/深色首选项，无法支持亮暗主题一键切换 |

---

## 3. 详细审查维度分析

### 3.1 维度一：色彩体系与 Token 规范度

#### 现状扫描
在 `:root` 中声明的变量较为简练，但业务层出现大量直接书写的 HEX / RGBA 值：
1. **控件底色**：
   - `input, select, button`、`textarea` 写入 `background: #0f1419;`（应使用 `var(--bg)` 或抽象出 `--input-bg`）。
   - `invite-token-text` 写入 `background: #0f1419;`。
2. **按钮文字**：
   - `button` 与 `.btn-link` 写入 `color: #081018;`（硬编码近黑色，应定义 `--accent-text`）。
3. **状态徽章（Badge）**：
   - `.badge-ok` 写入 `background: #1a3d2e; color: #7fd99a;`
   - `.badge-warn` 写入 `background: #3d341a; color: #e5c07b;`
   - `.badge-danger` 写入 `background: #3d1a1f; color: var(--danger);`
   - 环境角标 `.env-dev` 写入 `border-color: #6b5a2e;`，`.env-prod` 写入 `border-color: #3d5a3a;`
4. **提示框与警示横幅**：
   - `.banner-error` 边框写死 `#6b3038`，`.banner-info` 写死 `#2a4a66`，`.banner-success` 写死 `#3d5a3a`。
   - `.banner.ws-insufficient` 背景写死 `#2a1518`。
   - `.invite-box` 背景写死 `#121a22`。
5. **骨架屏动画**：
   - `.skeleton-row` 渐变中间色写死 `#243040`。

---

### 3.2 维度二：无障碍与对比度实测（WCAG 2.1 AA）

使用精确相对亮度公式对全站前背景组合进行了对比度测算：

$$L = 0.2126 R + 0.7152 G + 0.0722 B$$
$$\text{Contrast Ratio} = \frac{L_1 + 0.05}{L_2 + 0.05}$$

实测结果汇总：

| 元素分类 | 前景取值 | 背景取值 | 实测对比度 | WCAG AA 判定 (文本>=4.5, UI>=3.0) |
|---|---|---|---|---|
| 正文文本 | `#e7eef6` | `#0f1419`（页面底色） | **15.83:1** | 合规 (AAA) |
| 正文文本 | `#e7eef6` | `#1a222c`（卡片底色） | **13.72:1** | 合规 (AAA) |
| 次级文本 | `#8aa0b5` | `#0f1419`（页面底色） | **6.85:1** | 合规 (AA) |
| 次级文本 | `#8aa0b5` | `#1a222c`（卡片底色） | **5.94:1** | 合规 (AA) |
| 强调/链接 | `#5b9fd4` | `#0f1419`（页面底色） | **6.48:1** | 合规 (AA) |
| 强调按钮文字 | `#081018` | `#5b9fd4`（按钮底色） | **6.70:1** | 合规 (AA) |
| 危险文本/按钮 | `#e06c75` | `#1a222c`（卡片底色） | **5.02:1** | 合规 (AA) |
| 成功状态文字 | `#98c379` | `#1a222c`（卡片底色） | **7.96:1** | 合规 (AAA) |
| 警告徽章 | `#e5c07b` | `#3d341a`（徽章背景） | **7.13:1** | 合规 (AAA) |
| 成功徽章 | `#7fd99a` | `#1a3d2e`（徽章背景） | **7.02:1** | 合规 (AAA) |
| 危险徽章 | `#e06c75` | `#3d1a1f`（徽章背景） | **4.81:1** | 合规 (AA) |
| 焦点高亮环 | `#7ec8ff` | `#0f1419` / `#1a222c` | **10.22:1 / 8.86:1** | 合规 (AAA) |
| **控件/卡片边框** | `#2a3542` | `#0f1419` / `#1a222c` | **1.49:1 / 1.29:1** | **不合规 (远低于 3.0:1)** |

> **关键结论**：文字与语义颜色的明度配合良好，但**边框线 `--line: #2a3542` 对比度过低**，是导致暗色模式下界面边界感弱、输入框位置模糊的根本原因。建议将输入框及重要卡片边框提升至 `#3a495b` 或通过内阴影增强轮廓感知。

---

### 3.3 维度三：浏览器原生控件与边缘渲染

1. **自动填充破坏（WebKit Autofill Issue）**：
   - 登录页 `Login.tsx` 中的用户名和密码在浏览器自动填充时，因缺少样式重置，会被 WebKit 浏览器应用白底黑字。
   - **推荐解决方案**：
     ```css
     input:-webkit-autofill,
     input:-webkit-autofill:hover,
     input:-webkit-autofill:focus {
       -webkit-box-shadow: 0 0 0 1000px var(--bg) inset;
       -webkit-text-fill-color: var(--text);
       transition: background-color 5000s ease-in-out 0s;
     }
     ```
2. **滚动条未适配暗色（Scrollbar Issue）**：
   - 长表格与移动端抽屉未声明标准化滚动条样式。
   - **推荐解决方案**：
     ```css
     * {
       scrollbar-width: thin;
       scrollbar-color: var(--line) transparent;
     }
     ```
3. **文本选区与占位符（Selection & Placeholder）**：
   - **推荐补充**：
     ```css
     ::selection {
       background: rgba(91, 159, 212, 0.35);
       color: #fff;
     }
     ::placeholder {
       color: var(--muted);
       opacity: 0.7;
     }
     option {
       background: var(--panel);
       color: var(--text);
     }
     ```

---

### 3.4 维度四：业务场景走查

- **登录页（`Login.tsx`）**：暗色体验良好，居中卡片与幽灵按钮层次分明；主要缺陷在于自动填充时的浅色穿透。
- **全局布局（`Layout.tsx`）**：侧栏（`--panel`）与主内容区（`--bg`）背景深浅差 1 级，微弱但具备层次感；移动端抽屉遮罩 `rgba(0, 0, 0, 0.45)` 沉浸感强。
- **工作区生命周期（`Workspaces.tsx`）**：容量超卖报警条 `.banner.ws-insufficient`（`#2a1518` 配合 `--danger`）警示作用鲜明；表格中各状态标签视觉一致。
- **项目详情与统计卡片（`Detail.tsx`）**：`.stat` 卡片与配额编辑表单在深色下清晰易读，数字醒目。
- **运维与审计（`Nodes.tsx`, `Capacity.tsx`, `Audit.tsx`, `SSHKeys.tsx`）**：等宽字体（`mono`）与状态徽章辨识度高，表格隔行或 hover 高亮 `rgba(91, 159, 212, 0.08)` 视觉平滑无闪烁。

---

## 4. 优化重构与多主题架构建议

为消除 23 处硬编码并为未来支持亮暗双主题做准备，建议采用两层 Token 架构对 `web/src/styles.css` 进行重构：

```mermaid
graph TD
    subgraph Primitive_Tokens [原始色阶 (Primitive Tokens)]
        Slate[Slate 灰度阶梯]
        Blue[Blue 强调阶梯]
        Red[Red 危险阶梯]
        Green[Green 成功阶梯]
        Yellow[Yellow 警告阶梯]
    end

    subgraph Semantic_Tokens [语义变量 (Semantic Tokens)]
        ThemeDark["[data-theme='dark'] / :root"]
        ThemeLight["[data-theme='light']"]
    end

    subgraph Components [组件应用层]
        Body[页面与卡片背景]
        Text[正文与次级文字]
        Controls[输入框/按钮/下拉框]
        Status[徽章/横幅/通知]
    end

    Primitive_Tokens --> ThemeDark
    Primitive_Tokens --> ThemeLight
    ThemeDark --> Components
    ThemeLight --> Components
```

### 推荐的 CSS 变量语义重构设计

```css
:root {
  /* 基础原语色 */
  color-scheme: dark;
  --bg: #0f1419;
  --panel: #1a222c;
  --panel-subtle: #121a22;
  --line: #2a3542;
  --line-strong: #3e4c5e; /* 新增：高对比度边框 */
  --text: #e7eef6;
  --text-muted: #8aa0b5;
  --text-inverse: #081018;

  /* 主题与状态语义色 */
  --accent: #5b9fd4;
  --accent-hover: rgba(91, 159, 212, 0.15);
  --accent-active: rgba(91, 159, 212, 0.25);
  --focus: #7ec8ff;

  --badge-ok-bg: #1a3d2e;
  --badge-ok-text: #7fd99a;
  --badge-warn-bg: #3d341a;
  --badge-warn-text: #e5c07b;
  --badge-danger-bg: #3d1a1f;
  --badge-danger-text: #e06c75;

  --banner-error-bg: #2a1518;
  --banner-error-border: #6b3038;
  --banner-info-border: #2a4a66;
  --banner-success-border: #3d5a3a;
}
```
