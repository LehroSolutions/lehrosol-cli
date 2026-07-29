// NVIDIA NIM / build.nvidia.com — OpenAI-compatible endpoint for Nemotron,
// Llama-Nemotron, DeepSeek, Qwen and more, with tool calling. Requires
// NVIDIA_API_KEY. Override with env:
//   LEHRO_NVIDIA_URL   (default https://integrate.api.nvidia.com/v1)
//   LEHRO_NVIDIA_MODEL (default nvidia/llama-3.1-nemotron-70b-instruct)
// See https://build.nvidia.com
import { createHttpAdapter } from './makeHttpAdapter.js';

const adapter = createHttpAdapter({
  id: 'nvidia',
  label: 'NVIDIA NIM',
  baseUrl: process.env.LEHRO_NVIDIA_URL || 'https://integrate.api.nvidia.com/v1',
  model: process.env.LEHRO_NVIDIA_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct',
  resolveModel: () => process.env.LEHRO_NVIDIA_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct',
  apiKeyEnv: 'NVIDIA_API_KEY',
  docs: 'https://build.nvidia.com',
});

export const meta = adapter.meta;
export const run = adapter.run;
