// Curated model profiles for common hosted and local providers.
// Profiles are defaults, not a closed list: users can still save any model/baseUrl.
export const MODEL_PROFILES = Object.freeze([
  { id: 'grok-4.5', adapter: 'grok', model: 'grok-4.5', baseUrl: 'https://api.x.ai/v1', label: 'Grok 4.5', capability: 'frontier', tools: true },
  { id: 'grok-4', adapter: 'grok', model: 'grok-4', baseUrl: 'https://api.x.ai/v1', label: 'Grok 4', capability: 'frontier', tools: true },
  { id: 'nvidia-nemotron', adapter: 'nvidia', model: 'nvidia/llama-3.1-nemotron-70b-instruct', baseUrl: 'https://integrate.api.nvidia.com/v1', label: 'NVIDIA Nemotron 70B', capability: 'frontier', tools: true },
  { id: 'ollama-qwen-coder', adapter: 'ollama', model: 'qwen2.5-coder:7b', baseUrl: 'http://localhost:11434/v1', label: 'Ollama Qwen Coder 7B', capability: 'local', tools: true },
  { id: 'ollama-deepseek-coder', adapter: 'ollama', model: 'deepseek-coder-v2:16b', baseUrl: 'http://localhost:11434/v1', label: 'Ollama DeepSeek Coder V2', capability: 'local', tools: true },
  { id: 'lmstudio-local', adapter: 'lmstudio', model: 'local-model', baseUrl: 'http://localhost:1234/v1', label: 'LM Studio local model', capability: 'local', tools: true },
  { id: 'jan-local', adapter: 'jan', model: 'jan-model', baseUrl: 'http://localhost:6767/v1', label: 'Jan local model (jan serve)', capability: 'local', tools: true },
  { id: 'llamacpp-local', adapter: 'llamacpp', model: 'local-model', baseUrl: 'http://localhost:8080/v1', label: 'llama.cpp local model (llama-server)', capability: 'local', tools: true },
  { id: 'vllm-local', adapter: 'vllm', model: 'local-model', baseUrl: 'http://localhost:8000/v1', label: 'vLLM local model', capability: 'local', tools: true },
  { id: 'localai-local', adapter: 'localai', model: 'local-model', baseUrl: 'http://localhost:8080/v1', label: 'LocalAI model', capability: 'local', tools: true },
]);

export function listModelProfiles() {
  return MODEL_PROFILES.map((profile) => ({ ...profile }));
}

export function findModelProfile(id) {
  const key = String(id || '').trim().toLowerCase();
  return MODEL_PROFILES.find((profile) => profile.id === key) || null;
}

export function profilesForAdapter(adapterId) {
  const key = String(adapterId || '').trim().toLowerCase();
  return MODEL_PROFILES.filter((profile) => profile.adapter === key).map((profile) => ({ ...profile }));
}
