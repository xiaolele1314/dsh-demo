FROM node:22-slim

WORKDIR /app

RUN npm install -g @deepseek-ai/dsh

COPY agent-server.js ./
COPY agent-chat.js ./

CMD ["node", "/app/agent-server.js"]
