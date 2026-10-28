FROM node:22-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y git python3 make g++ && \
    npm install -g pnpm@11
# 构建时传入 deepseek-harness 源码
COPY . .
RUN echo "ignore-build-scripts=false" > .npmrc && pnpm install --no-frozen-lockfile && pnpm build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /dsh
COPY --from=builder /build/ ./
VOLUME ["/config"]
# dsh sdk-server 模式：JSON-RPC over stdio，读取 /config/cordis.yml
ENTRYPOINT ["node", "apps/cli/lib/index.js", "sdk", "--config", "/config/cordis.yml"]
