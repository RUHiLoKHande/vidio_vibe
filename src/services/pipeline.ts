export type PipelineStageId =
  | 'input'
  | 'script'
  | 'scene-planning'
  | 'assets'
  | 'voice'
  | 'music'
  | 'render';

export interface PipelineStage {
  id: PipelineStageId;
  label: string;
  description: string;
  provider: 'gemini' | 'open-source' | 'hybrid' | 'local';
  parallelizable?: boolean;
}

export interface DirectorModeConfig {
  enabled: boolean;
  pacing: 'auto' | 'fast' | 'balanced' | 'cinematic';
  visualStyle: 'auto' | 'cinematic' | 'realistic' | 'minimal' | 'product-ad';
}

export const DEFAULT_DIRECTOR_MODE: DirectorModeConfig = {
  enabled: true,
  pacing: 'auto',
  visualStyle: 'auto'
};

export const VIDEO_PIPELINE_STAGES: PipelineStage[] = [
  {
    id: 'input',
    label: 'Input',
    description: 'Collect prompt, language, duration, and creative intent.',
    provider: 'local'
  },
  {
    id: 'script',
    label: 'Script Generation',
    description: 'Generate core script with Gemini and fallback heuristics.',
    provider: 'hybrid'
  },
  {
    id: 'scene-planning',
    label: 'Scene Planning',
    description: 'Plan pacing, scene count, prompts, and creative direction.',
    provider: 'gemini'
  },
  {
    id: 'assets',
    label: 'Asset Generation',
    description: 'Generate images or video clips with hybrid providers.',
    provider: 'hybrid',
    parallelizable: true
  },
  {
    id: 'voice',
    label: 'Voice Generation',
    description: 'Generate multilingual TTS and preview audio.',
    provider: 'hybrid',
    parallelizable: true
  },
  {
    id: 'music',
    label: 'Music + Effects',
    description: 'Apply mood-based music and supporting audio effects.',
    provider: 'local',
    parallelizable: true
  },
  {
    id: 'render',
    label: 'Final Rendering',
    description: 'Assemble visuals, audio, subtitles, and motion into final video.',
    provider: 'local'
  }
];

export function getPipelineStages() {
  return VIDEO_PIPELINE_STAGES;
}
