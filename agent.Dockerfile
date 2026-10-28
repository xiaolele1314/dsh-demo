FROM node:22-slim AS builder
WORKDIR /build
# 使用阿里云镜像加速 apt 和 npm
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update && apt-get install -y git python3 make g++ && \
    npm config set registry https://registry.npmmirror.com && \
    npm install -g pnpm@10
# 构建时传入 deepseek-harness 源码
COPY . .
RUN pnpm config set registry https://registry.npmmirror.com && \
    pnpm install --no-frozen-lockfile && pnpm build

FROM node:22-slim
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /dsh
COPY --from=builder /build/ ./
VOLUME ["/config"]
ENTRYPOINT ["node", "apps/cli/lib/index.js", "sdk", "--config", "/config/cordis.yml"]
