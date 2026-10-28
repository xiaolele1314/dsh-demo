# 预编译版：在宿主机上先 pnpm install && pnpm build，然后直接复制产物进镜像
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /dsh
COPY . ./
VOLUME ["/config"]
ENTRYPOINT ["node", "apps/cli/lib/index.js", "sdk", "--config", "/config/cordis.yml"]
