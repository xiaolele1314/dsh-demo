# Digital Human Runtime — Agent 运行时服务

管理后台与 deepseek-harness Agent 容器之间的桥梁服务。接收管理后台的 gRPC 指令，管理 Docker 容器的生命周期，桥接用户消息与 Agent 的流式响应。

## 架构

```
┌──────────────────────────┐
│  管理后台 (本地)           │
│  ASP.NET Core + MySQL    │
│  http://localhost:5109   │
└────────────┬─────────────┘
             │ gRPC (:50051)
             ▼
┌──────────────────────────────────────────────────┐
│  阿里云服务器                                     │
│                                                  │
│  ┌──────────────────────────────────────┐        │
│  │  Supervisor (本项目)                  │        │
│  │                                      │        │
│  │  gRPC Server ← 接收管理后台指令       │        │
│  │       │                              │        │
│  │  Docker Manager → 管理容器生命周期    │        │
│  │       │                              │        │
│  │  Stdio Bridge → 桥接 dsh JSON-RPC    │        │
│  │       │                              │        │
│  │  Blueprint → 生成 cordis.yml 配置     │        │
│  └───────┼──────────────────────────────┘        │
│          │ Docker API                            │
│          ▼                                       │
│  ┌─ dsh-agent 容器 (租户A/Agent1) ────────────┐  │
│  │  deepseek-harness 完整运行时                │  │
│  │  ├── Cordis 插件栈                         │  │
│  │  ├── agent-loop (对话循环)                  │  │
│  │  ├── LLM adapter (DeepSeek / OpenAI 兼容)  │  │
│  │  ├── system-prompt (提示词)                 │  │
│  │  ├── tools (工具)                          │  │
│  │  └── MCP client (按配置加载)                │  │
│  │  入口: dsh sdk-server (JSON-RPC stdio)     │  │
│  │  配置: /config/cordis.yml (挂载)            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌─ dsh-agent 容器 (租户B/Agent1) ────────────┐  │
│  │  (同上，完全隔离的独立容器)                   │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| gRPC Server | `src/grpc-server.ts` | 接收管理后台调用：创建/停止/销毁 Agent，发送消息 |
| Docker Manager | `src/docker-manager.ts` | 通过 Docker API 管理容器：创建、attach、停止、删除 |
| Blueprint Translator | `src/blueprint.ts` | 将管理后台下发的 Agent 配置翻译成 dsh 的 cordis.yml |
| Stdio Bridge | `src/stdio-bridge.ts` | 与容器内 dsh 的 JSON-RPC 通信，流式事件转为 gRPC 响应 |

## 每个 Agent 的隔离

每个 Agent 运行在独立的 Docker 容器中：

| 隔离维度 | 实现方式 |
|---------|---------|
| 文件系统 | 独立容器 rootfs，只挂载自己的 /config |
| 网络 | Docker bridge 网络，容器间不互通 |
| 环境变量 | API Key 等凭据仅注入自己的容器 |
| 资源 | `--memory` 和 `--cpus` 限制 |
| 进程 | 容器内 PID namespace 隔离 |

## Agent 创建流程

```
管理员在后台点击"发布"
       │
       ▼
1. 管理后台查询 Agent 配置 (提示词 + MCP + Skill)
       │
       ▼
2. 组装 AgentBlueprint，gRPC 调用 Supervisor.CreateAgent
       │
       ▼
3. Supervisor 收到 Blueprint
   ├── Blueprint Translator 生成 cordis.yml
   │   写入 /data/agents/{tenantId}/{agentId}/cordis.yml
   │
   ├── Docker Manager 创建容器
   │   镜像: dsh-agent:latest
   │   挂载: /data/agents/{t}/{a}/ → /config/
   │   环境: DEEPSEEK_API_KEY, DSH_TENANT_ID, ...
   │   资源: 512MB 内存, 1 CPU
   │
   ├── 启动容器，attach 获取 stdio 流
   │
   └── 通过 stdio 发送 JSON-RPC initialize
       容器内 dsh sdk-server 加载 cordis.yml 完成初始化
       │
       ▼
4. 返回 CreateAgentResponse(success)
   管理后台更新 Agent 状态为 Running
```

## 聊天流程

```
用户发消息 "你好"
       │
       ▼
1. 前端 WebSocket → 管理后台
       │
       ▼
2. 管理后台存储用户消息，gRPC 调用 Supervisor.SendMessage
       │
       ▼
3. Supervisor 找到对应容器的 stdio 连接
   发送 JSON-RPC: session/prompt {sessionId, text: "你好"}
       │
       ▼
4. 容器内 dsh agent-loop 调用 DeepSeek API，流式返回
   stdout 输出 JSON-RPC notifications:
     session/event {type: "content_block_delta", delta: {text: "你"}}
     session/event {type: "content_block_delta", delta: {text: "好"}}
     session/event {type: "message_stop", ...}
       │
       ▼
5. Stdio Bridge 将 dsh 事件转为 gRPC ChatChunk 流
   → 管理后台 → WebSocket → 前端 (打字机效果)
       │
       ▼
6. 流结束，管理后台存储 assistant 消息
```

## 部署步骤

### 前置条件

- 阿里云服务器 (Linux, 有公网 IP)
- 安全组开放 TCP 50051 端口
- DeepSeek API Key

### 1. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker
```

### 2. 上传项目到服务器

```bash
# 从本地上传
scp -r D:/gtihub/digital-human-runtime root@<阿里云IP>:/opt/digital-human-runtime
scp -r D:/gtihub/deepseek-harness root@<阿里云IP>:/opt/deepseek-harness
```

### 3. 构建 dsh-agent 基础镜像

在阿里云服务器上执行（首次构建约 10-15 分钟）：

```bash
cd /opt/deepseek-harness
docker build -f /opt/digital-human-runtime/agent.Dockerfile -t dsh-agent:latest .
```

> 这个镜像包含完整的 deepseek-harness 运行时，所有 agent 容器共享这个基础镜像。

### 4. 构建并启动 Supervisor

```bash
cd /opt/digital-human-runtime

# 先编译 TypeScript
npm install
npm run build

# 配置环境变量
cat > .env << 'EOF'
DEEPSEEK_API_KEY=sk-your-api-key-here
EOF

# 启动
docker compose up -d
```

### 5. 验证

```bash
# 查看 Supervisor 容器
docker ps

# 查看日志
docker compose logs -f

# 应该看到:
# gRPC listening on 0.0.0.0:50051
# Runtime Supervisor started
```

### 6. 管理后台对接

修改管理后台配置 `appsettings.Development.json`：

```json
{
  "AgentRuntime": {
    "Endpoint": "http://<阿里云公网IP>:50051"
  }
}
```

重启管理后台，创建 Agent 并点击"发布"即可。

## 项目结构

```
digital-human-runtime/
├── package.json              # 依赖: @grpc/grpc-js, dockerode, yaml
├── tsconfig.json
├── docker-compose.yml        # 一键部署 Supervisor
├── Dockerfile                # Supervisor 镜像
├── agent.Dockerfile          # dsh-agent 基础镜像 (deepseek-harness)
├── .dockerignore
├── proto/
│   └── agent_runtime.proto   # gRPC 协议定义 (与管理后台共享)
├── src/
│   ├── main.ts               # 入口: 加载配置，启动 gRPC
│   ├── grpc-server.ts        # gRPC 服务端
│   ├── docker-manager.ts     # Docker 容器管理
│   ├── stdio-bridge.ts       # JSON-RPC stdio 桥接
│   ├── blueprint.ts          # Blueprint → cordis.yml
│   └── types.ts              # 类型定义
└── dist/                     # 编译输出
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `GRPC_HOST` | gRPC 监听地址 | `0.0.0.0` |
| `GRPC_PORT` | gRPC 监听端口 | `50051` |
| `DATA_ROOT` | Agent 配置数据目录 | `/data/agents` |
| `DSH_IMAGE` | dsh-agent Docker 镜像名 | `dsh-agent:latest` |
| `MAX_CONTAINERS` | 最大容器数 | `50` |
| `CONTAINER_MEMORY` | 每容器内存限制 | `512m` |
| `CONTAINER_CPU` | 每容器 CPU 限制 | `1` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | 必填 |

## gRPC 接口

| 方法 | 说明 |
|------|------|
| `CreateAgent(tenantId, agentId, blueprint)` | 创建容器并启动 agent |
| `StopAgent(tenantId, agentId)` | 停止容器 |
| `DestroyAgent(tenantId, agentId)` | 销毁容器并清理数据 |
| `GetAgentStatus(tenantId, agentId)` | 查询 agent 运行状态 |
| `SendMessage(tenantId, agentId, sessionId, message)` | 发送消息，返回流式响应 |
