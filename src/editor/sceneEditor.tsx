import { Copy, ImagePlus, RefreshCw, Trash2, Upload } from 'lucide-react';

const FALLBACK_SCENE_IMAGE = '/uploads/_fallback/black_1280x720.jpg';

export interface Scene {
  id: string;
  imageUrl: string;
  imageLocalUrl?: string;
  imageS3Key?: string;
  textOverlay: string;
  narration: string;
  duration: number;
  image_prompt?: string;
  title?: string;
  visual_description?: string;
  character_actions?: string;
  storyBeat?: string;
  emotion?: string;
  characters?: string[];
  transition?: string;
  sound_effects?: string[];
  image_variations?: string[];
  voice_hint?: string;
  imageExists?: boolean;
}

interface SceneEditorProps {
  scenes: Scene[];
  onUpdate: (s: Scene[]) => void;
  activeSceneId?: string;
  onSelectScene?: (sceneId: string) => void;
  onReplaceImage?: (sceneIndex: number) => void;
  onRegenerateImage?: (sceneIndex: number) => void;
  onRemoveImage?: (sceneIndex: number) => void;
  onDuplicateScene?: (sceneIndex: number) => void;
  saving?: boolean;
}

export function SceneEditor({
  scenes,
  onUpdate,
  activeSceneId,
  onSelectScene,
  onReplaceImage,
  onRegenerateImage,
  onRemoveImage,
  onDuplicateScene,
  saving
}: SceneEditorProps) {
  const updateScene = (sceneIndex: number, patch: Partial<Scene>) => {
    onUpdate(
      scenes.map((scene, index) =>
        index === sceneIndex ? { ...scene, ...patch } : scene
      )
    );
  };

  const addScene = () => {
    const nextNumber = scenes.length + 1;
    onUpdate([
      ...scenes,
      {
        id: Date.now().toString(),
        imageUrl: '',
        textOverlay: '',
        narration: '',
        duration: 3,
        image_prompt: `Advertisement scene ${nextNumber}`,
        imageExists: false
      }
    ]);
  };

  const removeScene = (sceneIndex: number) => {
    const newScenes = scenes.filter((_, index) => index !== sceneIndex);
    onUpdate(newScenes);
    if (newScenes.length > 0) {
      onSelectScene?.(newScenes[Math.min(sceneIndex, newScenes.length - 1)].id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">Scenes</h3>
        <button
          onClick={addScene}
          className="inline-flex items-center gap-2 rounded-lg bg-black px-3 py-2 text-sm font-medium text-white"
        >
          <ImagePlus className="h-4 w-4" />
          Add Scene
        </button>
      </div>
      <p className="text-xs text-slate-500">Duplicate scenes, fine-tune prompts, and keep your story flow tight before rendering.</p>

      {scenes.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
          <p className="font-medium text-slate-700">No scenes yet</p>
          <p className="mt-1 text-sm text-slate-500">Add a scene to start building your ad preview.</p>
          <button
            onClick={addScene}
            className="mt-4 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
          >
            Add First Scene
          </button>
        </div>
      )}

      {scenes.map((scene, i) => (
        <div
          key={scene.id}
          onClick={() => onSelectScene?.(scene.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelectScene?.(scene.id);
            }
          }}
          role="button"
          tabIndex={0}
          className={`w-full rounded-2xl border p-4 text-left transition-all ${
            activeSceneId === scene.id
              ? 'border-purple-500 bg-purple-50 shadow-md'
              : 'border-slate-200 bg-white hover:border-purple-300'
          }`}
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-600">
                Scene {i + 1}
              </div>
              {scene.title && (
                <div className="mt-1 text-sm font-semibold text-slate-700">
                  {scene.title}
                </div>
              )}
              <div className="mt-1 text-xs text-slate-500">
                {scene.storyBeat ? `${scene.storyBeat.toUpperCase()} | ` : ''}
                {scene.image_prompt?.trim() || 'Image prompt will be generated from your script'}
              </div>
              {scene.transition && (
                <div className="mt-1 text-[11px] font-medium text-slate-500">
                  Transition: {scene.transition}
                </div>
              )}
            </div>
            <div className="space-y-1 text-right">
              <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                {scene.duration}s
              </div>
              <div className={`text-[11px] font-medium ${scene.imageUrl ? 'text-emerald-600' : 'text-amber-600'}`}>
                {scene.imageUrl ? 'Image ready' : 'Needs image'}
              </div>
            </div>
          </div>

          <div className="mb-4 aspect-video overflow-hidden rounded-xl bg-slate-950">
            {scene.imageUrl ? (
              <img
                src={scene.imageUrl}
                alt={`Scene ${i + 1}`}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = FALLBACK_SCENE_IMAGE;
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-white/60">
                No image yet
              </div>
            )}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
            {onReplaceImage && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onReplaceImage(i);
                }}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                Replace
              </button>
            )}
            {onRegenerateImage && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRegenerateImage(i);
                }}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" />
                Regenerate
              </button>
            )}
            {onRemoveImage && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveImage(i);
                }}
                disabled={saving || !scene.imageUrl}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            )}
            {onDuplicateScene && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDuplicateScene(i);
                }}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
              >
                <Copy className="h-4 w-4" />
                Duplicate
              </button>
            )}
          </div>

          <div className="space-y-3" onClick={(event) => event.stopPropagation()}>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-bold text-gray-500">Duration</label>
                <span className="text-xs font-medium text-slate-500">{scene.duration}s</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  value={scene.duration}
                  min={1}
                  max={15}
                  step={0.5}
                  onChange={e => updateScene(i, { duration: parseFloat(e.target.value) || 3 })}
                  className="flex-1 accent-purple-600"
                />
                <input
                  type="number"
                  value={scene.duration}
                  min={1}
                  max={30}
                  step={0.5}
                  onChange={e => updateScene(i, { duration: parseFloat(e.target.value) || 3 })}
                  className="w-20 rounded-lg border border-slate-300 p-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-gray-500">Transition</label>
              <select
                value={scene.transition || 'cinematic-cut'}
                onChange={e => updateScene(i, { transition: e.target.value })}
                className="w-full rounded-lg border border-slate-300 p-2.5"
              >
                <option value="cinematic-cut">Cinematic Cut</option>
                <option value="fade">Fade</option>
                <option value="slide">Slide</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-gray-500">Characters</label>
              <input
                type="text"
                value={Array.isArray(scene.characters) ? scene.characters.join(', ') : ''}
                onChange={e =>
                  updateScene(i, {
                    characters: e.target.value
                      .split(',')
                      .map((entry) => entry.trim())
                      .filter(Boolean)
                  })
                }
                className="w-full rounded-lg border border-slate-300 p-2.5"
                placeholder="Main character, friend, rival..."
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-gray-500">Overlay Text</label>
              <input
                type="text"
                value={scene.textOverlay}
                onChange={e => updateScene(i, { textOverlay: e.target.value })}
                className="w-full rounded-lg border border-slate-300 p-2.5"
                placeholder="Enter overlay text..."
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-gray-500">Narration</label>
              <textarea
                value={scene.narration}
                onChange={e => updateScene(i, { narration: e.target.value })}
                className="w-full rounded-lg border border-slate-300 p-2.5"
                rows={3}
                placeholder="Enter narration..."
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-gray-500">Image Prompt</label>
              <textarea
                value={scene.image_prompt || ''}
                onChange={e => updateScene(i, { image_prompt: e.target.value })}
                className="w-full rounded-lg border border-slate-300 p-2.5"
                rows={2}
                placeholder="Describe the scene visual..."
              />
            </div>

            {scenes.length > 1 && (
              <button
                type="button"
                onClick={() => removeScene(i)}
                className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Delete Scene
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
