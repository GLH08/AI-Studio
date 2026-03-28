# AI Studio (Multi-Provider Media Generator)

基于多提供商架构的专业 AI 多媒体生成平台。完美支持 OpenAI、OpenAI-Compatible、Gemini 以及 Grok2API 等多种渠道，内置高级的文生图、图生图（图像编辑）、文生视频、图生视频等全维度多媒体生成能力。

[![Build and Push](https://github.com/GLH08/Fal-image/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/GLH08/Fal-image/actions/workflows/docker-publish.yml)

## 🌟 核心特性

- **多模式生成系统**：单端实现文生图 (Text-to-Image)、图像编辑 (Image Edit)、文生视频 (Text-to-Video)、图生视频 (Image-to-Video)。
- **原生 Grok2API 支持**：深度集成并兼容 Grok2API 的非标多模态及参数（智能处理 Base64 媒体直传、并发控制、多媒体时长/分辨率配置）。
- **动态多渠道架构**：告别硬编码，支持无限个 `PROVIDER_X_*` 配置项，随时灵活添加不同的 API 渠道。
- **现代化 UI 面板**：根据所选的渠道和生成模式，参数调节面板（如视频比例、时长选项、参考图强制约束等）会自适应呼出。
- **Lsky Pro 图床集成**：不仅保障媒体数据在本地 SQLite 安心入库，更支持一键转推私有 Lsky Pro 图床加速多端浏览。

## 🚀 快速开始

### 方式一：远程镜像部署（推荐）

无需克隆代码或本地打包，直接获取云原生构建的 Docker 镜像：

```bash
# 1. 创建并进入目录
mkdir ai-studio && cd ai-studio

# 2. 下载远程拉取版配置与环境变量模板
curl -O https://raw.githubusercontent.com/GLH08/Fal-image/main/docker-compose.ghcr.yml
curl -O https://raw.githubusercontent.com/GLH08/Fal-image/main/.env.example

# 3. 配置文件并填入你的参数
cp .env.example .env
nano .env # 按需配置各类 PROVIDER_* 等信息

# 4. 一键启动
docker-compose -f docker-compose.ghcr.yml up -d

# 5. 访问系统
# 打开浏览器访问 http://localhost:8787
```

### 方式二：源码构建部署 (Docker Compose)

```bash
# 克隆仓库
git clone https://github.com/GLH08/Fal-image.git
cd Fal-image

# 配置环境变量
cp .env.example .env
nano .env

# 以源码本地构建并启动服务
docker-compose up -d --build
```

### 方式三：裸机 Node.js 部署

```bash
git clone https://github.com/GLH08/Fal-image.git
cd Fal-image
npm install

# 请确保已创建并填写了 .env 文件，或通过全局 exports 暴露
npm start
```

## ⚙️ 环境变量配置

所有的核心变更均由 `.env` 文件驱动。系统最高支持任意数量的 Providers，按 `PROVIDER_1_*`, `PROVIDER_2_*` 等顺序向下解析。

### 通用系统配置
| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `PORT` | ❌ | 8787 | 平台的运行端口 |
| `AUTH_PASSWORD` | ❌ | - | 设置此项将开启独立的访问密码墙 |
| `RATE_LIMIT_MAX_REQUESTS` | ❌ | 100 | IP 速率限制，防止恶意并发调用 |

### 多提供商 (Provider) 配置示例
| 变量 | 说明 | 示例值 |
|------|------|--------|
| `PROVIDER_X_NAME` | 渠道显示名称 | Grok2API |
| `PROVIDER_X_TYPE` | 渠道后端类型 | enum: `openai`, `openai-compatible`, `gemini`, `grok2api` |
| `PROVIDER_X_BASE_URL`| 服务基础地址 | `https://api.grok.com/v1` |
| `PROVIDER_X_API_KEY` | 鉴权密钥 | `sk-...` |

**频道模型精确路由：**
针对不同的图流模式，你在 `.env` 指定的模型将会智能分配到前端的不同 Tab 下签：
- `PROVIDER_X_IMAGE_MODELS`：普通（文生图）模型，以逗号分隔。
- `PROVIDER_X_IMAGE_EDIT_MODELS`：图生图（图像编辑）模型。
- `PROVIDER_X_VIDEO_MODELS`：视频（文生视频 / 图生视频）模型。

### Lsky Pro 图床配置（选填）
如果你希望生成的图片能拥有纯公共或加速连结：
| 变量 | 说明 |
|------|------|
| `LSKY_URL` | Lsky 私有部署的 API 网址（如 `https://image.example.com`） |
| `LSKY_TOKEN` | Lsky Pro 的接口 token（形如 `Bearer 1|...`） |
| `LSKY_STRATEGY_ID` | 转存时使用的分发储存策略 ID（默认为 1） |

## 🔌 API 原生扩展文档

### 高级多媒体内容生成
平台提供了一个泛用的统合 endpoint，它会自动为你路由到底层对应的格式和引擎服务当中。

```bash
POST /api/generate
Content-Type: application/json

# --- （一）通用文生图 ---
{
  "provider": "Grok2API",
  "model": "grok-imagine-1.0",
  "mode": "text-to-image",
  "prompt": "Cyberpunk city night view",
  "imageConfig": { "size": "1024x1024", "n": 1 }
}

# --- （二）图像编辑与修改（Image Edit） ---
{
  "provider": "Grok2API",
  "model": "grok-imagine-1.0-edit",
  "mode": "image-edit",
  "prompt": "把背景的星空换成夕阳",
  "sourceImageUrl": "https://example.com/source.jpg"
}

# --- （三）文生视频 / 图生视频 ---
{
  "provider": "Grok2API",
  "model": "grok-imagine-1.0-video",
  "mode": "image-to-video", // 或 text-to-video
  "prompt": "让镜头逐渐拉远",
  "sourceImageUrl": "https://example.com/source.jpg", // 选填（仅 image-to-video 必须传）
  "videoConfig": {
    "aspect_ratio": "16:9",
    "video_length": 6, // 6, 10, 15
    "resolution_name": "720p" // 480p, 720p
  }
}
```

### 内容存储管理接口
- `GET /api/images` / `GET /api/videos` - 获取你的图库 / 视频中心的所有切片
- `GET /api/images/stats` / `GET /api/videos/stats` - 获取全局存量统计表
- `PATCH /api/images/:id/hide` / `PATCH /api/videos/:id/hide` - 将某生成结果对访客画廊做强屏蔽
- `DELETE /api/images/:id` - 执行媒体资源和记录的永久删除

## 📜 License
MIT License.
