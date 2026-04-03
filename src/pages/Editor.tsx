import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Image, Loader2, RefreshCw, Volume2 } from 'lucide-react';
import { SceneEditor, Scene } from '../editor/sceneEditor';
import { VoiceEditor } from '../editor/voiceEditor';
import { MusicEditor } from '../editor/musicEditor';
import { Timeline } from '../editor/timeline';
import { VideoPreview } from '../editor/videoPreview';
import { VOICE_PRESETS } from '../editor/voicePresets';
import { generateAdImage, getLanguageLabel, SUPPORTED_LANGUAGES, translateSceneDrafts, type SupportedLanguage } from '../services/gemini';
import { apiFetch } from '../services/api';

interface EditorProps {
  user: any;
}

interface VoiceSettings {
  voiceType: string;
  speed: number;
}

interface MusicSettings {
  preset: string;
  volume: number;
  musicPath?: string;
}

type DraftSaveState = 'idle' | 'saving' | 'saved' | 'error';
type EditorTask =
  | 'idle'
  | 'uploading-image'
  | 'regenerating-image'
  | 'uploading-music'
  | 'generating-voice'
  | 'generating-images'
  | 'translating-language'
  | 'rendering-preview'
  | 'exporting-video';

const stripAssetUrl = (value?: string) => (value || '').split('?')[0].split('#')[0];
const isFallbackSceneImage = (value?: string) => stripAssetUrl(value).includes('/uploads/_fallback/');
const isSignedS3Url = (value?: string) => {
  const url = value || '';
  return url.includes('X-Amz-Algorithm=') || url.includes('X-Amz-Signature=');
};
const withRefreshToken = (value?: string) => {
  const url = value || '';
  if (!url) return '';
  if (isSignedS3Url(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
};
const hasUsableSceneImage = (scene: Partial<Scene>) => {
  const imageUrl = stripAssetUrl(scene.imageUrl);
  return Boolean(imageUrl) && !isFallbackSceneImage(imageUrl);
};

const normalizeSceneRecord = (scene: any, index: number): Scene => ({
  id: scene?.id || `scene_${index}`,
  imageUrl: scene?.imageUrl || scene?.image || '',
  imageLocalUrl: scene?.imageLocalUrl || scene?.imageUrl || scene?.image || '',
  imageS3Key: scene?.imageS3Key || scene?.s3Key || scene?.s3?.key || '',
  image_prompt: scene?.image_prompt || scene?.imagePrompt || '',
  textOverlay: scene?.textOverlay || scene?.overlay || '',
  narration: scene?.narration || '',
  duration: Number(scene?.duration) > 0 ? Number(scene.duration) : 3,
  title: scene?.title || '',
  visual_description: scene?.visual_description || '',
  character_actions: scene?.character_actions || '',
  storyBeat: scene?.storyBeat || '',
  emotion: scene?.emotion || '',
  characters: Array.isArray(scene?.characters) ? scene.characters : [],
  transition: scene?.transition || '',
  sound_effects: Array.isArray(scene?.sound_effects) ? scene.sound_effects : [],
  image_variations: Array.isArray(scene?.image_variations) ? scene.image_variations : [],
  voice_hint: scene?.voice_hint || '',
  imageExists: scene?._imageExists === true || hasUsableSceneImage(scene)
});

const buildScenesFromParsedScript = (parsedScript: any): Scene[] => {
  if (Array.isArray(parsedScript?.scenes) && parsedScript.scenes.length > 0) {
    return parsedScript.scenes.map((scene: any, index: number) => normalizeSceneRecord(scene, index));
  }

  if (Array.isArray(parsedScript?.visualPrompts) && parsedScript.visualPrompts.length > 0) {
    const textSegments = [
      parsedScript?.hook,
      parsedScript?.body,
      parsedScript?.cta
    ].filter((segment: any) => typeof segment === 'string' && segment.trim().length > 0);

    return parsedScript.visualPrompts.map((prompt: string, index: number) => ({
      id: `scene_${index}`,
      imageUrl: '',
      image_prompt: prompt || '',
      textOverlay: '',
      narration: textSegments[index] || '',
      duration: Number(parsedScript?.duration) > 0
        ? Number((Number(parsedScript.duration) / Math.max(parsedScript.visualPrompts.length, 1)).toFixed(2))
        : 3,
      imageExists: false
    }));
  }

  return [];
};

const buildSceneVisualPrompt = (scene: Scene, index: number): string => {
  const prompt = scene.image_prompt?.trim();
  if (prompt) return prompt;

  const narration = scene.narration?.trim();
  const overlay = scene.textOverlay?.trim();
  const title = scene.title?.trim();

  return [
    title ? `Scene title: ${title}.` : '',
    narration ? `Create a polished ad visual for: ${narration}.` : `Create a polished ad visual for scene ${index + 1}.`,
    overlay ? `Support this overlay text: ${overlay}.` : '',
    scene.visual_description?.trim() ? `Visual direction: ${scene.visual_description.trim()}.` : '',
    'High-quality commercial composition, clean framing, product-focused, cinematic lighting.'
  ].filter(Boolean).join(' ');
};

const duplicateSceneRecord = (scene: Scene): Scene => ({
  ...scene,
  id: `${scene.id || 'scene'}_${Date.now()}`,
  imageUrl: stripAssetUrl(scene.imageUrl || ''),
  imageLocalUrl: scene.imageLocalUrl || stripAssetUrl(scene.imageUrl || ''),
  imageS3Key: scene.imageS3Key || '',
  imageExists: Boolean(stripAssetUrl(scene.imageUrl || '')) && !isFallbackSceneImage(scene.imageUrl)
});

const serializeSceneDraft = (scene: Scene, index: number) => ({
  id: scene.id || `scene_${index}`,
  title: scene.title || '',
  imageUrl: stripAssetUrl(scene.imageLocalUrl || scene.imageUrl || ''),
  imageS3Key: scene.imageS3Key || '',
  textOverlay: scene.textOverlay || '',
  narration: scene.narration || '',
  duration: Number(scene.duration) > 0 ? Number(scene.duration) : 3,
  image_prompt: scene.image_prompt || '',
  visual_description: scene.visual_description || '',
  character_actions: scene.character_actions || '',
  storyBeat: scene.storyBeat || '',
  emotion: scene.emotion || '',
  characters: Array.isArray(scene.characters) ? scene.characters : [],
  transition: scene.transition || '',
  sound_effects: Array.isArray(scene.sound_effects) ? scene.sound_effects : [],
  image_variations: Array.isArray(scene.image_variations) ? scene.image_variations : [],
  voice_hint: scene.voice_hint || ''
});

export function Editor({ user }: EditorProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<string | undefined>(undefined);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({ voiceType: 'male', speed: 1 });
  const [musicSettings, setMusicSettings] = useState<MusicSettings>({ preset: 'corporate', volume: 0.1 });
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('english');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isStoryProject, setIsStoryProject] = useState(false);
  const [isVerticalContent, setIsVerticalContent] = useState(false);
  const [supportsSelectableVoices, setSupportsSelectableVoices] = useState(true);
  const [voicePreviewProvider, setVoicePreviewProvider] = useState<string | null>(null);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [isChangingLanguage, setIsChangingLanguage] = useState(false);
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<string | null>(null);
  const [voiceConfirmed, setVoiceConfirmed] = useState(false);
  const [visualsStatus, setVisualsStatus] = useState<string | null>(null);
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveState>('idle');
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [editorTask, setEditorTask] = useState<EditorTask>('idle');
  const audioPreviewRef = useRef<HTMLAudioElement>(null);
  const hasLoadedRef = useRef(false);
  const skipNextVoiceResetRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDraftRef = useRef('');

  const scriptReady = scenes.length > 0;
  const imagesReady = scenes.some(hasUsableSceneImage);
  const pipelineState = {
    scriptReady,
    voiceReady: voiceConfirmed,
    imagesReady
  };
  const nextStepLabel = !pipelineState.scriptReady
    ? 'Add or edit scene script first.'
    : !pipelineState.voiceReady
      ? 'Preview the voice and confirm it for this script.'
      : !pipelineState.imagesReady
        ? 'Generate scene images for the current script.'
        : 'Everything is ready. Re-render or export when you are happy.';
  const taskMessageMap: Record<EditorTask, string> = {
    idle: '',
    'uploading-image': 'Uploading the new scene image...',
    'regenerating-image': 'Generating a fresh image for the selected scene...',
    'uploading-music': 'Uploading your custom music track...',
    'generating-voice': `Generating a ${getLanguageLabel(selectedLanguage)} ${isStoryProject ? 'story narration' : 'voice'} preview...`,
    'generating-images': `Generating visuals for ${scenes.length} scene${scenes.length === 1 ? '' : 's'}...`,
    'translating-language': `Translating the script into ${getLanguageLabel(selectedLanguage)}...`,
    'rendering-preview': 'Applying your latest edits and rendering a fresh preview...',
    'exporting-video': 'Rendering and packaging the final video export...'
  };
  const taskMessage = editorTask === 'idle' ? null : taskMessageMap[editorTask];

  const renderBlockReason = !pipelineState.voiceReady
    ? 'Please preview and confirm the voice after your latest script or language changes.'
    : !pipelineState.imagesReady
      ? 'Please generate scene images before rendering the video.'
      : null;

  const buildDraftPayload = () => ({
    scenes: scenes.map((scene, index) => serializeSceneDraft(scene, index)),
    voiceSettings,
    musicSettings,
    language: selectedLanguage,
    websiteUrl
  });

  useEffect(() => {
    const loadAdData = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await apiFetch(`/api/ad/${id}`);
        const data = await res.json();

        if (!res.ok || data.error) {
          setError(data.error || 'Session expired. Please regenerate ad.');
          setLoading(false);
          return;
        }

        if (data.video_url) {
          setVideoUrl(withRefreshToken(data.video_url));
        }

        if (data.voiceover_path) {
          skipNextVoiceResetRef.current = true;
          setVoicePreviewUrl(withRefreshToken(data.voiceover_path));
        }

        if (data.website_url) {
          setWebsiteUrl(data.website_url);
        }

        setIsStoryProject(
          data.type === 'story' ||
          data.contentType === 'story' ||
          Boolean(data.parsedScript?.storyProfile)
        );
        setIsVerticalContent(data.type === 'reels' || data.contentType === 'reels');

        if (typeof data.capabilities?.selectableVoices === 'boolean') {
          setSupportsSelectableVoices(data.capabilities.selectableVoices);
        }

        if (data.parsedScript?.voiceSettings) {
          setVoiceSettings({
            voiceType: typeof data.parsedScript.voiceSettings.voiceType === 'string'
              ? data.parsedScript.voiceSettings.voiceType
              : 'male',
            speed: typeof data.parsedScript.voiceSettings.speed === 'number'
              ? data.parsedScript.voiceSettings.speed
              : 1
          });
        }

        if (data.parsedScript?.musicSettings) {
          setMusicSettings({
            preset: typeof data.parsedScript.musicSettings.preset === 'string'
              ? data.parsedScript.musicSettings.preset
              : 'corporate',
            volume: typeof data.parsedScript.musicSettings.volume === 'number'
              ? data.parsedScript.musicSettings.volume
              : 0.1,
            musicPath: typeof data.parsedScript.musicSettings.musicPath === 'string'
              ? data.parsedScript.musicSettings.musicPath
              : undefined
          });
        }

        if (typeof data.parsedScript?.language === 'string') {
          setSelectedLanguage(data.parsedScript.language as SupportedLanguage);
        }

        const loadedVoiceSettings = data.parsedScript?.voiceSettings
          ? {
              voiceType: typeof data.parsedScript.voiceSettings.voiceType === 'string'
                ? data.parsedScript.voiceSettings.voiceType
                : 'male',
              speed: typeof data.parsedScript.voiceSettings.speed === 'number'
                ? data.parsedScript.voiceSettings.speed
                : 1
            }
          : { voiceType: 'male', speed: 1 };

        const loadedMusicSettings = data.parsedScript?.musicSettings
          ? {
              preset: typeof data.parsedScript.musicSettings.preset === 'string'
                ? data.parsedScript.musicSettings.preset
                : 'corporate',
              volume: typeof data.parsedScript.musicSettings.volume === 'number'
                ? data.parsedScript.musicSettings.volume
                : 0.1,
              musicPath: typeof data.parsedScript.musicSettings.musicPath === 'string'
                ? data.parsedScript.musicSettings.musicPath
                : undefined
            }
          : { preset: 'corporate', volume: 0.1, musicPath: undefined };

        const loadedLanguage =
          typeof data.parsedScript?.language === 'string'
            ? data.parsedScript.language as SupportedLanguage
            : 'english';

        const candidateScenes =
          Array.isArray(data.scenes) && data.scenes.length > 0
            ? data.scenes
            : buildScenesFromParsedScript(data.parsedScript);

        if (candidateScenes.length > 0) {
          const normalizedScenes = candidateScenes.map((scene: any, index: number) =>
            normalizeSceneRecord(scene, index)
          );
          setScenes(normalizedScenes);
          setActiveSceneId(normalizedScenes[0]?.id);
        } else {
          setScenes([]);
          setActiveSceneId(undefined);
        }

        setVoiceConfirmed(false);
        setVoicePreviewProvider(null);
        setIsPlayingPreview(false);
        lastSavedDraftRef.current = JSON.stringify({
          scenes: candidateScenes.map((scene: any, index: number) => serializeSceneDraft(normalizeSceneRecord(scene, index), index)),
          voiceSettings: loadedVoiceSettings,
          musicSettings: loadedMusicSettings,
          language: loadedLanguage,
          websiteUrl: data.website_url || ''
        });
        setDraftSaveState('saved');
        setDraftSavedAt(Date.now());
        hasLoadedRef.current = true;
        setLoading(false);
      } catch (loadError) {
        console.error('Failed to load ad:', loadError);
        setError('Failed to load ad data');
        setLoading(false);
      }
    };

    if (id) {
      loadAdData();
    }
  }, [id]);

  useEffect(() => {
    if (!activeSceneId && scenes[0]?.id) {
      setActiveSceneId(scenes[0].id);
      return;
    }

    if (activeSceneId && !scenes.some(scene => scene.id === activeSceneId)) {
      setActiveSceneId(scenes[0]?.id);
    }
  }, [activeSceneId, scenes]);

  useEffect(() => {
    if (!audioPreviewRef.current) return;
    audioPreviewRef.current.pause();
    audioPreviewRef.current.currentTime = 0;
    audioPreviewRef.current.load();
    setIsPlayingPreview(false);
  }, [voicePreviewUrl]);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    if (skipNextVoiceResetRef.current) {
      skipNextVoiceResetRef.current = false;
      return;
    }
    setVoiceConfirmed(false);
    setVoicePreviewUrl(null);
    setVoicePreviewProvider(null);
    setIsPlayingPreview(false);
    audioPreviewRef.current?.pause();
  }, [
    selectedLanguage,
    voiceSettings.voiceType,
    voiceSettings.speed,
    scenes.map(scene => `${scene.id}:${scene.narration}`).join('|')
  ]);

  useEffect(() => {
    if (!id || !hasLoadedRef.current) return;

    const draftPayload = buildDraftPayload();
    const serializedDraft = JSON.stringify(draftPayload);

    if (serializedDraft === lastSavedDraftRef.current) {
      return;
    }

    setDraftSaveState('saving');

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const response = await apiFetch(`/api/ads/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: serializedDraft
        });
        const data = await response.json();

        if (!response.ok || data.error) {
          throw new Error(data.error || 'Failed to save draft');
        }

        lastSavedDraftRef.current = serializedDraft;
        setDraftSaveState('saved');
        setDraftSavedAt(data.savedAt || Date.now());
      } catch (draftError) {
        console.error('[Editor] Draft autosave failed:', draftError);
        setDraftSaveState('error');
      }
    }, 800);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [id, scenes, voiceSettings, musicSettings, selectedLanguage, websiteUrl]);

  const handleReplaceImage = async (sceneIndex: number) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file || !id) return;

      setSaving(true);
      setEditorTask('uploading-image');
      try {
        const formData = new FormData();
        formData.append('image', file);

        const res = await apiFetch(`/api/ads/${id}/scene-image?sceneIndex=${sceneIndex}`, {
          method: 'POST',
          body: formData
        });

        const data = await res.json();

        if (data.imageUrl) {
          const preferredImageUrl = data?.s3?.signedUrl || data.imageUrl;
          setScenes(currentScenes =>
            currentScenes.map((scene, index) =>
              index === sceneIndex
                ? {
                    ...scene,
                    imageUrl: withRefreshToken(preferredImageUrl),
                    imageLocalUrl: data.imageUrl,
                    imageS3Key: data?.s3?.key || scene.imageS3Key || '',
                    imageExists: true
                  }
                : scene
            )
          );
          setVisualsStatus(`Updated image for scene ${sceneIndex + 1}.`);
          setError(null);
        }
      } catch (uploadError) {
        console.error('Failed to upload image:', uploadError);
        setError('Failed to upload image.');
      } finally {
        setSaving(false);
        setEditorTask('idle');
      }
    };
    input.click();
  };

  const handleRegenerateImage = async (sceneIndex: number) => {
    if (!id || !scenes[sceneIndex]) return;

    const scene = scenes[sceneIndex];
    const prompt =
      scene.image_prompt?.trim() ||
      `Create a polished ad scene for: ${scene.narration || 'marketing advertisement'}. Overlay text: ${scene.textOverlay || 'clean call to action'}.`;

    setRegeneratingSceneId(scene.id);
    setEditorTask('regenerating-image');
    setError(null);

    try {
      const generatedImage = await generateAdImage(prompt);

      if (!generatedImage) {
        throw new Error('No image returned from generator');
      }

      const saveResponse = await apiFetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId: id,
          index: sceneIndex + 1,
          imageUrl: generatedImage
        })
      });

      const saveData = await saveResponse.json();

      if (!saveResponse.ok || !saveData.imageUrl) {
        throw new Error(saveData.error || 'Failed to save regenerated image');
      }

      setScenes(currentScenes =>
        currentScenes.map((item, index) =>
          index === sceneIndex
            ? {
                ...item,
                imageUrl: withRefreshToken(saveData?.s3?.signedUrl || saveData.imageUrl),
                imageLocalUrl: saveData.imageUrl,
                imageS3Key: saveData?.s3?.key || item.imageS3Key || '',
                imageExists: true
              }
            : item
        )
      );
    } catch (regenerationError: any) {
      console.error('[Editor] Failed to regenerate scene image:', regenerationError);
      setError(regenerationError.message || 'Failed to regenerate image');
      setVisualsStatus(null);
    } finally {
      setRegeneratingSceneId(null);
      setEditorTask('idle');
    }
  };

  const handleRemoveImage = (sceneIndex: number) => {
    setScenes((currentScenes) =>
      currentScenes.map((scene, index) =>
        index === sceneIndex
          ? { ...scene, imageUrl: '', imageExists: false }
          : scene
      )
    );
    setVisualsStatus(`Removed image from scene ${sceneIndex + 1}. You can regenerate it or run Generate Images again.`);
    setError(null);
  };

  const handleDuplicateScene = (sceneIndex: number) => {
    setScenes((currentScenes) => {
      const sourceScene = currentScenes[sceneIndex];
      if (!sourceScene) return currentScenes;

      const nextScenes = [...currentScenes];
      const duplicatedScene = duplicateSceneRecord(sourceScene);
      nextScenes.splice(sceneIndex + 1, 0, duplicatedScene);
      setActiveSceneId(duplicatedScene.id);
      return nextScenes;
    });
    setVisualsStatus(`Duplicated scene ${sceneIndex + 1}.`);
    setError(null);
  };

  const handleTimelineDurationAdjust = (sceneId: string, nextDuration: number) => {
    setScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId ? { ...scene, duration: nextDuration } : scene
      )
    );
    setVisualsStatus(`Adjusted scene timing to ${nextDuration}s.`);
  };

  const handleUploadMusic = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file || !id) return;

      setSaving(true);
      setEditorTask('uploading-music');
      try {
        const formData = new FormData();
        formData.append('music', file);

        const res = await apiFetch(`/api/ads/${id}/music`, {
          method: 'POST',
          body: formData
        });

        const data = await res.json();
        if (data.musicUrl) {
          setMusicSettings(current => ({
            ...current,
            preset: 'custom',
            musicPath: data.musicUrl
          }));
          setVisualsStatus('Custom music uploaded successfully.');
        }
      } catch (uploadError) {
        console.error('Failed to upload music:', uploadError);
        setError('Failed to upload music.');
      } finally {
        setSaving(false);
        setEditorTask('idle');
      }
    };
    input.click();
  };

  const handleVoicePreview = async () => {
    if (!id || scenes.length === 0) {
      setError('No scenes available for voice preview.');
      return;
    }

    if (!scenes.some(scene => scene.narration && scene.narration.trim())) {
      setError('Please add narration text to at least one scene first.');
      return;
    }

    setIsGeneratingPreview(true);
    setEditorTask('generating-voice');
    setError(null);
    try {
      const res = await apiFetch('/api/voice-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId: id,
          scenes,
          voiceType: voiceSettings.voiceType,
          speed: voiceSettings.speed,
          language: selectedLanguage
        })
      });

      const data = await res.json();

      if (data.success && data.combinedAudioUrl) {
        const nextVoiceUrl = data?.s3Audio?.signedUrl || data.combinedAudioUrl;
        setVoicePreviewUrl(withRefreshToken(nextVoiceUrl));
        setVoicePreviewProvider(data.provider || null);
        setIsPlayingPreview(false);
        setVoiceConfirmed(false);
        audioPreviewRef.current?.pause();
        setVisualsStatus(`Voice preview refreshed in ${getLanguageLabel(selectedLanguage)}.`);
      } else {
        setError('Failed to generate voice preview: ' + (data.error || 'Unknown error'));
      }
    } catch (previewError) {
      console.error('[Editor] Voice preview failed:', previewError);
      setError('Failed to generate voice preview.');
    } finally {
      setIsGeneratingPreview(false);
      setEditorTask('idle');
    }
  };

  const toggleVoicePreview = () => {
    if (!audioPreviewRef.current) return;

    if (isPlayingPreview) {
      audioPreviewRef.current.pause();
    } else {
      audioPreviewRef.current.play();
    }

    setIsPlayingPreview(value => !value);
  };

  const handleGenerateImages = async () => {
    if (!id || scenes.length === 0) {
      setError('No scenes available to generate visuals from.');
      return;
    }

    const preparedScenes = scenes.map((scene, index) => ({
      ...scene,
      image_prompt: buildSceneVisualPrompt(scene, index)
    }));

    const hasRenderableScene = preparedScenes.some((scene) =>
      scene.image_prompt?.trim() || scene.narration?.trim() || scene.textOverlay?.trim()
    );

    if (!hasRenderableScene) {
      setError('Add narration, overlay text, or an image prompt to at least one scene before generating visuals.');
      return;
    }

    setIsGeneratingImages(true);
    setEditorTask('generating-images');
    setError(null);
    setVisualsStatus(`Generating visuals for ${preparedScenes.length} scene${preparedScenes.length === 1 ? '' : 's'}...`);
    try {
      const res = await apiFetch(`/api/ads/${id}/generate-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenes: preparedScenes })
      });

      const data = await res.json();

      if (data.success && data.images && data.images.length > 0) {
        const fallbackImages = data.images.filter((img: any) => typeof img.imageUrl === 'string' && img.imageUrl.includes('/uploads/_fallback/')).length;
        setScenes(currentScenes =>
          currentScenes.map((scene, index) => {
            const generatedImage = data.images.find((img: any) => img.index === index + 1);
            if (!generatedImage) return scene;
            return {
              ...scene,
              image_prompt: preparedScenes[index]?.image_prompt || scene.image_prompt,
              imageUrl: withRefreshToken(generatedImage?.s3?.signedUrl || generatedImage.imageUrl),
              imageLocalUrl: generatedImage.imageUrl,
              imageS3Key: generatedImage?.s3?.key || scene.imageS3Key || '',
              imageExists: true
            };
          })
        );
        setVisualsStatus(
          fallbackImages > 0
            ? `Generated ${data.images.length} visuals. ${fallbackImages} scene${fallbackImages === 1 ? '' : 's'} used fallback imagery and may need regeneration.`
            : `Generated ${data.images.length} visual${data.images.length === 1 ? '' : 's'} successfully.`
        );
      } else {
        setError(data.error || 'No visuals were generated.');
        setVisualsStatus(null);
      }
    } catch (imageError) {
      console.error('[Editor] Generate images failed:', imageError);
      setError('Failed to generate visuals.');
      setVisualsStatus(null);
    } finally {
      setIsGeneratingImages(false);
      setEditorTask('idle');
    }
  };

  const handleRegeneratePreview = async () => {
    if (!id) return;
    if (renderBlockReason) {
      setError(renderBlockReason);
      setVisualsStatus(renderBlockReason);
      return;
    }

    setSaving(true);
    setEditorTask('rendering-preview');
    setError(null);
    setVisualsStatus('Applying your changes and rendering a fresh preview...');
    try {
      const res = await apiFetch(`/api/ads/${id}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenes, voiceSettings, musicSettings, websiteUrl, language: selectedLanguage })
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else if (data.videoUrl) {
        const nextVideoUrl = data?.s3Video?.signedUrl || data.videoUrl;
        setVideoUrl(withRefreshToken(nextVideoUrl));
        setVisualsStatus('Preview re-rendered successfully.');
      } else {
        setError('Video generation completed but URL was not returned');
      }
    } catch (renderError) {
      console.error('[Editor] Render error:', renderError);
      setError('Failed to regenerate preview');
    } finally {
      setSaving(false);
      setEditorTask('idle');
    }
  };

  const handleExport = async () => {
    if (!id) return;
    if (renderBlockReason) {
      setError(renderBlockReason);
      setVisualsStatus(renderBlockReason);
      return;
    }

    setSaving(true);
    setEditorTask('exporting-video');
    setError(null);
    setVisualsStatus('Exporting your final video. This can take a moment...');
    try {
      const res = await apiFetch(`/api/ads/${id}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenes, voiceSettings, musicSettings, websiteUrl, language: selectedLanguage })
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setVisualsStatus('Video exported successfully.');
        navigate('/dashboard');
      }
    } catch (exportError) {
      console.error('[Editor] Export error:', exportError);
      setError('Failed to export video');
    } finally {
      setSaving(false);
      setEditorTask('idle');
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="mr-2 h-8 w-8 animate-spin" />
        <span>Loading editor...</span>
      </div>
    );
  }

  if (error && !scriptReady) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <div className="text-red-500">Error: {error}</div>
        <button onClick={() => navigate('/dashboard')} className="rounded bg-black px-4 py-2 text-white">
          Back to Dashboard
        </button>
      </div>
    );
  }

  const handleLanguageChange = async (nextLanguage: SupportedLanguage) => {
    if (nextLanguage === selectedLanguage) {
      return;
    }

    const previousLanguage = selectedLanguage;
    setSelectedLanguage(nextLanguage);

    if (!scenes.length) {
      setVisualsStatus(`Language updated to ${getLanguageLabel(nextLanguage)}.`);
      return;
    }

    setIsChangingLanguage(true);
    setEditorTask('translating-language');
    setError(null);
    setVisualsStatus(`Translating script into ${getLanguageLabel(nextLanguage)}...`);

    try {
      const translatedScenes = await translateSceneDrafts(
        scenes.map((scene) => ({
          narration: scene.narration || '',
          overlay: scene.textOverlay || '',
          title: scene.title || '',
          voice_hint: scene.voice_hint || ''
        })),
        nextLanguage
      );

      setScenes((currentScenes) =>
        currentScenes.map((scene, index) => ({
          ...scene,
          narration: translatedScenes[index]?.narration ?? scene.narration,
          textOverlay: translatedScenes[index]?.overlay ?? scene.textOverlay,
          title: translatedScenes[index]?.title ?? scene.title,
          voice_hint: translatedScenes[index]?.voice_hint ?? scene.voice_hint
        }))
      );
      setVisualsStatus(`Script, voice, and render language updated to ${getLanguageLabel(nextLanguage)}.`);
    } catch (translationError) {
      console.error('[Editor] Language translation failed:', translationError);
      setSelectedLanguage(previousLanguage);
      setError(`Failed to translate script to ${getLanguageLabel(nextLanguage)}.`);
      setVisualsStatus(null);
    } finally {
      setIsChangingLanguage(false);
      setEditorTask('idle');
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] p-4 lg:p-5">
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-[1800px] gap-4 lg:gap-5">
      <div className="w-[24%] overflow-y-auto rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
        <SceneEditor
          scenes={scenes}
          onUpdate={setScenes}
          activeSceneId={activeSceneId}
          onSelectScene={setActiveSceneId}
          onReplaceImage={handleReplaceImage}
          onRegenerateImage={handleRegenerateImage}
          onRemoveImage={handleRemoveImage}
          onDuplicateScene={handleDuplicateScene}
          saving={saving || regeneratingSceneId !== null}
        />
      </div>

      <div className="flex flex-1 flex-col gap-4">
        <div className="flex flex-1 flex-col rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-purple-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-700">
                Live editing workspace
              </div>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Video Editor</h2>
              <p className="text-sm text-slate-500">Edit scenes, preview changes instantly, and keep voice, visuals, and timing aligned.</p>
              <p className={`mt-1 text-xs ${
                draftSaveState === 'error'
                  ? 'text-red-500'
                  : draftSaveState === 'saving'
                    ? 'text-amber-600'
                    : 'text-emerald-600'
              }`}>
                {draftSaveState === 'saving'
                  ? 'Saving draft changes...'
                  : draftSaveState === 'error'
                    ? 'Draft save failed. Changes are still available in this session.'
                    : draftSavedAt
                      ? `Draft saved at ${new Date(draftSavedAt).toLocaleTimeString()}`
                      : 'Draft ready'}
              </p>
            </div>
            <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
              <div className="min-w-[190px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Language
                </label>
                <select
                  value={selectedLanguage}
                  onChange={(event) => void handleLanguageChange(event.target.value as SupportedLanguage)}
                  disabled={isChangingLanguage}
                  className="w-full bg-transparent text-sm font-medium text-slate-700 outline-none"
                >
                  {SUPPORTED_LANGUAGES.map((language) => (
                    <option key={language.value} value={language.value}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleRegeneratePreview}
                disabled={saving || isChangingLanguage}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-2 font-bold text-white disabled:opacity-50"
                title={renderBlockReason || ''}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {saving ? 'Applying Changes...' : 'Apply & Re-render'}
              </button>
              <button
                onClick={handleExport}
                disabled={saving || isChangingLanguage}
                className="min-h-[44px] rounded-xl bg-green-600 px-6 py-2 font-bold text-white disabled:opacity-50"
                title={renderBlockReason || ''}
              >
                {saving ? 'Exporting...' : 'Export Final Video'}
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="mb-4 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Next Step</div>
              <div className="mt-2 text-sm font-medium text-slate-800">{nextStepLabel}</div>
              {renderBlockReason && (
                <div className="mt-2 text-xs text-slate-500">{renderBlockReason}</div>
              )}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current Task</div>
              <div className="mt-2 text-sm font-medium text-slate-800">
                {taskMessage || 'No background action running right now.'}
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${
                    taskMessage ? 'w-2/3 animate-pulse bg-gradient-to-r from-blue-500 to-purple-500' : 'w-0 bg-transparent'
                  }`}
                />
              </div>
            </div>
          </div>

          <VideoPreview
            scenes={scenes}
            activeSceneId={activeSceneId}
            onSelectScene={setActiveSceneId}
            videoUrl={videoUrl}
            isLoading={saving}
            error={error}
            isVertical={isVerticalContent}
          />

          <Timeline
            scenes={scenes}
            activeSceneId={activeSceneId}
            onSelectScene={setActiveSceneId}
            onReorder={setScenes}
            onDurationAdjust={handleTimelineDurationAdjust}
          />
        </div>
      </div>

      <div className="w-[24%] space-y-5 overflow-y-auto rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="space-y-2 rounded-[1.2rem] bg-gray-50 p-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-gray-600">Pipeline Status</h4>
          <div className="space-y-1">
            <div className={`flex items-center gap-2 text-sm ${pipelineState.scriptReady ? 'text-green-600' : 'text-gray-400'}`}>
              {pipelineState.scriptReady ? <Check className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border-2" />}
              <span>1. Script Ready</span>
            </div>
            <div className={`flex items-center gap-2 text-sm ${pipelineState.voiceReady ? 'text-green-600' : 'text-gray-400'}`}>
              {pipelineState.voiceReady ? <Check className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border-2" />}
              <span>2. Voice Selected</span>
            </div>
            <div className={`flex items-center gap-2 text-sm ${pipelineState.imagesReady ? 'text-green-600' : 'text-gray-400'}`}>
              {pipelineState.imagesReady ? <Check className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border-2" />}
              <span>3. Images Generated</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="flex items-center gap-2 font-bold">
            <Volume2 className="h-4 w-4" />
            Voice Preview
          </h3>

          <div className="space-y-3 rounded-[1.2rem] bg-purple-50 p-4">
            <p className="text-xs text-purple-600">Preview the exact narration voice before you re-render or export.</p>
            <div className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-purple-700">
              <span>Language: {getLanguageLabel(selectedLanguage)}</span>
              <span>Provider: {voicePreviewProvider === 'elevenlabs' ? 'ElevenLabs' : voicePreviewProvider === 'google' ? 'Google fallback' : 'Not generated yet'}</span>
            </div>
            {voicePreviewProvider === 'google' && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Preview is using Google fallback, so different voice presets may sound similar.
              </div>
            )}
            {!voiceConfirmed && voicePreviewUrl && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                Confirm this preview so the next render uses the same language and voice choice.
              </div>
            )}

            <button
              onClick={handleVoicePreview}
              disabled={isGeneratingPreview || scenes.length === 0}
              className="w-full rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2 font-medium text-white disabled:opacity-50"
            >
              {isGeneratingPreview ? 'Generating...' : 'Preview Voice'}
            </button>

            {voicePreviewUrl && (
              <div className="flex items-center gap-2 rounded bg-white p-2">
                <button onClick={toggleVoicePreview} className="rounded-full bg-purple-100 p-2 hover:bg-purple-200">
                  {isPlayingPreview ? 'Pause' : 'Play'}
                </button>
                <div className="h-2 flex-1 overflow-hidden rounded bg-purple-200">
                  <audio
                    ref={audioPreviewRef}
                    src={voicePreviewUrl}
                    onEnded={() => setIsPlayingPreview(false)}
                    className="hidden"
                  />
                  <div className="h-full bg-purple-500 transition-all" style={{ width: isPlayingPreview ? '100%' : '0%' }} />
                </div>
              </div>
            )}

            {voicePreviewUrl && (
              <button
                onClick={() => {
                  setVoiceConfirmed(true);
                  apiFetch('/api/voice-confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    adId: id,
                    voiceType: voiceSettings.voiceType,
                    speed: voiceSettings.speed,
                    language: selectedLanguage
                  })
                }).catch(confirmError => console.warn('[Editor] Failed to persist voice selection:', confirmError));
                }}
                disabled={voiceConfirmed}
                className={`w-full rounded-lg px-4 py-2 font-medium text-white ${
                  voiceConfirmed ? 'bg-green-500' : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {voiceConfirmed ? 'Voice Selected' : 'Confirm Voice Selection'}
              </button>
            )}
          </div>
        </div>

        <VoiceEditor
          voiceSettings={voiceSettings}
          onUpdate={(nextVoiceSettings) =>
            setVoiceSettings((current) => ({
              voiceType:
                typeof nextVoiceSettings.voiceType === 'string' &&
                VOICE_PRESETS.some((preset) => preset.value === nextVoiceSettings.voiceType)
                  ? nextVoiceSettings.voiceType
                  : current.voiceType,
              speed:
                typeof nextVoiceSettings.speed === 'number'
                  ? nextVoiceSettings.speed
                  : current.speed
            }))
          }
          onRegenerate={handleVoicePreview}
          saving={isGeneratingPreview}
          supportsSelectableVoices={supportsSelectableVoices}
          previewProvider={voicePreviewProvider}
          multipleVoicesEnabled={supportsSelectableVoices}
          storyMode={isStoryProject}
        />

        <div className="border-t pt-4">
          <div className="space-y-4">
            <h3 className="flex items-center gap-2 font-bold">
              <Image className="h-4 w-4" />
              Scene Images
            </h3>

            <div className="space-y-3 rounded-[1.2rem] bg-blue-50 p-4">
              <p className="text-xs text-blue-600">Generate or refresh scene images from the current script and image prompts.</p>
              <div className="rounded-lg bg-white/70 px-3 py-2 text-xs text-blue-700">
                Tip: remove or regenerate only the weak scenes, then run this again when you want a full refresh.
              </div>
              {visualsStatus && (
                <div className="rounded-md border border-blue-200 bg-white px-3 py-2 text-xs text-blue-700">
                  {visualsStatus}
                </div>
              )}

              <button
                onClick={handleGenerateImages}
                disabled={isGeneratingImages || scenes.length === 0}
                className="w-full rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-2 font-medium text-white disabled:opacity-50"
                title={scenes.length === 0 ? 'Please add at least one scene first' : ''}
              >
                {isGeneratingImages ? 'Generating Scene Images...' : 'Generate Scene Images'}
              </button>
            </div>
          </div>
        </div>

        <div className="border-t pt-4" />
        <MusicEditor musicSettings={musicSettings} onUpdate={setMusicSettings} onUploadMusic={handleUploadMusic} saving={saving} />
      </div>
      </div>
    </div>
  );
}
