import { Info, Loader2, RefreshCw } from 'lucide-react';
import { VOICE_PRESETS, getVoicePreset } from './voicePresets';

interface VoiceEditorProps {
  voiceSettings: {
    voiceType: string;
    speed: number;
  };
  onUpdate: (s: any) => void;
  onRegenerate?: () => void;
  saving?: boolean;
  supportsSelectableVoices?: boolean;
  previewProvider?: string | null;
  multipleVoicesEnabled?: boolean;
  storyMode?: boolean;
}

export function VoiceEditor({
  voiceSettings,
  onUpdate,
  onRegenerate,
  saving,
  supportsSelectableVoices = false,
  previewProvider,
  multipleVoicesEnabled = false,
  storyMode = false
}: VoiceEditorProps) {
  const corePresets = VOICE_PRESETS.filter((preset) => preset.value === 'male' || preset.value === 'female');
  const availablePresets = multipleVoicesEnabled ? VOICE_PRESETS : corePresets;
  const selectedPreset = getVoicePreset(
    availablePresets.some((preset) => preset.value === voiceSettings.voiceType)
      ? voiceSettings.voiceType
      : availablePresets[0].value
  );
  const providerLabel = previewProvider === 'elevenlabs'
    ? 'ElevenLabs'
    : previewProvider === 'google'
      ? 'Google TTS fallback'
      : supportsSelectableVoices
        ? 'Ready for ElevenLabs preview'
        : 'Default fallback voice';
  const providerTone = previewProvider === 'google'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <div className="space-y-4">
      <h3 className="font-bold text-slate-900">Voice Editing</h3>
      {storyMode && (
        <div className="rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-700">
          Story mode is active. Voice previews will try to preserve the selected narration mood across the full story.
        </div>
      )}
      
      <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          {supportsSelectableVoices
            ? 'Voice presets are available. If preview falls back to Google TTS, most presets may sound the same until ElevenLabs is working.'
            : 'Male and female voices are available right now. Additional presets appear when ElevenLabs is configured.'}
        </span>
      </div>

      <div className={`rounded-xl border px-3 py-2 text-xs ${providerTone}`}>
        <div className="font-semibold">Preview provider</div>
        <div className="mt-1">{providerLabel}</div>
      </div>
      
      <div className="flex gap-4 items-center">
        <label className="text-sm font-bold w-24">Voice Type</label>
        <select 
          value={selectedPreset.value} 
          onChange={e => onUpdate({ ...voiceSettings, voiceType: e.target.value })} 
          className="border p-2 rounded flex-1"
        >
          {availablePresets.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {availablePresets.map((preset) => {
          const isActive = selectedPreset.value === preset.value;
          return (
            <button
              key={preset.value}
              type="button"
              onClick={() => onUpdate({ ...voiceSettings, voiceType: preset.value })}
              className={`rounded-lg border px-3 py-3 text-left text-sm transition-all ${
                isActive
                  ? 'border-purple-600 bg-purple-50 text-purple-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-purple-300'
              }`}
            >
              <div className="font-semibold">{preset.label}</div>
              <div className="mt-1 text-xs opacity-80">{preset.description}</div>
            </button>
          );
        })}
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <div className="font-semibold text-slate-800">{selectedPreset.label}</div>
        <div>{selectedPreset.description}</div>
      </div>
      <div className="flex gap-4 items-center">
        <label className="text-sm font-bold w-24">Voice Speed</label>
        <select 
          value={voiceSettings.speed} 
          onChange={e => onUpdate({ ...voiceSettings, speed: parseFloat(e.target.value) })} 
          className="border p-2 rounded flex-1"
        >
          <option value="0.8">0.8x (Slower)</option>
          <option value="1">1x (Normal)</option>
          <option value="1.2">1.2x (Faster)</option>
        </select>
      </div>
      {onRegenerate && (
        <button 
          onClick={onRegenerate}
          disabled={saving}
          className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white p-3 rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50 hover:shadow-lg transition-all"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {storyMode ? 'Generating Story Voice Preview...' : 'Generating Voice Preview...'}
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              {storyMode ? 'Refresh Story Voice Preview' : 'Refresh Voice Preview'}
            </>
          )}
        </button>
      )}
    </div>
  );
}
