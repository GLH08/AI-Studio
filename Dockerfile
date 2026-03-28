# 使用官方 Node.js 18 Alpine 镜像
FROM node:18-alpine

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json (如果存在)
COPY package*.json ./

# 安装依赖 (使用 npm install 避免锁文件依赖)
RUN npm install --only=production && npm cache clean --force

# 复制应用文件
COPY --chown=nodejs:nodejs app.js ./
COPY --chown=nodejs:nodejs app-frontend.js ./
COPY --chown=nodejs:nodejs index.html ./
COPY --chown=nodejs:nodejs login.html ./

# 创建数据目录并设置权限
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app/data

# 切换到非 root 用户
USER nodejs

# 暴露端口
EXPOSE 8787

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8787/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["node", "app.js"]
