import { GrpcServer } from './grpc-server.js';
import { DockerProcessPool } from './docker-pool.js';
const config = {
    grpcHost: process.env.GRPC_HOST || '0.0.0.0',
    grpcPort: parseInt(process.env.GRPC_PORT || '50051'),
    dataRoot: process.env.DATA_ROOT || '/data/agents',
    dshImage: process.env.DSH_IMAGE || 'digital-human-agent:latest',
    maxContainers: parseInt(process.env.MAX_CONTAINERS || '50'),
    containerMemoryLimit: process.env.CONTAINER_MEMORY || '512m',
    containerCpuLimit: parseFloat(process.env.CONTAINER_CPU || '1'),
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
};
async function main() {
    if (!config.deepseekApiKey) {
        console.error('DEEPSEEK_API_KEY is required');
        process.exit(1);
    }
    const pool = new DockerProcessPool(config);
    const server = new GrpcServer(pool);
    await server.listen(config.grpcHost, config.grpcPort);
    console.log('Runtime Supervisor started');
    console.log(`  gRPC: ${config.grpcHost}:${config.grpcPort}`);
    console.log(`  Docker image: ${config.dshImage}`);
    console.log(`  Max containers: ${config.maxContainers}`);
    console.log(`  Memory per container: ${config.containerMemoryLimit}`);
    const shutdown = async () => {
        console.log('Shutting down...');
        await pool.destroyAll();
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
