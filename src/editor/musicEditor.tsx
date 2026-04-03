import { Upload, Loader2, Music, Volume2 } from 'lucide-react';

interface MusicEditorProps {
  musicSettings: {
    preset: string;
    volume: number;
    musicPath?: string;
  };
  onUpdate: (s: any) => void;
  onUploadMusic?: () => void;
  saving?: boolean;
}

export function MusicEditor({ musicSettings, onUpdate, onUploadMusic, saving }: MusicEditorProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Music className="w-4 h-4" />
        <h3 className="font-bold">Background Music</h3>
      </div>

      <div className="flex gap-4 items-center">
        <label className="w-20 text-sm font-bold">Preset</label>
        <select
          value={musicSettings.preset === 'custom' ? 'custom' : musicSettings.preset}
          onChange={(e) => {
            const preset = e.target.value;
            onUpdate({
              ...musicSettings,
              preset,
              musicPath: preset === 'custom' ? musicSettings.musicPath : undefined
            });
          }}
          className="flex-1 rounded border p-2"
        >
          <option value="corporate">Corporate Upbeat</option>
          <option value="cinematic">Cinematic Epic</option>
          <option value="chill">Chill Lo-Fi</option>
          <option value="custom">Custom Upload...</option>
        </select>
      </div>

      {musicSettings.preset === 'custom' && musicSettings.musicPath && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">
          <span className="font-semibold">Custom track ready.</span>
          <span>Your uploaded music will be used in the next render.</span>
        </div>
      )}

      <div className="flex gap-4 items-center">
        <label className="flex w-20 items-center gap-1 text-sm font-bold">
          <Volume2 className="w-3 h-3" />
          Volume
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={musicSettings.volume}
          onChange={(e) => onUpdate({ ...musicSettings, volume: parseFloat(e.target.value) })}
          className="flex-1 accent-purple-600"
        />
        <span className="w-12 text-xs font-mono">{Math.round(musicSettings.volume * 100)}%</span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        Pick a preset for quick mood matching, or upload your own track for the next preview and export.
      </div>

      {onUploadMusic && (
        <button
          onClick={onUploadMusic}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-purple-500 p-2 font-medium text-purple-600 transition-all hover:bg-purple-50 disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Applying Music...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Upload Own Music
            </>
          )}
        </button>
      )}
    </div>
  );
}
