import { GrpcServer } from './grpc-server.js';
import { DockerManager } from './docker-manager.js';
import type { RuntimeConfig } from './types.js';

const config: RuntimeConfig = {
  grpcHost: process.env.GRPC_HOST || '0.0.0.0',
  grpcPort: parseInt(process.env.GRPC_PORT || '50051'),
  dataRoot: process.env.DATA_ROOT || '/data/agents',
  dshImage: process.env.DSH_IMAGE || 'dsh-agent:latest',
  maxContainers: parseInt(process.env.MAX_CONTAINERS || '50'),
  containerMemory: process.env.CONTAINER_MEMORY || '512m',
  containerCpu: parseFloat(process.env.CONTAINER_CPU || '1'),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
};

async function main() {
  if (!config.deepseekApiKey) {
    console.error('ERROR: DEEPSEEK_API_KEY is required');
    process.exit(1);
  }

  const manager = new DockerManager(config);
  const server = new GrpcServer(manager);

  await server.listen(config.grpcHost, config.grpcPort);

  console.log('Runtime Supervisor started');
  console.log(`  Image: ${config.dshImage}`);
  console.log(`  Max containers: ${config.maxContainers}`);
  console.log(`  Memory/container: ${config.containerMemory}`);

  const shutdown = async () => {
    console.log('Shutting down...');
    await manager.destroyAll();
    server.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
