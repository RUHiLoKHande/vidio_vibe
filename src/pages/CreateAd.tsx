import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { v4 as uuidv4 } from "uuid";
import { ArrowRight, Globe, Sparkles, Video, Check, Loader2, Type, Play, Wand2, FileText, Image, Clock, Layers, FileVideo, Mic, Palette, Zap, Bookmark, Library } from "lucide-react";
import { analyzeWebsite, generateAdScript, generateYouTubeScript, generateReelsScript, generateStoryScript, generateAdCopy, generateAdImage, SUPPORTED_LANGUAGES, type BusinessInfo, type AdScript, type SupportedLanguage } from "../services/gemini";
import { DEFAULT_DIRECTOR_MODE, getPipelineStages } from "../services/pipeline";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ImageAdGenerator } from "./ImageAdGenerator";
import { apiFetch } from "../services/api";
import { getTemplatesForContentType, type StartupTemplate } from "../services/templates";

interface CreateAdProps {
  user: any;
}

interface BrandKit {
  id: string;
  name: string;
  business_name?: string;
  website_url?: string;
  description?: string;
  target_audience?: string;
  services?: string[];
  brandColors?: string[];
  preferred_language?: SupportedLanguage;
  preferred_voice?: string;
  preferred_tone?: string;
}

type Step = "url" | "analyze" | "script" | "generate" | "copy";
type GenerationMode = "basic" | "realistic";
type ContentType = "ads" | "reels" | "youtube" | "story" | "image-ads";

// Long-form video types
interface Scene {
  id: number;
  narration: string;
  overlay?: string;
  duration: number;
  image_prompt: string;
  video_prompt?: string;
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
}

interface SeoMetadata {
  headline: string;
  metaTitle: string;
  metaDescription: string;
  targetKeywords: string[];
  primaryKeyword: string;
  secondaryKeywords: string[];
  cta: string;
  seoScore: number;
  tone: string;
}

type GenerationStage = "idle" | "script" | "voice" | "visuals" | "rendering" | "complete";

interface ProgressState {
  stage: GenerationStage;
  percentage: number;
  scriptReady: boolean;
  voiceReady: boolean;
  visualsReady: boolean;
  chunksRendered: number;
  totalChunks: number;
  finalVideoReady: boolean;
}

interface UsageLimits {
  maxVideoProjects: number;
  usedVideoProjects: number;
  remainingVideoProjects: number;
}

export function CreateAd({ user }: CreateAdProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contentTypeParam = searchParams.get("type");
  const normalizedContentType = contentTypeParam === "ad" ? "ads" : contentTypeParam;
  
  // Handle image types - redirect to dedicated ImageAdGenerator page
  const contentType = (normalizedContentType === "image" || normalizedContentType === "image-ads") 
    ? "image-ads" 
    : (normalizedContentType as ContentType) || "ads";
  
  // Render ImageAdGenerator directly for image ads - no redirect needed
  if (normalizedContentType === "image" || normalizedContentType === "image-ads") {
    return <ImageAdGenerator user={user} />;
  }
  
  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState("");
  const [topic, setTopic] = useState("");
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo | null>(null);
  const [adScript, setAdScript] = useState<AdScript | null>(null);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [generatedAdId, setGeneratedAdId] = useState<string | null>(null);
  const [duration, setDuration] = useState(contentType === "youtube" ? 60 : contentType === "story" ? 45 : contentType === "reels" ? 15 : contentType === "image-ads" ? 0 : 30);
  const [generationMode, setGenerationMode] = useState<GenerationMode>(contentType === "youtube" || contentType === "story" ? "realistic" : "basic");
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>("english");
  const [directorMode, setDirectorMode] = useState(DEFAULT_DIRECTOR_MODE.enabled);
  const [urlError, setUrlError] = useState("");
  const [brandKits, setBrandKits] = useState<BrandKit[]>([]);
  const [selectedBrandKitId, setSelectedBrandKitId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [brandKitMessage, setBrandKitMessage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageMessage, setPageMessage] = useState<string | null>(null);
  const [usageLimits, setUsageLimits] = useState<UsageLimits | null>(null);
  
  // Reels-specific: Mode selection (Realistic vs Image-based)
  const [reelsMode, setReelsMode] = useState<"realistic" | "image">("image");
  const [youtubeVisualStyle, setYoutubeVisualStyle] = useState<"realistic" | "cartoon" | "anime">("realistic");
  const [storyGenre, setStoryGenre] = useState<"cinematic" | "motivational" | "emotional" | "suspense" | "kids">("cinematic");
  const [storyMood, setStoryMood] = useState<"hopeful" | "dramatic" | "inspiring" | "mysterious" | "heartwarming">("dramatic");
  const [storyVisualStyle, setStoryVisualStyle] = useState<"realistic" | "stylized" | "dreamy">("realistic");
  const [storyCharacterName, setStoryCharacterName] = useState("");
  const [storyCharacterLook, setStoryCharacterLook] = useState("");
  const [storySupportingCharacters, setStorySupportingCharacters] = useState("");
  const [storyVoiceType, setStoryVoiceType] = useState<"storyteller" | "calm" | "female" | "male" | "energetic">("storyteller");
  const [storySubtitleStyle, setStorySubtitleStyle] = useState<"cinematic" | "clean" | "bold">("cinematic");
  const [storyTransitionStyle, setStoryTransitionStyle] = useState<"cinematic-cut" | "fade" | "slide">("cinematic-cut");

  // Long-form video: Duration in minutes (for YouTube 1-30 min)
  const [videoDurationMinutes, setVideoDurationMinutes] = useState(1);
  const [estimatedScenes, setEstimatedScenes] = useState(5);
  const [estimatedChunks, setEstimatedChunks] = useState(1);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);

  // Progress tracking for long-form generation
  const [progress, setProgress] = useState<ProgressState>({
    stage: "idle",
    percentage: 0,
    scriptReady: false,
    voiceReady: false,
    visualsReady: false,
    chunksRendered: 0,
    totalChunks: 1,
    finalVideoReady: false
  });
  const pipelineStages = getPipelineStages();
  const templates = getTemplatesForContentType(contentType);
  const seoMetadata = (adScript as any)?.seoMetadata as SeoMetadata | undefined;

  // Get config based on content type
  const getContentConfig = () => {
    switch (contentType) {
      case "reels":
        return {
          title: "Create a Reel",
          subtitle: "Enter your reel idea and we'll generate an engaging short video",
          inputPlaceholder: "e.g., Top 5 AI tools, Motivational content, Day in the life...",
          icon: Video,
          minDuration: 15,
          maxDuration: 60,
          defaultDuration: 15
        };
      case "youtube":
        return {
          title: "Create a YouTube Video",
          subtitle: "Enter your video topic and we'll generate a complete video",
          inputPlaceholder: "e.g., How to use AI for business growth",
          icon: Play
        };
      case "story":
        return {
          title: "Create a Story Video",
          subtitle: "Enter a story title or idea and we'll generate a cinematic video with realistic scene visuals",
          inputPlaceholder: "e.g., The day a lost letter changed everything",
          icon: Sparkles
        };
      case "image-ads":
        return {
          title: "Create an Image Ad",
          subtitle: "Enter your product or idea and we'll generate a stunning ad image",
          inputPlaceholder: "e.g., AI-powered productivity app, Organic coffee brand...",
          icon: Image
        };
      default:
        return {
          title: "Create an Ad",
          subtitle: "Enter your website URL and we'll generate a professional video ad",
          inputPlaceholder: "https://yourwebsite.com",
          icon: Globe
        };
    }
  };

  const config = getContentConfig();
  const Icon = config.icon;

  const validateUrl = (urlString: string): boolean => {
    try {
      new URL(urlString);
      return true;
    } catch {
      return false;
    }
  };

  // Duration to Scene Mapping Logic for Long-form Videos
  const getSceneCountFromDuration = (minutes: number): number => {
    if (minutes <= 5) return Math.floor(5 + Math.random() * 5); // 5-10
    if (minutes <= 15) return Math.floor(10 + Math.random() * 15); // 10-25
    return Math.floor(25 + Math.random() * 35); // 25-60
  };

  const getChunkCount = (sceneCount: number): number => {
    return Math.ceil(sceneCount / 8); // 8 scenes per chunk
  };

  // Handle duration change for YouTube long-form
  const handleDurationChange = (minutes: number) => {
    setVideoDurationMinutes(minutes);
    const scenes = getSceneCountFromDuration(minutes);
    const chunks = getChunkCount(scenes);
    setEstimatedScenes(scenes);
    setEstimatedChunks(chunks);
    setProgress(prev => ({ ...prev, totalChunks: chunks }));
    // Update duration in seconds for backward compatibility
    setDuration(minutes * 60);
  };

  const AD_DURATION_OPTIONS = [15, 30, 60];
  const setAdDuration = (nextDuration: number) => {
    setDuration(AD_DURATION_OPTIONS.includes(nextDuration) ? nextDuration : 15);
  };

  const getStoryMusicPreset = () => {
    switch (storyMood) {
      case "inspiring":
      case "hopeful":
        return "cinematic";
      case "heartwarming":
        return "chill";
      case "mysterious":
      case "dramatic":
      default:
        return "cinematic";
    }
  };

  const parseSupportingCharacters = (value: string) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  const videoCreationBlocked = contentType !== "image-ads" && Number(usageLimits?.remainingVideoProjects || 0) <= 0;
  const consumeVideoSlot = () => {
    setUsageLimits((current) => {
      if (!current) return current;
      return {
        ...current,
        usedVideoProjects: current.usedVideoProjects + 1,
        remainingVideoProjects: Math.max(0, current.remainingVideoProjects - 1)
      };
    });
  };

  const handleAnalyze = async () => {
    setPageError(null);
    setPageMessage(null);

    if (videoCreationBlocked) {
      setPageError(`You have already used your ${usageLimits?.maxVideoProjects || 2} beta video slots on this account.`);
      return;
    }

    // Validate URL for ads
    if (contentType === "ads") {
      if (!url) {
        setUrlError("Please enter a website URL");
        return;
      }
      if (!validateUrl(url)) {
        setUrlError("Please enter a valid URL (e.g., https://example.com)");
        return;
      }
      setUrlError("");
    } else if (!topic) {
      setPageError("Please enter a topic before continuing.");
      return;
    }

    setLoading(true);
    try {
      if (contentType === "ads") {
        setLoadingText("Analyzing website...");
        const info = await analyzeWebsite(url);
        setBusinessInfo(info);
        setStep("analyze");
      } else if (contentType === "image-ads") {
        // Image Ads - generate ad copy first
        setLoadingText("Generating ad copy...");
        const adCopy = await generateAdCopy(topic, url);
        setAdScript({ ...adCopy, language: selectedLanguage });
        
        // Create business info
        const adInfo: BusinessInfo = {
          name: "Image Ad",
          description: topic,
          targetAudience: "General audience",
          services: []
        };
        setBusinessInfo(adInfo);
        setStep("copy");
      } else if (contentType === "youtube") {
        setLoadingText("Generating YouTube script with AI...");
        
        // Use new YouTube-specific script generation
        const ytScript = await generateYouTubeScript(topic, script, duration, {
          visualStyle: youtubeVisualStyle,
          language: selectedLanguage
        });
        setAdScript(ytScript);
        
        // Create business info for consistency
        const ytInfo: BusinessInfo = {
          name: "YouTube Video",
          description: topic,
          targetAudience: "General YouTube audience",
          services: []
        };
        setBusinessInfo(ytInfo);
        setStep("script");
      } else if (contentType === "story") {
        setLoadingText("Generating cinematic story script with AI...");

        const storyScript = await generateStoryScript(topic, duration, selectedLanguage, {
          genre: storyGenre,
          mood: storyMood,
          visualStyle: storyVisualStyle,
          mainCharacterName: storyCharacterName,
          mainCharacterLook: storyCharacterLook,
          supportingCharacters: parseSupportingCharacters(storySupportingCharacters),
          transitionStyle: storyTransitionStyle,
          recommendedVoice: storyVoiceType
        });
        const enrichedStoryScript = {
          ...storyScript,
          scenes: (storyScript.scenes || []).map((scene, index) => ({
            ...scene,
            transition: scene.transition || storyTransitionStyle,
            characters: Array.isArray(scene.characters) && scene.characters.length > 0
              ? scene.characters
              : [storyCharacterName || 'Main Character', ...parseSupportingCharacters(storySupportingCharacters)].filter(Boolean),
            voice_hint: scene.voice_hint || storyVoiceType,
            title: scene.title || `Scene ${index + 1}`
          })),
          storyProfile: {
            ...(storyScript.storyProfile || {
              premise: topic,
              hook: storyScript.hook,
              conflict: "",
              emotionalPeaks: [],
              ending: storyScript.cta,
              style: `${storyGenre} / ${storyVisualStyle}`,
              musicMood: storyMood
            }),
            style: `${storyGenre} / ${storyVisualStyle}`,
            musicMood: storyMood,
            mainCharacterName: storyCharacterName,
            mainCharacterLook: storyCharacterLook,
            supportingCharacters: parseSupportingCharacters(storySupportingCharacters),
            subtitleStyle: storySubtitleStyle,
            transitionStyle: storyTransitionStyle,
            recommendedVoice: storyVoiceType
          }
        };
        setAdScript(enrichedStoryScript as any);

        const storyInfo: BusinessInfo = {
          name: "Story Video",
          description: topic,
          targetAudience: "General storytelling audience",
          services: []
        };
        setBusinessInfo(storyInfo);
        setGenerationMode("realistic");
        setStep("script");
      } else {
        // Reels - use dedicated reels script generation
        setLoadingText("Generating Reels script with AI...");
        
        // Use the new reels-specific script generation
        const reelsScript = await generateReelsScript(topic, duration, selectedLanguage);
        setAdScript(reelsScript);
        
        // Create business info for consistency (include reelsMode)
        const reelInfo: BusinessInfo = {
          name: "Reel Content",
          description: topic,
          targetAudience: "General Instagram audience",
          services: []
        };
        // Store reelsMode in generationMode
        setGenerationMode(reelsMode as any);
        setBusinessInfo(reelInfo);
        setStep("script");
      }
    } catch (error) {
      console.error(error);
      setPageError("Failed to analyze. Please check your input and try again.");
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  };

  useEffect(() => {
    const loadPageData = async () => {
      try {
        const [brandKitResponse, usageResponse] = await Promise.all([
          apiFetch("/api/brand-kits"),
          apiFetch("/api/usage/summary")
        ]);

        const brandKitData = await brandKitResponse.json();
        if (brandKitResponse.ok && Array.isArray(brandKitData)) {
          setBrandKits(brandKitData);
        }

        const usageData = await usageResponse.json();
        if (usageResponse.ok && usageData?.limits) {
          setUsageLimits(usageData.limits);
        }
      } catch (error) {
        console.warn("[CreateAd] Failed to load create-page data:", error);
      }
    };

    loadPageData();
  }, []);

  const applyTemplate = (template: StartupTemplate) => {
    setTemplateId(template.id);
    setBrandKitMessage(`Applied template: ${template.name}`);

    if (template.suggestedLanguage) {
      setSelectedLanguage(template.suggestedLanguage);
    }

    if (template.suggestedDuration) {
      if (template.contentType === "youtube") {
        const minutes = Math.max(1, Math.round(template.suggestedDuration / 60));
        handleDurationChange(minutes);
      } else {
        setDuration(template.suggestedDuration);
      }
    }

    if (template.suggestedReelsMode) {
      setReelsMode(template.suggestedReelsMode);
    }

    if (template.suggestedVisualStyle) {
      setYoutubeVisualStyle(template.suggestedVisualStyle);
    }

    if (template.suggestedStoryGenre) {
      setStoryGenre(template.suggestedStoryGenre);
    }

    if (template.suggestedStoryMood) {
      setStoryMood(template.suggestedStoryMood);
    }

    if (template.suggestedStoryVisualStyle) {
      setStoryVisualStyle(template.suggestedStoryVisualStyle);
    }

    if (template.contentType === "story" && !storyCharacterName) {
      setStoryCharacterName("Main Character");
    }

    if (contentType === "ads") {
      setUrl("");
    } else {
      setTopic(template.topicPlaceholder);
    }
  };

  const applyBrandKit = (brandKitId: string) => {
    setSelectedBrandKitId(brandKitId);
    const kit = brandKits.find((entry) => entry.id === brandKitId);
    if (!kit) return;

    if (kit.preferred_language) {
      setSelectedLanguage(kit.preferred_language);
    }

    if (kit.website_url) {
      setUrl(kit.website_url);
    }

    if (contentType !== "ads" && kit.business_name) {
      setTopic(kit.business_name);
    }

    if (contentType === "ads") {
      setBusinessInfo((prev) => ({
        name: kit.business_name || prev?.name || "",
        description: kit.description || prev?.description || "",
        targetAudience: kit.target_audience || prev?.targetAudience || "",
        services: kit.services || prev?.services || [],
        brandColors: kit.brandColors || prev?.brandColors || [],
        industry: prev?.industry,
        logo: prev?.logo
      }));
      if (step === "url" && kit.website_url) {
        setUrl(kit.website_url);
      }
    }

    setBrandKitMessage(`Loaded brand kit: ${kit.name}`);
  };

  const handleSaveBrandKit = async () => {
    const sourceName =
      businessInfo?.name?.trim() ||
      topic.trim() ||
      "My Brand Kit";

    const payload = {
      id: selectedBrandKitId || undefined,
      name: sourceName,
      businessName: businessInfo?.name || topic || sourceName,
      websiteUrl: url,
      description: businessInfo?.description || topic,
      targetAudience: businessInfo?.targetAudience || "General audience",
      services: businessInfo?.services || [],
      brandColors: businessInfo?.brandColors || [],
      preferredLanguage: selectedLanguage,
      preferredVoice: "male",
      preferredTone: templateId || generationMode
    };

    try {
      const response = await apiFetch("/api/brand-kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to save brand kit");
      }

      const savedKit = data.brandKit as BrandKit;
      setBrandKits((current) => {
        const filtered = current.filter((kit) => kit.id !== savedKit.id);
        return [savedKit, ...filtered];
      });
      setSelectedBrandKitId(savedKit.id);
      setBrandKitMessage(`Saved brand kit: ${savedKit.name}`);
    } catch (error: any) {
      setBrandKitMessage(error.message || "Failed to save brand kit");
    }
  };

  const handleGenerateScript = async () => {
    if (!businessInfo) return;
    setPageError(null);
    setPageMessage(null);
    if (videoCreationBlocked) {
      setPageError(`You have already used your ${usageLimits?.maxVideoProjects || 2} beta video slots on this account.`);
      return;
    }
    setLoading(true);
    setLoadingText("Generating script...");
    try {
      const script = await generateAdScript(businessInfo, "modern & energetic", duration, selectedLanguage);
      setAdScript(script);
      setStep("script");
    } catch (error) {
      console.error(error);
      setPageError("Failed to generate script.");
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  };

  const handleGenerateImage = async () => {
    if (!adScript) return;

    setPageError(null);
    setPageMessage(null);
    if (contentType !== "image-ads" && videoCreationBlocked) {
      setPageError(`You have already used your ${usageLimits?.maxVideoProjects || 2} beta video slots on this account.`);
      return;
    }
    setLoading(true);
    
    // Handle Image Ads separately - generate image with text overlay
    if (contentType === "image-ads") {
      setLoadingText("Creating ad image with text overlay...");
      try {
        // Get the image prompt from adScript
        const imagePrompt = adScript.visualPrompts?.[0] || adScript.scenes?.[0]?.image_prompt || "Professional advertising image";
        const headline = adScript.hook || adScript.scenes?.[0]?.narration || "";
        const cta = adScript.cta || adScript.scenes?.[0]?.overlay || "";
        
        // Generate ad-style image
        const adImagePrompt = `Professional advertisement image, ${imagePrompt}, clean design, marketing style, high quality, commercial photography`;
        const imageUrl = await generateAdImage(adImagePrompt);
        
        if (imageUrl) {
          const newAdId = uuidv4();
          setGeneratedAdId(newAdId);
          
          // Save to API
          const createResponse = await apiFetch("/api/ads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: newAdId,
              userId: user.id,
              websiteUrl: url,
              businessName: businessInfo?.name,
              script: JSON.stringify(adScript),
              videoUrl: imageUrl,
              status: "completed",
              type: "image",
              duration: 0,
              generationMode: generationMode,
              contentType: contentType
            })
          });

          const createData = await createResponse.json();
          if (!createResponse.ok) {
            throw new Error(createData.error || "Failed to save image ad");
          }
          
          setMediaUrls([imageUrl]);
          setStep("generate");
        }
      } catch (error) {
        console.error(error);
        setPageError("Failed to generate image ad.");
      } finally {
        setLoading(false);
        setLoadingText("");
      }
      return;
    }
    
    // Existing video generation logic
    setLoadingText("Creating visuals...");
    try {
      const scenePrompts = adScript.scenes?.map(scene => 
        `A high-quality cinematic ${contentType === "reels" ? "vertical (9:16)" : "16:9"} ${contentType === "story" ? "storytelling" : "commercial"} content, ${scene.image_prompt}`
      ) || [];
      
      const promptsToUse = scenePrompts.length > 0 ? scenePrompts : adScript.visualPrompts.map(p => 
        `A high-quality ${contentType === "reels" ? "vertical" : "16:9"} ${contentType === "story" ? "cinematic storytelling" : "commercial"} image for ${businessInfo?.name}. ${p}`
      );
      
      // Generate images first
      const generatedImages = await Promise.all(
        promptsToUse.map(prompt => generateAdImage(prompt))
      );
      
      const validImages = generatedImages.filter((img): img is string => img !== undefined);
      
      if (promptsToUse.length > 0) {
        const newAdId = uuidv4();
        setGeneratedAdId(newAdId);
        setStep("generate");
        
        // CRITICAL FIX: Save generated images to local filesystem
        setLoadingText("Saving images...");
        const savedImageUrls: string[] = [];
        
        for (let i = 0; i < promptsToUse.length; i++) {
          try {
            const generatedImage = generatedImages[i];
            if (!generatedImage) {
              console.warn(`[CreateAd] No image generated for scene ${i + 1}, preserving scene with fallback`);
              continue;
            }
            const saveRes = await apiFetch("/api/save-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                adId: newAdId,
                index: i + 1,
                imageUrl: generatedImage
              })
            });
            const saveData = await saveRes.json();
            if (saveData.imageUrl) {
              savedImageUrls.push(saveData.imageUrl);
              console.log(`[CreateAd] Saved image ${i + 1}: ${saveData.imageUrl}`);
            }
          } catch (saveErr) {
            console.error(`[CreateAd] Failed to save image ${i + 1}:`, saveErr);
            // Continue with next image - we'll use fallback in editor
          }
        }
        
        const typeValue = contentType === "ads" ? "video" : contentType;
        
        // Build scenes with local image paths
        const scenes = promptsToUse.map((_, index) => ({
          ...(adScript.scenes?.[index] || {}),
          id: `scene_${index}`,
          imageUrl: savedImageUrls[index] || '',
          image_prompt: adScript.scenes?.[index]?.image_prompt || adScript.scenes?.[index]?.video_prompt || '',
          textOverlay: adScript.scenes?.[index]?.overlay || '',
          narration: adScript.scenes?.[index]?.narration || '',
          duration: adScript.scenes?.[index]?.duration || 3
        }));

        setMediaUrls(scenes.map(scene => scene.imageUrl).filter(Boolean));
        
        // Save ad with local image paths in script
        const createResponse = await apiFetch("/api/ads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: newAdId,
            userId: user.id,
            websiteUrl: url,
            businessName: businessInfo?.name,
            script: JSON.stringify({ ...adScript, scenes }),
            videoUrl: null,
            status: "pending",
            type: typeValue,
            duration: duration,
            generationMode: generationMode,
            contentType: contentType
          })
        });
        
        if (!createResponse.ok) {
          const errorData = await createResponse.json();
          console.error("Failed to create ad:", errorData);
          setPageError("Failed to save ad: " + (errorData.error || "Unknown error"));
          return;
        }

        consumeVideoSlot();
      }
    } catch (error: any) {
      console.error(error);
      setPageError(error?.message || "Failed to generate image.");
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  };

  const handleContinueToEditor = async (adId: string) => {
    const defaultVoiceSettings = {
      voiceType: contentType === "story" ? storyVoiceType : 'male',
      speed: 1
    };
    const defaultMusicSettings = contentType === "story"
      ? { preset: getStoryMusicPreset(), volume: 0.12 }
      : { preset: 'corporate', volume: 0.1 };
    setPageError(null);
    setPageMessage("Opening the editor...");
    if (videoCreationBlocked && (!adId || adId === "new")) {
      setPageError(`You have already used your ${usageLimits?.maxVideoProjects || 2} beta video slots on this account.`);
      return;
    }
    setLoading(true);
    setLoadingText("Opening editor...");

    const seedVoicePreview = async (targetAdId: string, scenes: any[]) => {
      if (!targetAdId || !Array.isArray(scenes) || !scenes.some(scene => scene.narration?.trim())) {
        return;
      }

      try {
        await apiFetch('/api/voice-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adId: targetAdId,
            scenes,
            voiceType: defaultVoiceSettings.voiceType,
            speed: defaultVoiceSettings.speed,
            language: adScript?.language || selectedLanguage
          })
        });
      } catch (voiceSeedError) {
        console.warn('[CreateAd] Failed to pre-generate voice preview:', voiceSeedError);
      }
    };

    // NEW PIPELINE: Don't auto-generate video - go to editor to:
    // 1. Edit script
    // 2. Preview voice
    // 3. Generate images
    // 4. Render video
    if (adId && adId !== "new") {
      const editorScenes = (adScript?.scenes || []).map((s: any, index: number) => ({
        ...s,
        id: `scene_${index}`,
        imageUrl: mediaUrls[index] || '',
        image_prompt: s.image_prompt || '',
        textOverlay: s.overlay || '',
        narration: s.narration || '',
        duration: s.duration || 4,
        transition: s.transition || (contentType === "story" ? storyTransitionStyle : ''),
        characters: Array.isArray(s.characters) && s.characters.length > 0
          ? s.characters
          : (contentType === "story"
            ? [storyCharacterName || 'Main Character', ...parseSupportingCharacters(storySupportingCharacters)].filter(Boolean)
            : [])
      }));

      void seedVoicePreview(adId, editorScenes);
      navigate(`/editor/${adId}`);
      return;
    }
    
    // For "new" or when we need to save first
    if (adScript) {
      try {
        const newAdId = uuidv4();
        
        // NEW PIPELINE: Only save script - NO images yet
        // Images will be generated in Editor after script is finalized
        const scenes = (adScript.scenes || []).map((s: any, index: number) => ({
          ...s,
          id: `scene_${index}`,
          imageUrl: '',  // Will be generated in editor
          image_prompt: s.image_prompt || '',
          textOverlay: s.overlay || '',
          narration: s.narration || '',
          duration: s.duration || 4,
          transition: s.transition || (contentType === "story" ? storyTransitionStyle : ''),
          characters: Array.isArray(s.characters) && s.characters.length > 0
            ? s.characters
            : (contentType === "story"
              ? [storyCharacterName || 'Main Character', ...parseSupportingCharacters(storySupportingCharacters)].filter(Boolean)
              : [])
        }));
        
        const saveResponse = await apiFetch("/api/ads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: newAdId,
            userId: user.id,
            websiteUrl: url,
            businessName: businessInfo?.name,
            script: JSON.stringify({
              ...adScript,
              scenes,
              voiceSettings: defaultVoiceSettings,
              musicSettings: defaultMusicSettings,
              storyProfile: contentType === "story"
                ? {
                    ...(adScript as any)?.storyProfile,
                    mainCharacterName: storyCharacterName,
                    mainCharacterLook: storyCharacterLook,
                    supportingCharacters: parseSupportingCharacters(storySupportingCharacters),
                    subtitleStyle: storySubtitleStyle,
                    musicMood: storyMood,
                    transitionStyle: storyTransitionStyle,
                    recommendedVoice: storyVoiceType
                  }
                : (adScript as any)?.storyProfile
            }),
            videoUrl: null,
            status: "pending",
            type: contentType === "image-ads" ? "image" : (contentType === "ads" ? "video" : contentType),
            duration: duration,
            generationMode: generationMode,
            contentType: contentType
          })
        });
        
        if (!saveResponse.ok) {
          const error = await saveResponse.json();
          console.error("[CreateAd] Failed to save ad:", error);
          setPageError(error.error || "Failed to save ad. Please try again.");
          setLoading(false);
          setLoadingText("");
          return;
        }

        consumeVideoSlot();

        void seedVoicePreview(newAdId, scenes);
        
        // NEW PIPELINE: Go to editor for:
        // 1. Edit script
        // 2. Preview voice  
        // 3. Generate images
        // 4. Render video
        
        navigate(`/editor/${newAdId}`);
      } catch (error: any) {
        console.error("Failed to save ad:", error);
        setPageError(error?.message || "Failed to open the editor. Please try again.");
        setLoading(false);
        setLoadingText("");
      }
    } else {
      setLoading(false);
      setLoadingText("");
      navigate("/dashboard");
    }
  };

  const steps = contentType === "ads" 
    ? ["Website", "Script", "Visuals"]
    : contentType === "image-ads"
    ? ["Product", "Copy", "Image"]
    : ["Topic", "Script", "Visuals"];

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f8fafc_0%,_#ffffff_30%,_#eef2ff_100%)] py-12">
      <div className="mx-auto max-w-3xl px-4">
        
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-purple-100 px-4 py-2 text-sm font-medium text-purple-700">
            <Wand2 className="w-4 h-4" />
            AI-Powered Video Creation
          </div>
          <h1 className="text-4xl font-bold text-slate-800 mb-3">{config.title}</h1>
          <p className="mx-auto max-w-2xl text-lg text-slate-500">{config.subtitle}</p>
        </div>

        {/* Step Indicator */}
        <div className="flex justify-center items-center gap-2 mb-10">
          {steps.map((stepName, i) => {
            const stepIndex = step === "url" ? 0 : step === "analyze" ? 1 : step === "script" || step === "copy" ? 2 : 3;
            const isActive = (step === "url" ? 0 : step === "analyze" ? 1 : step === "script" || step === "copy" ? 2 : 3) === i;
            const isCompleted = stepIndex > i;
            
            return (
              <div key={stepName} className="flex items-center">
                <div className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${
                  isActive ? "bg-purple-600 text-white" : 
                  isCompleted ? "bg-green-500 text-white" : "bg-slate-200 text-slate-500"
                }`}>
                  {isCompleted ? <Check className="w-4 h-4" /> : <span className="w-5 h-5 flex items-center justify-center text-sm font-medium">{i + 1}</span>}
                  <span className="text-sm font-medium">{stepName}</span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`w-8 h-0.5 mx-1 ${isCompleted ? "bg-green-500" : "bg-slate-200"}`} />
                )}
              </div>
            );
          })}
        </div>

        {(pageError || pageMessage) && (
          <div className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${
            pageError
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-purple-200 bg-purple-50 text-purple-700"
          }`}>
            {pageError || pageMessage}
          </div>
        )}

        {usageLimits && contentType !== "image-ads" && (
          <div className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${
            usageLimits.remainingVideoProjects > 0
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}>
            Beta limit: {usageLimits.usedVideoProjects} of {usageLimits.maxVideoProjects} videos used.
            {usageLimits.remainingVideoProjects > 0
              ? ` ${usageLimits.remainingVideoProjects} video slot${usageLimits.remainingVideoProjects === 1 ? "" : "s"} remaining.`
              : " No video slots remaining on this account."}
          </div>
        )}

        {loading && (
          <div className="mb-6 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current Task</div>
                <div className="mt-1 text-sm font-medium text-slate-800">{loadingText || "Processing your request..."}</div>
              </div>
              <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-purple-500 to-pink-500" />
            </div>
          </div>
        )}

        {/* Progress Tracking UI - Only show for long-form YouTube videos */}
        {contentType === "youtube" && videoDurationMinutes > 2 && (
          <div className="mb-8">
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-purple-500" />
                  Generation Progress
                </h3>
                <span className="text-2xl font-bold text-purple-600">{progress.percentage}%</span>
              </div>
              
              {/* Progress Bar */}
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden mb-6">
                <div 
                  className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>

              {/* Stage Indicators */}
              <div className="grid grid-cols-4 gap-2">
                <div className={`p-3 rounded-xl text-center transition-all ${
                  progress.stage === "script" || progress.scriptReady 
                    ? "bg-purple-100 border-2 border-purple-500" 
                    : "bg-slate-50 border-2 border-slate-200"
                }`}>
                  <FileText className={`w-5 h-5 mx-auto mb-1 ${progress.scriptReady ? "text-purple-600" : "text-slate-400"}`} />
                  <span className={`text-xs font-medium ${progress.scriptReady ? "text-purple-700" : "text-slate-500"}`}>Script</span>
                  {progress.scriptReady && <Check className="w-3 h-3 mx-auto mt-1 text-purple-600" />}
                </div>
                
                <div className={`p-3 rounded-xl text-center transition-all ${
                  progress.stage === "voice" || progress.voiceReady 
                    ? "bg-blue-100 border-2 border-blue-500" 
                    : "bg-slate-50 border-2 border-slate-200"
                }`}>
                  <Mic className={`w-5 h-5 mx-auto mb-1 ${progress.voiceReady ? "text-blue-600" : "text-slate-400"}`} />
                  <span className={`text-xs font-medium ${progress.voiceReady ? "text-blue-700" : "text-slate-500"}`}>Voice</span>
                  {progress.voiceReady && <Check className="w-3 h-3 mx-auto mt-1 text-blue-600" />}
                </div>
                
                <div className={`p-3 rounded-xl text-center transition-all ${
                  progress.stage === "visuals" || progress.visualsReady 
                    ? "bg-pink-100 border-2 border-pink-500" 
                    : "bg-slate-50 border-2 border-slate-200"
                }`}>
                  <Palette className={`w-5 h-5 mx-auto mb-1 ${progress.visualsReady ? "text-pink-600" : "text-slate-400"}`} />
                  <span className={`text-xs font-medium ${progress.visualsReady ? "text-pink-700" : "text-slate-500"}`}>Visuals</span>
                  {progress.visualsReady && <Check className="w-3 h-3 mx-auto mt-1 text-pink-600" />}
                </div>
                
                <div className={`p-3 rounded-xl text-center transition-all ${
                  progress.stage === "rendering" || progress.finalVideoReady 
                    ? "bg-green-100 border-2 border-green-500" 
                    : "bg-slate-50 border-2 border-slate-200"
                }`}>
                  <FileVideo className={`w-5 h-5 mx-auto mb-1 ${progress.finalVideoReady ? "text-green-600" : "text-slate-400"}`} />
                  <span className={`text-xs font-medium ${progress.finalVideoReady ? "text-green-700" : "text-slate-500"}`}>Render</span>
                  {progress.finalVideoReady && <Check className="w-3 h-3 mx-auto mt-1 text-green-600" />}
                </div>
              </div>

              {/* Chunk Info Display */}
              {estimatedChunks > 1 && (
                <div className="mt-4 p-4 bg-purple-50 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers className="w-5 h-5 text-purple-600" />
                      <span className="text-sm font-medium text-purple-700">
                        Processing in {estimatedChunks} chunks
                      </span>
                    </div>
                    <div className="text-sm text-purple-600">
                      Chunk {progress.chunksRendered + (progress.stage === "rendering" ? 1 : 0)} of {estimatedChunks}
                    </div>
                  </div>
                  <div className="mt-2 flex gap-1">
                    {Array.from({ length: estimatedChunks }).map((_, i) => (
                      <div 
                        key={i}
                        className={`flex-1 h-2 rounded-full transition-all ${
                          i < progress.chunksRendered 
                            ? "bg-purple-600" 
                            : i === progress.chunksRendered && progress.stage === "rendering"
                            ? "bg-purple-400 animate-pulse"
                            : "bg-purple-200"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {/* STEP 1: INPUT */}
          {step === "url" && (
            <motion.div
              key="url"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden"
            >
              <div className="p-8">
                <div className="mb-6 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Library className="h-4 w-4 text-purple-600" />
                      <h3 className="text-sm font-semibold text-slate-800">Templates</h3>
                    </div>
                    <div className="space-y-2">
                      {templates.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => applyTemplate(template)}
                          className={`w-full rounded-xl border px-3 py-3 text-left transition-all ${
                            templateId === template.id
                              ? "border-purple-500 bg-purple-50"
                              : "border-slate-200 bg-white hover:border-purple-300"
                          }`}
                        >
                          <div className="text-sm font-semibold text-slate-800">{template.name}</div>
                          <div className="mt-1 text-xs text-slate-500">{template.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Bookmark className="h-4 w-4 text-purple-600" />
                      <h3 className="text-sm font-semibold text-slate-800">Brand Kits</h3>
                    </div>
                    <select
                      value={selectedBrandKitId}
                      onChange={(event) => applyBrandKit(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none"
                    >
                      <option value="">Select a saved brand kit</option>
                      {brandKits.map((kit) => (
                        <option key={kit.id} value={kit.id}>
                          {kit.name}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-slate-500">Reuse saved brand details, language preferences, and website information.</p>
                    {brandKitMessage && (
                      <div className="mt-3 rounded-xl border border-purple-200 bg-white px-3 py-2 text-xs text-purple-700">
                        {brandKitMessage}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 mb-6">
                  <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center">
                    <Icon className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-slate-800">
                      {contentType === "ads" ? "Enter Website URL" : contentType === "reels" ? "What's your reel about?" : contentType === "story" ? "What's your story about?" : "What's your video about?"}
                    </h2>
                    <p className="text-slate-500 text-sm">
                      {contentType === "ads" ? "We'll extract content from your website" : contentType === "story" ? "Give us the title or plot idea" : "Tell us the main idea"}
                    </p>
                  </div>
                </div>

                {contentType === "ads" ? (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-purple-800">AI Director Mode</div>
                          <p className="mt-1 text-xs text-purple-600">Auto-optimizes scene pacing, prompt structure, and production flow for faster high-quality output.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDirectorMode((value) => !value)}
                          className={`rounded-full px-3 py-1 text-xs font-bold ${directorMode ? "bg-purple-600 text-white" : "bg-white text-purple-700 border border-purple-300"}`}
                        >
                          {directorMode ? "ON" : "OFF"}
                        </button>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-purple-700">
                        {pipelineStages.slice(1, 5).map((stage) => (
                          <div key={stage.id} className="rounded-lg bg-white/80 px-3 py-2">
                            <div className="font-semibold">{stage.label}</div>
                            <div>{stage.provider}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Website URL</label>
                      <div className="relative">
                        <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input 
                          type="text"
                          placeholder="https://yourwebsite.com"
                          value={url}
                          onChange={(e) => {
                            setUrl(e.target.value);
                            setUrlError("");
                          }}
                          className={`w-full pl-12 pr-4 py-4 rounded-2xl border-2 transition-all text-lg ${
                            urlError 
                              ? "border-red-300 focus:border-red-500 focus:ring-red-100" 
                              : "border-slate-200 focus:border-purple-500 focus:ring-purple-100"
                          } focus:outline-none focus:ring-4`}
                        />
                      </div>
                      {urlError && <p className="text-red-500 text-sm mt-2">{urlError}</p>}
                    </div>
                    <p className="text-slate-400 text-sm flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      We will extract images, branding, and content from your website
                    </p>
                  </div>
                ) : contentType === "image-ads" ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-purple-800">AI Director Mode</div>
                          <p className="mt-1 text-xs text-purple-600">Uses smarter scene planning and cached AI decisions to keep generation fast and consistent.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDirectorMode((value) => !value)}
                          className={`rounded-full px-3 py-1 text-xs font-bold ${directorMode ? "bg-purple-600 text-white" : "bg-white text-purple-700 border border-purple-300"}`}
                        >
                          {directorMode ? "ON" : "OFF"}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Product / Idea *</label>
                      <input 
                        type="text"
                        placeholder={config.inputPlaceholder}
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all text-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Website URL <span className="text-slate-400 font-normal">(optional)</span>
                      </label>
                      <div className="relative">
                        <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input 
                          type="text"
                          placeholder="https://yourwebsite.com (optional)"
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all text-lg"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Select Language</label>
                      <select
                        value={selectedLanguage}
                        onChange={(e) => setSelectedLanguage(e.target.value as SupportedLanguage)}
                        className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all text-lg bg-white"
                      >
                        {SUPPORTED_LANGUAGES.map((language) => (
                          <option key={language.value} value={language.value}>
                            {language.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : contentType === "reels" ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-purple-800">AI Director Mode</div>
                          <p className="mt-1 text-xs text-purple-600">Chooses tight pacing, better scene breakdowns, and production-friendly prompts automatically.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDirectorMode((value) => !value)}
                          className={`rounded-full px-3 py-1 text-xs font-bold ${directorMode ? "bg-purple-600 text-white" : "bg-white text-purple-700 border border-purple-300"}`}
                        >
                          {directorMode ? "ON" : "OFF"}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Your Reel Idea</label>
                      <input 
                        type="text"
                        placeholder={config.inputPlaceholder}
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all text-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Select Language</label>
                      <select
                        value={selectedLanguage}
                        onChange={(e) => setSelectedLanguage(e.target.value as SupportedLanguage)}
                        className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all text-lg bg-white"
                      >
                        {SUPPORTED_LANGUAGES.map((language) => (
                          <option key={language.value} value={language.value}>
                            {language.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    {/* Reels Mode Selector */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Generation Mode</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setReelsMode("realistic")}
                          className={`p-4 rounded-2xl border-2 transition-all ${
                            reelsMode === "realistic" 
                              ? "border-purple-500 bg-purple-50" 
                              : "border-slate-200 hover:border-purple-300"
                          }`}
                        >
                          <div className="text-2xl mb-1">🎬</div>
                          <div className="font-semibold text-sm">Realistic</div>
                          <div className="text-xs text-slate-500">AI Video (Veo 3)</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setReelsMode("image")}
                          className={`p-4 rounded-2xl border-2 transition-all ${
                            reelsMode === "image" 
                              ? "border-purple-500 bg-purple-50" 
                              : "border-slate-200 hover:border-purple-300"
                          }`}
                        >
                          <div className="text-2xl mb-1">🖼️</div>
                          <div className="font-semibold text-sm">Image Mode</div>
                          <div className="text-xs text-slate-500">Slideshow + Effects</div>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-purple-800">AI Director Mode</div>
                          <p className="mt-1 text-xs text-purple-600">Plans structure, pacing, and hybrid generation stages automatically for long-form output.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDirectorMode((value) => !value)}
                          className={`rounded-full px-3 py-1 text-xs font-bold ${directorMode ? "bg-purple-600 text-white" : "bg-white text-purple-700 border border-purple-300"}`}
                        >
                          {directorMode ? "ON" : "OFF"}
                        </button>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-purple-700">
                        {pipelineStages.map((stage) => (
                          <div key={stage.id} className="rounded-lg bg-white/80 px-3 py-2">
                            <div className="font-semibold">{stage.label}</div>
                            <div>{stage.provider}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">{contentType === "story" ? "Story Title / Plot *" : "Video Topic *"}</label>
                      <input 
                        type="text"
                        placeholder={config.inputPlaceholder}
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all text-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Select Language</label>
                      <select
                        value={selectedLanguage}
                        onChange={(e) => setSelectedLanguage(e.target.value as SupportedLanguage)}
                        className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all text-lg bg-white"
                      >
                        {SUPPORTED_LANGUAGES.map((language) => (
                          <option key={language.value} value={language.value}>
                            {language.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {contentType === "story" && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Main Character</label>
                          <input
                            type="text"
                            placeholder="e.g., Aarav, a determined delivery boy"
                            value={storyCharacterName}
                            onChange={(e) => setStoryCharacterName(e.target.value)}
                            className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all text-lg"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Character Look / Identity</label>
                          <input
                            type="text"
                            placeholder="e.g., late 20s, blue shirt, tired eyes, hopeful expression"
                            value={storyCharacterLook}
                            onChange={(e) => setStoryCharacterLook(e.target.value)}
                            className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all text-lg"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Supporting Characters</label>
                          <input
                            type="text"
                            placeholder="e.g., old postman, curious child, best friend"
                            value={storySupportingCharacters}
                            onChange={(e) => setStorySupportingCharacters(e.target.value)}
                            className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all text-lg"
                          />
                          <p className="mt-2 text-xs text-slate-500">Use commas to add multiple supporting characters and keep them consistent in every scene.</p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Story Genre</label>
                          <div className="grid grid-cols-2 gap-2">
                            {([
                              { value: "cinematic", label: "Cinematic" },
                              { value: "motivational", label: "Motivational" },
                              { value: "emotional", label: "Emotional" },
                              { value: "suspense", label: "Suspense" },
                              { value: "kids", label: "Kids" }
                            ] as const).map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setStoryGenre(option.value)}
                                className={`rounded-xl border px-3 py-3 text-sm font-semibold transition-all ${
                                  storyGenre === option.value
                                    ? "border-purple-600 bg-purple-50 text-purple-700"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-purple-300"
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Story Mood</label>
                          <div className="grid grid-cols-2 gap-2">
                            {([
                              { value: "dramatic", label: "Dramatic" },
                              { value: "inspiring", label: "Inspiring" },
                              { value: "hopeful", label: "Hopeful" },
                              { value: "mysterious", label: "Mysterious" },
                              { value: "heartwarming", label: "Heartwarming" }
                            ] as const).map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setStoryMood(option.value)}
                                className={`rounded-xl border px-3 py-3 text-sm font-semibold transition-all ${
                                  storyMood === option.value
                                    ? "border-purple-600 bg-purple-50 text-purple-700"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-purple-300"
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Visual Style</label>
                          <div className="grid grid-cols-3 gap-2">
                            {([
                              { value: "realistic", label: "Realistic" },
                              { value: "stylized", label: "Stylized" },
                              { value: "dreamy", label: "Dreamy" }
                            ] as const).map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setStoryVisualStyle(option.value)}
                                className={`rounded-xl border px-3 py-3 text-sm font-semibold transition-all ${
                                  storyVisualStyle === option.value
                                    ? "border-purple-600 bg-purple-50 text-purple-700"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-purple-300"
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Scene Transitions</label>
                          <div className="grid grid-cols-3 gap-2">
                            {([
                              { value: "cinematic-cut", label: "Cinematic Cut" },
                              { value: "fade", label: "Fade" },
                              { value: "slide", label: "Slide" }
                            ] as const).map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setStoryTransitionStyle(option.value)}
                                className={`rounded-xl border px-3 py-3 text-sm font-semibold transition-all ${
                                  storyTransitionStyle === option.value
                                    ? "border-purple-600 bg-purple-50 text-purple-700"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-purple-300"
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Narration Voice</label>
                          <div className="grid grid-cols-2 gap-2">
                            {([
                              { value: "storyteller", label: "Storyteller" },
                              { value: "calm", label: "Calm" },
                              { value: "female", label: "Female" },
                              { value: "male", label: "Male" },
                              { value: "energetic", label: "Energetic" }
                            ] as const).map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setStoryVoiceType(option.value)}
                                className={`rounded-xl border px-3 py-3 text-sm font-semibold transition-all ${
                                  storyVoiceType === option.value
                                    ? "border-purple-600 bg-purple-50 text-purple-700"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-purple-300"
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Subtitle Style</label>
                          <div className="grid grid-cols-3 gap-2">
                            {([
                              { value: "cinematic", label: "Cinematic" },
                              { value: "clean", label: "Clean" },
                              { value: "bold", label: "Bold" }
                            ] as const).map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setStorySubtitleStyle(option.value)}
                                className={`rounded-xl border px-3 py-3 text-sm font-semibold transition-all ${
                                  storySubtitleStyle === option.value
                                    ? "border-purple-600 bg-purple-50 text-purple-700"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-purple-300"
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    {/* Duration Selector for Story / YouTube */}
                    {(contentType === "youtube" || contentType === "story") && (
                      <div className="space-y-4">
                        <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          {contentType === "story" ? "Story Duration" : "Video Duration"}
                          {contentType === "youtube" && videoDurationMinutes > 2 && (
                            <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">
                              Long-form Mode
                            </span>
                          )}
                        </label>
                        
                        {/* Duration Presets */}
                        <div className={`grid gap-2 mb-3 ${contentType === "story" ? "grid-cols-5" : "grid-cols-6"}`}>
                          {(contentType === "story" ? [30, 45, 60, 75, 90] : [1, 5, 10, 15, 20, 30]).map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => contentType === "story" ? setDuration(value) : handleDurationChange(value)}
                              className={`p-3 rounded-xl border-2 transition-all text-center ${
                                (contentType === "story" ? duration === value : videoDurationMinutes === value)
                                  ? "border-purple-500 bg-purple-50"
                                  : "border-slate-200 hover:border-purple-300"
                              }`}
                            >
                              <div className="text-lg font-bold text-slate-800">{value}</div>
                              <div className="text-xs text-slate-500">{contentType === "story" ? "sec" : "min"}</div>
                            </button>
                          ))}
                        </div>

                        {/* Scene/Chunk Info */}
                        {contentType === "youtube" && videoDurationMinutes > 2 && (
                          <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border border-purple-200">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div className="text-center">
                                  <div className="text-2xl font-bold text-purple-600">{estimatedScenes}</div>
                                  <div className="text-xs text-slate-500">Scenes</div>
                                </div>
                                <div className="w-px h-8 bg-purple-200" />
                                <div className="text-center">
                                  <div className="text-2xl font-bold text-pink-600">{estimatedChunks}</div>
                                  <div className="text-xs text-slate-500">Chunks</div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm text-slate-600">
                                  ~{Math.ceil(videoDurationMinutes * 1.5)} min processing
                                </div>
                                <div className="text-xs text-slate-400">
                                  {videoDurationMinutes > 15 ? 'High quality render' : 'Standard render'}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {contentType === "youtube" && (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Visual Story Style</label>
                          <div className="grid grid-cols-3 gap-2">
                            {([
                              { value: "realistic", label: "Realistic" },
                              { value: "cartoon", label: "Cartoon" },
                              { value: "anime", label: "Anime" }
                            ] as const).map((styleOption) => (
                              <button
                                key={styleOption.value}
                                type="button"
                                onClick={() => setYoutubeVisualStyle(styleOption.value)}
                                className={`rounded-xl border px-3 py-3 text-sm font-semibold transition-all ${
                                  youtubeVisualStyle === styleOption.value
                                    ? "border-purple-600 bg-purple-50 text-purple-700"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-purple-300"
                                }`}
                              >
                                {styleOption.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        )}
                      </div>
                    )}

                    {contentType !== "story" && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Custom Script (Optional)
                        <span className="text-slate-400 font-normal ml-2">Leave empty to auto-generate with AI</span>
                      </label>
                      <textarea 
                        placeholder="Enter your own script here..."
                        value={script}
                        onChange={(e) => setScript(e.target.value)}
                        className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all text-lg h-32 resize-none"
                      />
                    </div>
                    )}
                  </div>
                )}

                <button
                  onClick={handleAnalyze}
                  disabled={loading || (contentType === "ads" ? !url : contentType === "image-ads" ? !topic : !topic) || videoCreationBlocked}
                  className="w-full mt-6 bg-gradient-to-r from-purple-600 to-pink-600 text-white py-4 rounded-2xl font-semibold hover:shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {loadingText || "Processing..."}
                    </>
                  ) : (
                    <>
                      {contentType === "ads" ? "Analyze Website" : contentType === "reels" ? "Generate Reel" : contentType === "story" ? "Generate Story" : contentType === "image-ads" ? "Generate Ad" : "Generate Video"}
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 2: ANALYZE (only for Ads) */}
          {step === "analyze" && businessInfo && (
            <motion.div
              key="analyze"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center">
                    <Sparkles className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-slate-800">Review & Customize</h2>
                    <p className="text-slate-500 text-sm">We found this information from your website</p>
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Select Language</label>
                    <select
                      value={selectedLanguage}
                      onChange={(e) => setSelectedLanguage(e.target.value as SupportedLanguage)}
                      className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all bg-white"
                    >
                      {SUPPORTED_LANGUAGES.map((language) => (
                        <option key={language.value} value={language.value}>
                          {language.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Business Name</label>
                    <input 
                      value={businessInfo.name}
                      onChange={(e) => setBusinessInfo(prev => prev ? {...prev, name: e.target.value} : prev)}
                      className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Description</label>
                    <textarea
                      value={businessInfo.description}
                      onChange={(e) => setBusinessInfo(prev => prev ? {...prev, description: e.target.value} : prev)}
                      className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all h-28 resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Video Duration: <span className="text-purple-600 font-bold">{duration} seconds</span>
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {AD_DURATION_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setAdDuration(option)}
                          className={`rounded-xl border px-3 py-3 text-sm font-semibold transition-all ${
                            duration === option
                              ? 'border-purple-600 bg-purple-50 text-purple-700'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-purple-300'
                          }`}
                        >
                          {option}s
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleGenerateScript}
                  disabled={loading || videoCreationBlocked}
                  className="w-full mt-6 bg-gradient-to-r from-purple-600 to-pink-600 text-white py-4 rounded-2xl font-semibold hover:shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {loadingText || "Generating Script..."}
                    </>
                  ) : (
                    <>
                      <Type className="w-5 h-5" />
                      Generate Script with AI
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleSaveBrandKit}
                  className="mt-3 w-full rounded-2xl border border-slate-200 bg-white py-3 text-sm font-medium text-slate-700 transition-all hover:border-purple-300 hover:text-purple-700"
                >
                  Save These Details As Brand Kit
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 3: SCRIPT */}
          {step === "script" && adScript && (
            <motion.div
              key="script"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center">
                    <Type className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-slate-800">Your Script is Ready</h2>
                    <p className="text-slate-500 text-sm">Here's what we'll create in your video</p>
                  </div>
                </div>

                <div className="space-y-3 max-h-80 overflow-y-auto mb-6">
                  {/* Chunk Info Header for Long-form Videos */}
                  {contentType === "youtube" && videoDurationMinutes > 2 && adScript.scenes && adScript.scenes.length > 8 && (
                    <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-2xl border border-purple-200 mb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Layers className="w-5 h-5 text-purple-600" />
                          <span className="font-semibold text-purple-800">Long-form Video Structure</span>
                        </div>
                        <div className="text-sm text-purple-600">
                          {adScript.scenes.length} scenes → {getChunkCount(adScript.scenes.length)} chunks
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        Video will be processed in chunks of ~8 scenes for optimal quality
                      </div>
                    </div>
                  )}
                  
                  {adScript.scenes?.map((scene, i) => (
                    <div key={i} className="p-4 bg-purple-50 rounded-2xl">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-purple-600 uppercase tracking-wide">
                          Scene {i + 1}
                          {/* Show chunk indicator for long-form videos */}
                          {contentType === "youtube" && videoDurationMinutes > 2 && (
                            <span className="ml-2 text-xs bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full">
                              Chunk {Math.floor(i / 8) + 1}
                            </span>
                          )}
                        </span>
                        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">{scene.duration}s</span>
                      </div>
                      {scene.title && (
                        <p className="text-sm font-semibold text-slate-800 mb-1">{scene.title}</p>
                      )}
                      {scene.storyBeat && (
                        <p className="text-[11px] font-medium uppercase tracking-wide text-pink-600 mb-2">{scene.storyBeat}</p>
                      )}
                      <p className="text-sm text-slate-700 mb-2">{scene.narration}</p>
                      {scene.visual_description && (
                        <p className="text-xs text-slate-500 mb-1">{scene.visual_description}</p>
                      )}
                      <p className="text-xs text-slate-400">{scene.image_prompt}</p>
                    </div>
                  ))}
                </div>

                {contentType === "youtube" && adScript.youtubeMetadata && (
                  <div className="mb-6 rounded-2xl border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-4">
                    <h3 className="mb-3 font-semibold text-slate-800">YouTube Optimization</h3>
                    <div className="space-y-2 text-sm text-slate-700">
                      <p><span className="font-semibold">Title:</span> {adScript.youtubeMetadata.title}</p>
                      <p><span className="font-semibold">Description:</span> {adScript.youtubeMetadata.description}</p>
                      <p><span className="font-semibold">Tags:</span> {adScript.youtubeMetadata.tags.join(', ')}</p>
                      <p><span className="font-semibold">Thumbnail Prompt:</span> {adScript.youtubeMetadata.thumbnailPrompt}</p>
                    </div>
                  </div>
                )}

                {seoMetadata && (
                  <div className="mb-6 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="font-semibold text-slate-800">SEO & Conversion Package</h3>
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                        SEO Score: {seoMetadata.seoScore}/100
                      </span>
                    </div>
                    <div className="space-y-2 text-sm text-slate-700">
                      <p><span className="font-semibold">Headline:</span> {seoMetadata.headline}</p>
                      <p><span className="font-semibold">Meta Title:</span> {seoMetadata.metaTitle}</p>
                      <p><span className="font-semibold">Meta Description:</span> {seoMetadata.metaDescription}</p>
                      <p><span className="font-semibold">Primary Keyword:</span> {seoMetadata.primaryKeyword}</p>
                      <p><span className="font-semibold">Target Keywords:</span> {seoMetadata.targetKeywords.join(', ')}</p>
                      <p><span className="font-semibold">Tone:</span> {seoMetadata.tone}</p>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <button 
                    onClick={() => setStep("url")}
                    className="flex-1 py-4 rounded-2xl font-medium border-2 border-slate-200 hover:bg-slate-50 transition-all"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleGenerateImage}
                    disabled={loading || videoCreationBlocked}
                    className="flex-[2] bg-gradient-to-r from-purple-600 to-pink-600 text-white py-4 rounded-2xl font-semibold hover:shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {loadingText || "Creating..."}
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-5 h-5" />
                        Create Video Visuals
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* STEP 3: COPY (Image Ads) */}
          {step === "copy" && adScript && (
            <motion.div
              key="copy"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center">
                    <Type className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-slate-800">Your Ad Copy is Ready</h2>
                    <p className="text-slate-500 text-sm">Here's your advertising copy</p>
                  </div>
                </div>

                <div className="space-y-4 mb-6">
                  <div className="p-4 bg-purple-50 rounded-2xl">
                    <span className="text-xs font-bold text-purple-600 uppercase tracking-wide">Headline</span>
                    <p className="text-lg font-semibold text-slate-800 mt-1">{adScript.hook}</p>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-2xl">
                    <span className="text-xs font-bold text-purple-600 uppercase tracking-wide">Subtext</span>
                    <p className="text-slate-700 mt-1">{adScript.body}</p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-2xl">
                    <span className="text-xs font-bold text-green-600 uppercase tracking-wide">Call to Action</span>
                    <p className="text-lg font-semibold text-green-800 mt-1">{adScript.cta}</p>
                  </div>
                </div>

                {seoMetadata && (
                  <div className="mb-6 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="font-semibold text-slate-800">SEO & Conversion Package</h3>
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                        SEO Score: {seoMetadata.seoScore}/100
                      </span>
                    </div>
                    <div className="space-y-2 text-sm text-slate-700">
                      <p><span className="font-semibold">Meta Title:</span> {seoMetadata.metaTitle}</p>
                      <p><span className="font-semibold">Meta Description:</span> {seoMetadata.metaDescription}</p>
                      <p><span className="font-semibold">Keywords:</span> {seoMetadata.targetKeywords.join(', ')}</p>
                      <p><span className="font-semibold">Tone:</span> {seoMetadata.tone}</p>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <button 
                    onClick={() => setStep("url")}
                    className="flex-1 py-4 rounded-2xl font-medium border-2 border-slate-200 hover:bg-slate-50 transition-all"
                  >
                    Back
                  </button>
                  <button 
                    onClick={handleGenerateImage}
                    disabled={loading}
                    className="flex-[2] bg-gradient-to-r from-purple-600 to-pink-600 text-white py-4 rounded-2xl font-semibold hover:shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {loadingText || "Creating..."}
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-5 h-5" />
                        Generate Ad Image
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* STEP 4: GENERATE */}
          {step === "generate" && (
            <motion.div
              key="generate"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden"
            >
              <div className="p-8 text-center">
                <div className="w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Check className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">All Set! 🎉</h2>
                  <p className="text-slate-500 mb-4">Your {contentType === "reels" ? "reel" : contentType === "youtube" ? "YouTube video" : contentType === "story" ? "story video" : contentType === "image-ads" ? "image ad" : "ad"} is ready to be created</p>
                
                {/* Chunk Info Summary for Long-form Videos */}
                {contentType === "youtube" && videoDurationMinutes > 2 && (
                  <div className="inline-flex items-center gap-3 px-4 py-2 bg-purple-50 rounded-xl mb-6">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-purple-600" />
                      <span className="text-sm font-medium text-purple-700">{videoDurationMinutes} min video</span>
                    </div>
                    <div className="w-px h-4 bg-purple-300" />
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-pink-600" />
                      <span className="text-sm font-medium text-pink-700">{estimatedChunks} chunks</span>
                    </div>
                  </div>
                )}

                {contentType === "image-ads" && mediaUrls[0] ? (
                  <div className="mb-8">
                    <div className="relative inline-block">
                      <img 
                        src={mediaUrls[0]} 
                        alt="Generated Ad" 
                        className="max-w-full rounded-xl shadow-lg"
                      />
                      {/* Text overlay preview */}
                      <div className="absolute top-4 left-0 right-0 text-center">
                        <span className="bg-black/60 text-white px-4 py-2 rounded-lg font-bold text-lg">
                          {adScript?.hook}
                        </span>
                      </div>
                      <div className="absolute bottom-4 left-0 right-0 text-center">
                        <span className="bg-purple-600 text-white px-6 py-2 rounded-lg font-semibold text-lg">
                          {adScript?.cta}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3 mb-8">
                    {mediaUrls.map((url, i) => (
                      <div key={i} className="aspect-video bg-purple-100 rounded-xl overflow-hidden">
                        <img src={url} alt={`Scene ${i + 1}`} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => handleContinueToEditor(generatedAdId || "new")}
                  disabled={loading || (videoCreationBlocked && (!generatedAdId || generatedAdId === "new"))}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-4 rounded-2xl font-semibold hover:shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {loadingText || "Opening editor..."}
                    </>
                  ) : contentType === "image-ads" ? (
                    <>
                      Download Image
                      <ArrowRight className="w-5 h-5" />
                    </>
                  ) : (
                    <>
                      Continue to Editor
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
