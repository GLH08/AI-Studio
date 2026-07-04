# AI Studio (Multi-Provider Media Generator)

基于多提供商架构的专业 AI 图像生成平台。支持 OpenAI、OpenAI-Compatible、Gemini 多种渠道的文生图（Text-to-Image），并可手动收藏图片与视频链接，内置可选的 Chevereto 图床加速。

[![Build and Push](https://github.com/GLH08/AI-Studio/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/GLH08/AI-Studio/actions/workflows/docker-publish.yml)

## 🌟 核心特性

- **文生图生成**：通过 OpenAI、OpenAI-Compatible（反代 Chat Completions）、Gemini 三类渠道实现文生图 (Text-to-Image)。
- **图库与收藏**：生成结果自动入库；另可手动收藏外部图片链接、保存文生视频 / 图生视频链接，统一在画廊浏览。
- **动态多渠道架构**：告别硬编码，支持最多 10 个 `PROVIDER_X_*` 配置项，随时灵活添加不同的 API 渠道。
- **现代化 UI 面板**：玻璃拟态（Liquid Glass）界面，支持深浅色主题切换；OpenAI 渠道自动呼出 size / quality / style 参数。
- **Chevereto 图床集成**：生成图片可一键并行上传到私有 Chevereto 图床，加速多端浏览。
- **安全加固**：SSRF 域名白名单、HMAC 签名登录 Cookie（不再明文存储密码）、速率限制与 Helmet CSP。

## 🚀 快速开始

### 方式一：远程镜像部署（推荐）

无需克隆代码或本地打包，直接获取云原生构建的 Docker 镜像：

```bash
# 1. 创建并进入目录
mkdir ai-studio && cd ai-studio

# 2. 下载远程拉取版配置与环境变量模板
curl -O https://raw.githubusercontent.com/GLH08/AI-Studio/main/docker-compose.ghcr.yml
curl -O https://raw.githubusercontent.com/GLH08/AI-Studio/main/.env.example

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
git clone https://github.com/GLH08/AI-Studio.git
cd AI-Studio

# 配置环境变量
cp .env.example .env
nano .env

# 以源码本地构建并启动服务
docker-compose up -d --build
```

### 方式三：裸机 Node.js 部署

```bash
git clone https://github.com/GLH08/AI-Studio.git
cd AI-Studio
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
| `RATE_LIMIT_MAX_REQUESTS` | ❌ | 500 | IP 速率限制，防止恶意并发调用 |

### 多提供商 (Provider) 配置示例
| 变量 | 说明 | 示例值 |
|------|------|--------|
| `PROVIDER_X_NAME` | 渠道显示名称 | OpenAI DALL·E |
| `PROVIDER_X_TYPE` | 渠道后端类型 | enum: `openai`, `openai-compatible`, `gemini` |
| `PROVIDER_X_BASE_URL`| 服务基础地址 | `https://api.openai.com/v1` |
| `PROVIDER_X_API_KEY` | 鉴权密钥 | `sk-...` |
| `PROVIDER_X_MODELS` | 模型列表（逗号分隔） | `dall-e-3,gpt-image-1` |

> 图像 / 视频代理与手动收藏可通过 `IMAGE_PROXY_WHITELIST`（逗号分隔的主机名）限制可访问的域名，留空则允许全部。

### Chevereto 图床配置（选填）
如果你希望生成的图片和视频能拥有纯公共或加速连结：
| 变量 | 说明 |
|------|------|
| `CHEVERETO_URL` | Chevereto 私有部署的 API 网址（如 `https://image.example.com`） |
| `CHEVERETO_API_KEY` | Chevereto 的 API Key |
| `CHEVERETO_ALBUM_ID` | 上传到的相册 ID（可选） |

## 🔌 API 文档

### 文生图生成
统合的图像生成 endpoint，根据所选 provider 的类型自动路由到对应适配器。

```bash
POST /api/generate
Content-Type: application/json

{
  "provider": "provider-1",
  "model": "dall-e-3",
  "prompt": "Cyberpunk city night view",
  "size": "1024x1024",     // 可选（仅 OpenAI 渠道）
  "quality": "hd",          // 可选（仅 OpenAI 渠道）
  "style": "vivid",         // 可选（仅 OpenAI 渠道）
  "n": 1                     // 可选，生成数量
}
```

> 返回单张结果时为图片记录对象；`n > 1` 时返回 `{ results: [...], count }`。若配置了 Chevereto，生成图片会并行上传并改写为图床地址。

### 手动收藏（图片 / 视频链接）

```bash
POST /api/images/manual            # { url, prompt, model?, aspectRatio? }
POST /api/videos/text-to-video     # { url, prompt, model?, aspectRatio? }
POST /api/videos/image-to-video    # { url, sourceImageUrl, prompt?, model?, aspectRatio? }
```

### 内容存储管理接口
- `GET /api/images` / `GET /api/videos` - 获取你的图库 / 视频中心的所有切片
- `GET /api/images/stats` / `GET /api/videos/stats` - 获取全局存量统计表
- `PATCH /api/images/:id/hide` / `PATCH /api/videos/:id/hide` - 将某生成结果对访客画廊做强屏蔽
- `DELETE /api/images/:id` - 执行媒体资源和记录的永久删除

## 🛡️ Nginx 反代配置 (适配 Cloudflare)

如果你计划绑定自己的域名并套用 **Cloudflare** 加速，我们强烈推荐使用以下 Nginx 配置文件。该配置已经解决并优化了以下痛点：
1. **真实请求 IP 透传**：提取 `$http_cf_connecting_ip` 防止速率限制误伤。
2. **大文件与生图超时问题**：充分容忍长时间的请求不断流（注意：Cloudflare 免费版强制超时断点为 100秒，若生视频持续超过100秒可能触发 524 错误，此时建议关闭小黄云代理）。

```nginx
server {
    listen 80;
    server_name example.com; # ❗修改为你自己的域名
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name example.com; # ❗修改为你自己的域名

    # ❗修改为你自己的 SSL 证书地址（在 CF 模式下，推荐使用 SSL/TLS Full Strict 严格模式）
    ssl_certificate /path/to/your/fullchain.pem;
    ssl_certificate_key /path/to/your/privkey.pem;

    # SSL 优化
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # 请求体大小（支持图片上传，受制于 CF 免费版 100M 上限）
    client_max_body_size 50M;

    # Gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
    gzip_min_length 1000;

    location / {
        proxy_pass http://localhost:8787; # 对应 docker-compose 中暴露的端口
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        
        # 兼容 Cloudflare 获取客户端真实 IP
        proxy_set_header X-Real-IP $http_cf_connecting_ip;
        proxy_set_header X-Forwarded-For $http_cf_connecting_ip;
        
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_cache_bypass $http_upgrade;

        # 超时设置（图像生视频等极耗时任务容忍）
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;

        # 禁用缓冲（实时响应有利）
        proxy_buffering off;
    }
}

# 需要在上一级 http 块添加：
# map $http_upgrade $connection_upgrade {
#     default upgrade;
#     '' close;
# }
```

## 📜 License
MIT License.
