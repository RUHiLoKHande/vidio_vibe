export interface VoicePreset {
  value: string;
  label: string;
  description: string;
}

export const VOICE_PRESETS: VoicePreset[] = [
  { value: 'male', label: 'Adam - Firm Male', description: 'Strong, direct, and professional.' },
  { value: 'female', label: 'Sarah - Confident Female', description: 'Polished, clear, and assertive.' },
  { value: 'energetic', label: 'Liam - Energetic Creator', description: 'Punchy, promotional, and social-first.' },
  { value: 'warm', label: 'Jessica - Warm Conversational', description: 'Friendly, upbeat, and welcoming.' },
  { value: 'deep', label: 'Brian - Deep Resonant', description: 'Heavy, rich, and authoritative.' },
  { value: 'calm', label: 'River - Calm Neutral', description: 'Relaxed, even, and steady.' },
  { value: 'storyteller', label: 'George - Storyteller', description: 'Expressive and narrative-led.' },
  { value: 'broadcaster', label: 'Daniel - Broadcaster', description: 'Formal, crisp, and announcer-like.' },
  { value: 'educator', label: 'Alice - Educator', description: 'Clear teaching tone with warmth.' },
  { value: 'classy', label: 'Roger - Classy Casual', description: 'Smooth, stylish, and conversational.' }
];

export const getVoicePreset = (voiceType: string) =>
  VOICE_PRESETS.find((preset) => preset.value === voiceType) || VOICE_PRESETS[0];
