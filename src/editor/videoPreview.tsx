import { AlertCircle, Loader2, Pause, Play, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Scene } from './sceneEditor';

const FALLBACK_SCENE_IMAGE = '/uploads/_fallback/black_1280x720.jpg';

interface VideoPreviewProps {
  scenes: Scene[];
  activeSceneId?: string;
  onSelectScene?: (sceneId: string) => void;
  videoUrl: string | null;
  isLoading?: boolean;
  error?: string | null;
  isVertical?: boolean;
}

function getSceneStartTimes(scenes: Scene[]) {
  let elapsed = 0;
  return scenes.map((scene) => {
    const start = elapsed;
    elapsed += Math.max(scene.duration || 0, 0.5);
    return start;
  });
}

export function VideoPreview({
  scenes,
  activeSceneId,
  onSelectScene,
  videoUrl,
  isLoading = false,
  error = null,
  isVertical = false
}: VideoPreviewProps) {
  const [hasError, setHasError] = useState(false);
  const [previewMode, setPreviewMode] = useState<'live' | 'rendered'>(videoUrl ? 'rendered' : 'live');
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const playbackStartedAtRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const safeScenes = useMemo(
    () =>
      scenes.map((scene, index) => ({
        ...scene,
        id: scene.id || `scene_${index}`,
        duration: Math.max(scene.duration || 0, 0.5),
        imageUrl: scene.imageUrl || FALLBACK_SCENE_IMAGE
      })),
    [scenes]
  );

  const sceneStartTimes = useMemo(() => getSceneStartTimes(safeScenes), [safeScenes]);
  const totalDuration = useMemo(
    () => safeScenes.reduce((sum, scene) => sum + scene.duration, 0),
    [safeScenes]
  );

  const computedSceneIndex = useMemo(() => {
    if (safeScenes.length === 0) return -1;

    for (let index = safeScenes.length - 1; index >= 0; index -= 1) {
      if (elapsedSeconds >= sceneStartTimes[index]) {
        return index;
      }
    }

    return 0;
  }, [elapsedSeconds, safeScenes, sceneStartTimes]);

  const activeSceneIndex = useMemo(() => {
    if (activeSceneId) {
      const selectedIndex = safeScenes.findIndex((scene) => scene.id === activeSceneId);
      if (selectedIndex >= 0) return selectedIndex;
    }

    return computedSceneIndex;
  }, [activeSceneId, computedSceneIndex, safeScenes]);

  const currentScene = activeSceneIndex >= 0 ? safeScenes[activeSceneIndex] : null;
  const progress = totalDuration > 0 ? Math.min((elapsedSeconds / totalDuration) * 100, 100) : 0;

  useEffect(() => {
    setHasError(false);
  }, [videoUrl]);

  useEffect(() => {
    setPreviewMode(videoUrl ? 'rendered' : 'live');
  }, [videoUrl]);

  useEffect(() => {
    if (safeScenes.length === 0) {
      setElapsedSeconds(0);
      setIsPlaying(false);
      return;
    }

    if (activeSceneId && !isPlaying) {
      const selectedIndex = safeScenes.findIndex((scene) => scene.id === activeSceneId);
      if (selectedIndex >= 0) {
        setElapsedSeconds(sceneStartTimes[selectedIndex]);
      }
    }
  }, [activeSceneId, isPlaying, safeScenes, sceneStartTimes]);

  useEffect(() => {
    if (!currentScene?.id) return;
    onSelectScene?.(currentScene.id);
  }, [currentScene?.id, onSelectScene]);

  useEffect(() => {
    if (!isPlaying || safeScenes.length === 0 || previewMode !== 'live') return;

    playbackStartedAtRef.current = performance.now() - elapsedSeconds * 1000;

    const step = (timestamp: number) => {
      if (playbackStartedAtRef.current === null) {
        playbackStartedAtRef.current = timestamp - elapsedSeconds * 1000;
      }

      const nextElapsed = (timestamp - playbackStartedAtRef.current) / 1000;

      if (nextElapsed >= totalDuration) {
        setElapsedSeconds(totalDuration);
        setIsPlaying(false);
        playbackStartedAtRef.current = null;
        return;
      }

      setElapsedSeconds(nextElapsed);
      animationFrameRef.current = requestAnimationFrame(step);
    };

    animationFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [elapsedSeconds, isPlaying, previewMode, safeScenes.length, totalDuration]);

  useEffect(() => {
    if (!isPlaying) {
      playbackStartedAtRef.current = null;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }
  }, [isPlaying]);

  const jumpToScene = (sceneIndex: number) => {
    if (sceneIndex < 0 || sceneIndex >= safeScenes.length) return;
    setElapsedSeconds(sceneStartTimes[sceneIndex]);
    onSelectScene?.(safeScenes[sceneIndex].id);
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-slate-200 bg-black shadow-lg ${
        isVertical ? 'mx-auto aspect-[9/16] max-w-[360px]' : 'aspect-video'
      }`}
    >
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
            <span className="text-sm text-white/80">Rendering video...</span>
          </div>
        </div>
      )}

      <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
        <button
          onClick={() => setPreviewMode('live')}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            previewMode === 'live' ? 'bg-white text-slate-900' : 'bg-white/15 text-white'
          }`}
        >
          Live Preview
        </button>
        {videoUrl && (
          <button
            onClick={() => setPreviewMode('rendered')}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              previewMode === 'rendered' ? 'bg-white text-slate-900' : 'bg-white/15 text-white'
            }`}
          >
            Rendered Video
          </button>
        )}
      </div>

      {previewMode === 'live' && (
        <div className="absolute right-4 top-4 z-20 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white backdrop-blur">
          Live scene layout preview
        </div>
      )}

      {error && !isLoading && previewMode === 'rendered' && (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-red-400">
          <AlertCircle className="h-8 w-8" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {previewMode === 'rendered' && videoUrl && !isLoading && !error && !hasError && (
        <video
          src={videoUrl}
          controls
          className="h-full w-full"
          onError={() => setHasError(true)}
        />
      )}

      {previewMode === 'rendered' && hasError && videoUrl && !isLoading && (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-white/50">
          <AlertCircle className="h-8 w-8" />
          <span>Rendered video failed to load</span>
          <button onClick={() => setHasError(false)} className="text-xs text-purple-400 hover:text-purple-300">
            Try again
          </button>
        </div>
      )}

      {previewMode === 'live' && (
        <>
          {currentScene ? (
            <div className="relative h-full w-full">
              <img
                src={currentScene.imageUrl}
                alt={`Preview for scene ${activeSceneIndex + 1}`}
                className="h-full w-full object-cover"
                onError={(event) => {
                  (event.target as HTMLImageElement).src = FALLBACK_SCENE_IMAGE;
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/30" />
              <div className="absolute left-5 top-5 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                Scene {activeSceneIndex + 1} of {safeScenes.length}
              </div>
              {currentScene.textOverlay && (
                <div className={`absolute left-6 right-6 text-center ${isVertical ? 'top-8' : 'top-10'}`}>
                  <div className="inline-flex rounded-2xl bg-black/45 px-5 py-3 text-lg font-semibold text-white backdrop-blur">
                    {currentScene.textOverlay}
                  </div>
                </div>
              )}
              <div className={`absolute inset-x-0 ${isVertical ? 'top-1/2 -translate-y-1/2 px-5' : 'bottom-0 p-6'}`}>
                <div className="rounded-2xl bg-black/45 p-4 text-white backdrop-blur">
                  <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-[0.25em] text-white/60">
                    <span>Live Scene Preview</span>
                    <span>{currentScene.duration}s</span>
                  </div>
                  <p className="text-sm text-white/90">
                    {currentScene.narration?.trim() || 'Add narration to hear voice preview and shape the story arc.'}
                  </p>
                  <p className="mt-2 text-xs text-white/65">
                    Use this mode to review layout, pacing, and overlay placement before running a full render.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-white/60">
              <Sparkles className="h-10 w-10" />
              <div className="text-lg font-medium">No scenes to preview</div>
              <div className="text-sm text-white/40">Add a scene to start building your ad.</div>
            </div>
          )}

          {safeScenes.length > 0 && (
            <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 to-transparent p-4">
              <div className="mb-3 flex items-center gap-3">
                <button
                  onClick={() => {
                    if (elapsedSeconds >= totalDuration) {
                      setElapsedSeconds(0);
                    }
                    setIsPlaying((value) => !value);
                  }}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-900"
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <div className="flex-1">
                  <div className="mb-1 flex items-center justify-between text-xs text-white/70">
                    <span>{elapsedSeconds.toFixed(1)}s</span>
                    <span>{totalDuration.toFixed(1)}s</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/15">
                    <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500" style={{ width: `${progress}%` }} />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(totalDuration, 0.1)}
                    step={0.1}
                    value={Math.min(elapsedSeconds, totalDuration)}
                    onChange={(event) => {
                      setIsPlaying(false);
                      setElapsedSeconds(parseFloat(event.target.value));
                    }}
                    className="mt-2 w-full accent-purple-500"
                  />
                </div>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {safeScenes.map((scene, index) => (
                  <button
                    key={scene.id}
                    onClick={() => {
                      setIsPlaying(false);
                      jumpToScene(index);
                    }}
                    className={`min-w-[112px] rounded-xl border px-3 py-2 text-left text-xs ${
                      index === activeSceneIndex
                        ? 'border-purple-400 bg-purple-500/30 text-white'
                        : 'border-white/10 bg-white/10 text-white/80'
                    }`}
                  >
                    <div className="font-semibold">Scene {index + 1}</div>
                    <div className="mt-1 truncate text-[11px] text-white/60">
                      {scene.textOverlay || scene.narration || 'No text yet'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
