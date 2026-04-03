import { Scene } from './sceneEditor';

const FALLBACK_SCENE_IMAGE = '/uploads/_fallback/black_1280x720.jpg';

interface TimelineProps {
  scenes: Scene[];
  activeSceneId?: string;
  onSelectScene?: (sceneId: string) => void;
  onReorder: (s: Scene[]) => void;
  onDurationAdjust?: (sceneId: string, nextDuration: number) => void;
}

export function Timeline({ scenes, activeSceneId, onSelectScene, onReorder, onDurationAdjust }: TimelineProps) {
  const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);

  if (scenes.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Your timeline will appear here once you add scenes.
      </div>
    );
  }

  return (
    <div className="mt-8 border-t p-4">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="font-bold">Timeline (Total: {totalDuration.toFixed(1)}s)</h3>
        <p className="text-xs text-slate-500">Drag to reorder. Use +/- to tighten pacing scene by scene.</p>
      </div>
      <div className="flex h-20 items-end gap-2 overflow-x-auto pb-2">
        {scenes.map((scene, i) => {
          const width = Math.max(70, (scene.duration / Math.max(totalDuration, 1)) * 500);

          return (
            <div
              key={scene.id}
              draggable
              onClick={() => onSelectScene?.(scene.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectScene?.(scene.id);
                }
              }}
              onDragStart={(event) => event.dataTransfer.setData('text/plain', String(i))}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const fromIndex = Number(event.dataTransfer.getData('text/plain'));
                if (Number.isNaN(fromIndex) || fromIndex === i) return;

                const nextScenes = [...scenes];
                const [movedScene] = nextScenes.splice(fromIndex, 1);
                nextScenes.splice(i, 0, movedScene);
                onReorder(nextScenes);
              }}
              role="button"
              tabIndex={0}
              style={{ width }}
              className={`relative flex h-full flex-col justify-end overflow-hidden rounded-lg border-2 transition-all ${
                activeSceneId === scene.id ? 'border-purple-500 shadow-md' : 'border-gray-300'
              }`}
            >
              {scene.imageUrl ? (
                <img
                  src={scene.imageUrl}
                  className="absolute inset-0 h-full w-full object-cover opacity-60"
                  onError={(event) => {
                    (event.target as HTMLImageElement).src = FALLBACK_SCENE_IMAGE;
                  }}
                />
              ) : (
                <div className="absolute inset-0 bg-slate-300" />
              )}

              <div className="relative z-10 truncate bg-black/65 p-1 text-center text-[10px] text-white">
                Scene {i + 1} ({scene.duration}s)
              </div>

              <div className="absolute left-1 top-1 z-20 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
                Drag
              </div>

              <div className="absolute right-1 top-1 z-20 flex gap-1">
                {onDurationAdjust && (
                  <>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onDurationAdjust(scene.id, Math.max(1, Number((scene.duration - 0.5).toFixed(1))));
                      }}
                      className="rounded bg-white/80 px-1 text-[10px] text-black"
                    >
                      -
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onDurationAdjust(scene.id, Math.min(30, Number((scene.duration + 0.5).toFixed(1))));
                      }}
                      className="rounded bg-white/80 px-1 text-[10px] text-black"
                    >
                      +
                    </button>
                  </>
                )}
                {i > 0 && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      const newScenes = [...scenes];
                      [newScenes[i - 1], newScenes[i]] = [newScenes[i], newScenes[i - 1]];
                      onReorder(newScenes);
                    }}
                    className="rounded bg-white/80 px-1 text-[10px] text-black"
                  >
                    {'<'}
                  </button>
                )}
                {i < scenes.length - 1 && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      const newScenes = [...scenes];
                      [newScenes[i], newScenes[i + 1]] = [newScenes[i + 1], newScenes[i]];
                      onReorder(newScenes);
                    }}
                    className="rounded bg-white/80 px-1 text-[10px] text-black"
                  >
                    {'>'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
