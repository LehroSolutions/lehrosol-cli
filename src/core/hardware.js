// Hardware detection + model-fit rating for local GGUF models.
// Zero-dependency: node:os for RAM/CPU; best-effort GPU probes — nvidia-smi
// for dedicated VRAM, PowerShell CIM / lspci for adapter names so integrated
// GPUs (Intel UHD/Iris, AMD APUs, Apple) are recognised for what they are:
// they share system RAM, add no inference budget, and CPU is the fast path.
import { execFileSync } from 'node:child_process';
import { totalmem, freemem, cpus, platform } from 'node:os';

const GB = 1024 ** 3;
const round1 = (n) => Math.round(n * 10) / 10;

// Classify a raw GPU adapter name into vendor + integrated/dedicated.
// Integrated examples: "Intel(R) UHD Graphics 620", "AMD Radeon(TM) Graphics".
// Dedicated examples: "NVIDIA GeForce RTX 3060", "Intel(R) Arc(TM) A770".
export function classifyGpuName(name) {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return null;
  const vendor = /nvidia|geforce|\brtx\b|\bgtx\b|quadro|tesla/.test(n) ? 'nvidia'
    : /intel|\buhd\b|\biris\b|\barc\b/.test(n) ? 'intel'
    : /\bamd\b|radeon|\bvega\b/.test(n) ? 'amd'
    : /apple/.test(n) ? 'apple'
    : 'unknown';
  const integrated =
    vendor === 'apple' ||
    (vendor === 'intel' && !/\barc\b/.test(n)) ||
    (vendor === 'amd' && /vega \d|radeon\(tm\) graphics|radeon graphics$/.test(n));
  return { vendor, integrated };
}

// llama.cpp's matmul saturates physical cores; hyperthreads only add cache
// contention. On SMT machines (8 logical / 4 physical is the classic UHD-620
// laptop) -t logical/2 beats the logical-core default.
export function recommendThreads(logicalCores) {
  const logical = Number.isFinite(logicalCores) && logicalCores > 0
    ? Math.floor(logicalCores)
    : (cpus() || []).length || 1;
  return logical >= 4 ? Math.floor(logical / 2) : Math.max(1, logical);
}

function probeGpuNames() {
  try {
    if (platform() === 'win32') {
      const out = execFileSync('powershell.exe', [
        '-NoProfile', '-Command',
        '(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join [Environment]::NewLine',
      ], { encoding: 'utf8', timeout: 8000, windowsHide: true });
      return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
    const out = execFileSync('sh', ['-c', 'lspci 2>/dev/null | grep -iE "vga|3d|display"'], { encoding: 'utf8', timeout: 5000 });
    return out.split('\n').map((l) => l.split(': ').slice(1).join(': ').trim()).filter(Boolean);
  } catch { return []; }
}

let cachedGpu; // probe subprocesses once per process — TUI refreshes stay instant

function detectGpu() {
  try {
    const out = execFileSync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 5000 },
    );
    const line = out.trim().split('\n')[0];
    if (line) {
      const parts = line.split(',').map((s) => s.trim());
      const vramMb = Number(parts[1]);
      if (parts[0] && Number.isFinite(vramMb)) {
        return { vendor: 'nvidia', name: parts[0], vramGB: round1(vramMb / 1024), integrated: false };
      }
    }
  } catch { /* no NVIDIA driver — fall through to adapter-name probes */ }
  for (const name of probeGpuNames()) {
    const cls = classifyGpuName(name);
    if (cls && cls.vendor !== 'unknown') {
      return { vendor: cls.vendor, name: name.trim(), vramGB: null, integrated: cls.integrated };
    }
  }
  return null;
}

export function detectHardware() {
  if (cachedGpu === undefined) cachedGpu = detectGpu();
  const cpuList = cpus() || [];
  return {
    platform: platform(),
    totalMemGB: round1(totalmem() / GB),
    freeMemGB: round1(freemem() / GB),
    cpuCores: cpuList.length,
    cpuModel: (cpuList[0] && cpuList[0].model) || 'unknown',
    recommendedThreads: recommendThreads(cpuList.length),
    gpu: cachedGpu,
  };
}

// Working-set estimate for a GGUF: weights + KV cache + runtime overhead.
export function estimateRequiredGB(sizeBytes) {
  return round1((sizeBytes / GB) * 1.15 + 1.5);
}

// Budget: dedicated-VRAM boxes get the larger of VRAM or 70% of system RAM
// (llama.cpp can split); everything else — including integrated GPUs, which
// carve their "VRAM" out of the same RAM — gets 70% of RAM so the OS and the
// project keep room. Acceleration is only claimed for dedicated VRAM: iGPU
// offload on chips like the UHD 620 rarely beats a well-threaded CPU run.
export function rateModelFit(sizeBytes, hw) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { requiredGB: null, budgetGB: null, fit: 'unknown', accelerated: false };
  }
  const requiredGB = estimateRequiredGB(sizeBytes);
  const ramBudget = hw.totalMemGB * 0.7;
  const dedicated = Boolean(hw.gpu && !hw.gpu.integrated && Number.isFinite(hw.gpu.vramGB));
  const budgetGB = round1(dedicated ? Math.max(hw.gpu.vramGB, ramBudget) : ramBudget);
  let fit = 'no-fit';
  if (requiredGB <= budgetGB * 0.6) fit = 'great';
  else if (requiredGB <= budgetGB) fit = 'tight';
  const accelerated = dedicated && requiredGB <= hw.gpu.vramGB;
  return { requiredGB, budgetGB, fit, accelerated };
}

export function suggestRole(modelId, sizeBytes) {
  const id = String(modelId || '').toLowerCase();
  const sizeGB = Number.isFinite(sizeBytes) ? sizeBytes / GB : null;
  if (sizeGB != null && sizeGB < 0.5) return 'drafts only — too small for agent loops';
  if (/coder|[-_]code|codestral/.test(id)) return 'coding loop (forge/medic)';
  if (/[-_]mt[-_0-9]|translat/.test(id)) return 'translation / utility';
  if (sizeGB != null && sizeGB >= 4.5) return 'planning & review (recon/sentinel)';
  return 'general agent tasks';
}
