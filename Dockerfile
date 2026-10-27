FROM node:22-slim

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY dist/ ./dist/
COPY proto/ ./proto/

ENV GRPC_HOST=0.0.0.0
ENV GRPC_PORT=50051
ENV DATA_ROOT=/data/agents
ENV DSH_IMAGE=digital-human-agent:latest
ENV MAX_CONTAINERS=50
ENV CONTAINER_MEMORY=512m
ENV CONTAINER_CPU=1

EXPOSE 50051

CMD ["node", "dist/main.js"]
