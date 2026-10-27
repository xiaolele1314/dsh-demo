FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY dist/ ./dist/
COPY proto/ ./proto/
ENV GRPC_HOST=0.0.0.0 GRPC_PORT=50051 DATA_ROOT=/data/agents DSH_IMAGE=dsh-agent:latest MAX_CONTAINERS=50 CONTAINER_MEMORY=512m CONTAINER_CPU=1
EXPOSE 50051
CMD ["node", "dist/main.js"]
