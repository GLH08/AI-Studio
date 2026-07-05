# Spec: Grok 媒体参数 JSON 透传 + 视频生成

日期: 2026-07-05
状态: 已批准，待实现

## 背景与问题

部署日志 (`日志.txt`) 显示 provider `sub2api` (type `openai`) 走 Grok 媒体路由。存在两个问题：

1. **Chevereto 上传全部失败** —— `uploadToChevereto` 用 Web `Blob` 传给 npm `form-data`，抛 `source.on is not a function`。图片回退到会过期的 xAI 临时链接。**（已在本次先行修复：改用 Node `Buffer` + `arrayBuffer()`。）**
2. **无法控制媒体参数、无视频生成** —— `callOpenAI` 只发 `{model, prompt, n}`；`grok-imagine-video*` 会打到图片端点。Create 页的 Mode/Aspect/Duration/Resolution 控件大多是未接线的假控件，且图片模式下仍显示视频参数，造成误导、视觉差。

## sub2api 契约（已核实源码）

- 端点（仅 Grok 平台）：`POST /v1/images/generations`、`POST /v1/images/edits`、`POST /v1/videos/generations`、`GET /v1/videos/{request_id}`。
- **JSON 透传是真的**：`/images/generations` 与 `/videos/generations` 只重写 `model`（`grok-imagine`→`grok-imagine-image-quality`），其余字段（`aspect_ratio`、`resolution`、`duration`、`response_format`…）原样转发给 xAI。
- **视频异步**：`POST /videos/generations` 返回 `request_id`（候选路径 `request_id`/`id`/`data.request_id`/`data.id`/`video.request_id`/`video.id`），随后轮询 `GET /videos/{request_id}`。
- 视频状态响应体 sub2api **原样透传 xAI**，结构未定 → 提取需容错。

## 目标

1. 通用 JSON 参数透传（不写死任何渠道）。
2. Grok 视频生成（后端同步轮询）。
3. Create 页改为 Mode 驱动 + 单一 JSON 参数源，消除跨模式参数错位。

## 非目标

- 图片编辑（multipart，服务端未实现）。
- 视频"前端轮询"异步模式（本期用同步轮询；文档记录升级路径）。
- `gemini` / `openai-compatible` 适配器改动。

## 设计

### A. 后端 —— 通用 JSON 透传（`app.js`）

**`callOpenAI` 保持完全通用**，上游体 = `{ ...params, model, prompt }`，其中：
- `model`、`prompt` 始终以顶层校验值为准（`params` 里的同名键被覆盖，防止路由被篡改）。
- `n`：顶层 `n` 优先，否则用 `params.n`，否则 1。
- 其余 `params` 字段原样透传。不再特判 DALL-E 的 `size`/`quality`/`style`。

`/api/generate` 接收可选 `params`（普通对象；非对象则忽略）。`callProvider`/`callOpenAI` 透传。其它 provider 类型不受影响。

### B. 后端 —— 视频生成（新增）

新路由 `POST /api/generate/video`（视频存 videos 表、流程为异步轮询，与图片差异大，单独端点）：

1. 校验 provider / model / prompt（同 `/api/generate`）。
2. `POST ${baseUrl}/videos/generations`，体 = `{ ...params, model, prompt }`（同 A 的合并规则，无 `n`）。
3. `extractRequestId(body)` 按候选路径提取 `request_id`；提不到 → 500。
4. **同步轮询** `GET ${baseUrl}/videos/{request_id}`：
   - 间隔 `VIDEO_POLL_INTERVAL_MS`（默认 3000）。
   - 超时 `VIDEO_POLL_TIMEOUT_MS`（默认 90000，压在 Cloudflare 100s 之下）。
   - 每轮解析响应：`extractVideoUrl` 扫到视频 URL（`http…\.mp4` 或 `url`/`video.url`/`data.url` 等字段）→ 成功；扫到 `status` 为 `failed`/`error` → 失败(500)；否则续轮。
5. 成功：`uploadToChevereto(url, true, provider.apiKey)`（含 Buffer 修复），失败回退原 URL → `addVideoToDb`（`type:'text-to-video'`, `source:'generated'`, 存 `prompt`/`model`/`provider`/`timestamp`/`hidden:false`）→ 返回记录。
6. 超时：`504` + `{ error, request_id }`（告知仍在处理）。

**认证鉴权**：视频轮询请求带 `Authorization: Bearer ${provider.apiKey}`（同 callOpenAI）。

### C. 前端 —— Create 页 Mode 驱动 + 单一 JSON 参数源（`index.html`）

- **Mode 分段** 精简为 `Image` / `Video`（删 `Edit`）。
- **Parameters 区**：删除 Aspect Ratio 按钮、Number of Images 滑块、Duration/Resolution 假 select，替换为单个 **`#paramsInput` "Parameters (JSON)"** 等宽玻璃文本框。
- 切换 Mode → 文本框默认模板随之切换：
  - Image：`{ "aspect_ratio": "16:9", "resolution": "2k", "n": 1 }`
  - Video：`{ "aspect_ratio": "16:9", "resolution": "720p", "duration": 10 }`
- 生成逻辑：
  - 解析 `#paramsInput`：空 → 不带 `params`；合法对象 → `payload.params`；非法 JSON → 前端 alert 报错、不发请求。
  - 按 Mode 选端点：Image → `/api/generate`；Video → `/api/generate/video`。
  - `renderResult` 按结果渲染 `<img>`（走图片代理）或 `<video controls>`（走视频代理）。
- 改了 class → `npm run build` 重新生成并提交 `assets/tailwind.css`。

### D. 配置 / 文档 / 测试

- 新增 env：`VIDEO_POLL_INTERVAL_MS`、`VIDEO_POLL_TIMEOUT_MS`（均有默认值）。更新 `.env.example`、`README.md`、`CLAUDE.md`、`AGENTS.md`。
- 测试（沿用 `test/generate.test.js` 的 stub-upstream 风格）：
  - `params` 透传：stub 断言收到的上游体包含 `aspect_ratio` 等且 `model`/`prompt` 未被 params 覆盖。
  - 视频 happy path：stub `/videos/generations` 返 `request_id`，`/videos/{id}` 返含 mp4 URL 的体 → 200 + 入 videos 表。
  - 视频超时：stub 始终返 pending → 504（用极小超时 env 加速）。

## 已知代价（同步轮询）

视频 >90s（或超 CF 100s）→ 前端拿到 504/524。缓解：可配置超时 + 返回 `request_id`。彻底解决需升级为前端轮询（记录为后续可选项）。

## 成功标准

1. `params` 原样透传到上游，`openai` 适配器不写死任何渠道参数。
2. Grok 视频可生成并入库、可在画廊播放。
3. Create 页图片模式不再出现视频参数；控件精简、视觉干净。
4. `npm test` 全绿，`npm run lint` 干净，`npm run build` 已提交。
