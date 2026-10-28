import { GrpcServer } from './grpc-server.js';
import { DockerManager } from './docker-manager.js';
const config = {
    grpcHost: process.env.GRPC_HOST || '0.0.0.0',
    grpcPort: parseInt(process.env.GRPC_PORT || '50051'),
    dataRoot: process.env.DATA_ROOT || '/data/agents',
    dshImage: process.env.DSH_IMAGE || 'dsh-agent:latest',
    maxContainers: parseInt(process.env.MAX_CONTAINERS || '50'),
    containerMemory: process.env.CONTAINER_MEMORY || '512m',
    containerCpu: parseFloat(process.env.CONTAINER_CPU || '1'),
    llmApiKey: process.env.LLM_API_KEY || '',
    llmApiBase: process.env.LLM_API_BASE || 'https://aihub.juxieyun.com/aihub-api/v1',
    llmDefaultModel: process.env.LLM_DEFAULT_MODEL || 'deepseek-v4-flash-0731',
};
async function main() {
    if (!config.llmApiKey) {
        console.error('ERROR: LLM_API_KEY is required');
        process.exit(1);
    }
    const manager = new DockerManager(config);
    const server = new GrpcServer(manager);
    await server.listen(config.grpcHost, config.grpcPort);
    console.log('Runtime Supervisor started');
    console.log(`  Image: ${config.dshImage}`);
    console.log(`  LLM API: ${config.llmApiBase}`);
    console.log(`  Default model: ${config.llmDefaultModel}`);
    console.log(`  Max containers: ${config.maxContainers}`);
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
