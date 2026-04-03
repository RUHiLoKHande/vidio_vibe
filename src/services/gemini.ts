import { GoogleGenAI, Type } from "@google/genai";
import axios from "axios";
import { buildAICacheKey, withAICache } from "./aiCache";
import { runWithProviderFallback, type ProviderExecutionMetadata } from "./providerRuntime";

export interface AdCopy {
  headline: string;
  subtext: string;
  cta: string;
  imagePrompt: string;
  language?: SupportedLanguage;
}

// Helper to get fresh AI instance (important for Veo key selection)
function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
}

const SCRIPT_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const IMAGE_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
let lastImageProviderMetadata: ProviderExecutionMetadata | null = null;

export interface BusinessInfo {
  name: string;
  description: string;
  services: string[];
  targetAudience: string;
  logo?: string;
  brandColors?: string[];
  industry?: string;
}

// Brand Style Object - Used for consistent image generation across all scenes
export interface BrandStyle {
  name: string;
  colors: string;
  tone: string;
  industry: string;
  logo?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

// Default brand style fallback
export const DEFAULT_BRAND_STYLE: BrandStyle = {
  name: 'Business',
  colors: 'modern blue gradient',
  tone: 'professional advertising',
  industry: 'general business',
};

export interface Scene {
  scene: number;
  duration: number;
  narration: string;
  overlay: string;
  image_prompt: string;
  video_prompt: string;
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
  brandStyle?: BrandStyle; // Store brand style for consistent image generation
}

export interface SceneTranslationInput {
  narration: string;
  overlay?: string;
  title?: string;
  voice_hint?: string;
}

export interface CharacterProfile {
  name: string;
  role: string;
  face: string;
  clothes: string;
  style: string;
  personality: string;
  voiceHint: string;
}

export interface StoryProfile {
  premise: string;
  hook: string;
  conflict: string;
  emotionalPeaks: string[];
  ending: string;
  style: string;
  musicMood: string;
  mainCharacterName?: string;
  mainCharacterLook?: string;
  supportingCharacters?: string[];
  subtitleStyle?: 'cinematic' | 'clean' | 'bold';
  transitionStyle?: 'cinematic-cut' | 'fade' | 'slide';
  recommendedVoice?: string;
}

export interface YouTubeMetadata {
  title: string;
  description: string;
  tags: string[];
  thumbnailPrompt: string;
}

export interface SeoMetadata {
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

export type SupportedLanguage = 'english' | 'hindi' | 'marathi';

export const SUPPORTED_LANGUAGES: Array<{ value: SupportedLanguage; label: string; ttsCode: string }> = [
  { value: 'english', label: 'English', ttsCode: 'en' },
  { value: 'hindi', label: 'Hindi', ttsCode: 'hi' },
  { value: 'marathi', label: 'Marathi', ttsCode: 'mr' }
];

export function getLanguageLabel(language: SupportedLanguage = 'english'): string {
  return SUPPORTED_LANGUAGES.find((entry) => entry.value === language)?.label || 'English';
}

export function getLanguageTtsCode(language: SupportedLanguage = 'english'): string {
  return SUPPORTED_LANGUAGES.find((entry) => entry.value === language)?.ttsCode || 'en';
}

export async function translateSceneDrafts(
  scenes: SceneTranslationInput[],
  targetLanguage: SupportedLanguage = 'english'
): Promise<SceneTranslationInput[]> {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return [];
  }

  const cacheKey = buildAICacheKey('scene-translation', { scenes, targetLanguage });
  return withAICache(cacheKey, SCRIPT_CACHE_TTL_MS, async () => {
    const ai = getAI();
    const languageLabel = getLanguageLabel(targetLanguage);

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Translate the following advertisement script scenes into ${languageLabel}.

Requirements:
- Keep the meaning, ad intent, and pacing natural for ${languageLabel}.
- Translate narration, overlay, title, and voice_hint into ${languageLabel}.
- Keep each overlay short and punchy like ad text.
- Do not translate or add image prompts.
- Preserve scene order exactly.
- If any text is already in ${languageLabel}, keep it polished but do not change the meaning.

Return JSON only in this format:
{
  "scenes": [
    {
      "narration": "...",
      "overlay": "...",
      "title": "...",
      "voice_hint": "..."
    }
  ]
}

Input scenes:
${JSON.stringify(scenes)}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  narration: { type: Type.STRING },
                  overlay: { type: Type.STRING },
                  title: { type: Type.STRING },
                  voice_hint: { type: Type.STRING }
                },
                required: ["narration", "overlay", "title", "voice_hint"]
              }
            }
          },
          required: ["scenes"]
        }
      }
    });

    const parsed = JSON.parse(response.text);
    const translatedScenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];

    return scenes.map((scene, index) => {
      const translated = translatedScenes[index] || {};
      return {
        narration: typeof translated.narration === 'string' && translated.narration.trim()
          ? translated.narration.trim()
          : scene.narration,
        overlay: typeof translated.overlay === 'string'
          ? translated.overlay.trim()
          : (scene.overlay || ''),
        title: typeof translated.title === 'string'
          ? translated.title.trim()
          : (scene.title || ''),
        voice_hint: typeof translated.voice_hint === 'string'
          ? translated.voice_hint.trim()
          : (scene.voice_hint || '')
      };
    });
  });
}

export interface AdScript {
  hook: string;
  body: string;
  cta: string;
  visualPrompts: string[];
  duration: number;
  scenes: Scene[];
  language?: SupportedLanguage;
  characterProfiles?: CharacterProfile[];
  storyProfile?: StoryProfile;
  youtubeMetadata?: YouTubeMetadata;
  seoMetadata?: SeoMetadata;
}

function buildStoryScenePlan(duration: number) {
  if (duration <= 30) {
    return {
      targetScenes: 5,
      timings: [6, 6, 6, 6, 6],
      beats: ['hook', 'setup', 'conflict', 'turn', 'ending']
    };
  }

  if (duration <= 60) {
    return {
      targetScenes: 7,
      timings: [8, 8, 8, 8, 8, 10, 10],
      beats: ['hook', 'setup', 'character', 'conflict', 'rising stakes', 'emotional peak', 'ending']
    };
  }

  return {
    targetScenes: 9,
    timings: [10, 10, 10, 10, 10, 10, 10, 10, 10],
    beats: ['hook', 'setup', 'character', 'world', 'conflict', 'rising stakes', 'twist', 'emotional peak', 'ending']
  };
}

function createStoryFallback(storyIdea: string, duration: number, language: SupportedLanguage = 'english'): AdScript {
  const storyPlan = buildStoryScenePlan(duration);
  const basePrompt = `cinematic realistic story scene about ${storyIdea}, dramatic lighting, consistent characters, film still quality`;
  const scenes = storyPlan.timings.map((sceneDuration, index) => {
    const beat = storyPlan.beats[index];
    const narration = index === 0
      ? `It started with a moment nobody expected in ${storyIdea}.`
      : index === storyPlan.timings.length - 1
        ? `And that is how the story of ${storyIdea} changed everything.`
        : `The story moves through ${beat} as ${storyIdea} unfolds.`;

    return {
      scene: index + 1,
      duration: sceneDuration,
      narration,
      overlay: beat.toUpperCase(),
      image_prompt: `${basePrompt}, scene ${index + 1}, ${beat}`,
      video_prompt: `${basePrompt}, scene ${index + 1}, ${beat}, subtle cinematic motion`
    };
  });

  return {
    hook: scenes[0]?.narration || storyIdea,
    body: scenes.slice(1, -1).map((scene) => scene.narration).join(' '),
    cta: scenes[scenes.length - 1]?.narration || `Watch the story of ${storyIdea}.`,
    visualPrompts: scenes.map((scene) => scene.image_prompt),
    duration,
    language,
    seoMetadata: normalizeSeoMetadata(null, {
      headline: `${storyIdea} Story Video`,
      metaTitle: `${storyIdea} story video`.slice(0, 60),
      metaDescription: `A cinematic AI-generated story video about ${storyIdea} with realistic scenes and narration.`.slice(0, 160),
      primaryKeyword: storyIdea,
      secondaryKeywords: ['story video', 'cinematic reel', 'ai storytelling'],
      targetKeywords: [storyIdea, `${storyIdea} story`, `${storyIdea} cinematic video`],
      cta: 'Watch the full story',
      seoScore: 84
    }),
    scenes
  };
}

export interface DurationPlan {
  sceneCount: number;
  timings: number[];
  phases: string[];
}

interface YouTubeScenePlan {
  targetScenes: number;
  timings: number[];
  beats: string[];
}

interface YouTubeGenerationOptions {
  visualStyle?: 'realistic' | 'cartoon' | 'anime';
  language?: SupportedLanguage;
}

function buildAdLanguagePrompt(language: SupportedLanguage): string {
  const languageLabel = getLanguageLabel(language);
  return [
    `Generate a high-converting advertisement script in ${languageLabel}.`,
    'Use natural, conversational tone used in ads.',
    'Ensure Hook -> Problem -> Solution -> CTA structure.'
  ].join(' ');
}

function clampSeoTitle(title: string): string {
  return (title || '').trim().slice(0, 60);
}

function clampSeoDescription(description: string): string {
  return (description || '').trim().slice(0, 160);
}

function normalizeSeoMetadata(
  input: any,
  fallback: Partial<SeoMetadata> = {}
): SeoMetadata {
  const headline = (input?.headline || fallback.headline || '').trim();
  const metaTitle = clampSeoTitle(input?.metaTitle || fallback.metaTitle || headline);
  const metaDescription = clampSeoDescription(input?.metaDescription || fallback.metaDescription || '');
  const targetKeywords = Array.isArray(input?.targetKeywords)
    ? input.targetKeywords.map((item: any) => String(item).trim()).filter(Boolean)
    : (fallback.targetKeywords || []);
  const primaryKeyword = (input?.primaryKeyword || fallback.primaryKeyword || targetKeywords[0] || '').trim();
  const secondaryKeywords = Array.isArray(input?.secondaryKeywords)
    ? input.secondaryKeywords.map((item: any) => String(item).trim()).filter(Boolean)
    : (fallback.secondaryKeywords || targetKeywords.slice(1));
  const cta = (input?.cta || fallback.cta || '').trim();
  const seoScore = Math.max(0, Math.min(100, Number(input?.seoScore ?? fallback.seoScore ?? 82) || 82));
  const tone = (input?.tone || fallback.tone || 'Professional, persuasive, human-like').trim();

  return {
    headline,
    metaTitle,
    metaDescription,
    targetKeywords: targetKeywords.length > 0 ? targetKeywords : [primaryKeyword].filter(Boolean),
    primaryKeyword,
    secondaryKeywords,
    cta,
    seoScore,
    tone
  };
}

export function buildDurationPlan(duration: number): DurationPlan {
  if (duration <= 15) {
    return {
      sceneCount: 3,
      timings: [5, 5, 5],
      phases: ['hook', 'solution', 'cta']
    };
  }

  if (duration <= 30) {
    return {
      sceneCount: 5,
      timings: [6, 6, 6, 6, 6],
      phases: ['hook', 'problem', 'solution', 'benefits', 'cta']
    };
  }

  return {
    sceneCount: 7,
    timings: [8, 8, 9, 9, 9, 9, 8],
    phases: ['hook', 'problem', 'problem', 'solution', 'benefits', 'benefits', 'cta']
  };
}

function getWordsForSceneDuration(sceneDuration: number): number {
  return Math.max(8, Math.round(sceneDuration * 2.2));
}

function buildSceneImagePrompt(
  info: BusinessInfo,
  style: string,
  sceneType: string,
  narration: string,
  overlay: string,
  isFinalScene: boolean,
  duration: number
): string {
  const brandColors = info.brandColors?.join(', ') || 'brand colors';
  const services = info.services?.slice(0, 3).join(', ') || 'core offer';
  const audience = info.targetAudience || 'target customers';
  const businessName = info.name || 'the brand';
  const websiteMention = info.logo ? 'subtle branded elements' : 'clear brand-led composition';

  return [
    `Professional ad scene for ${businessName}.`,
    `Scene role: ${sceneType}.`,
    `Narration focus: ${narration}.`,
    `Overlay text: ${overlay}.`,
    `Product/service focus: ${services}.`,
    `Audience: ${audience}.`,
    `Visual style: ${style}, cinematic lighting, premium commercial photography, polished ad composition, consistent ${brandColors} palette, ${websiteMention}.`,
    `Timing fit: designed for a ${duration}-second scene with one clear visual idea.`,
    isFinalScene
      ? `Final CTA scene with strong product focus, conversion-ready composition, clean space for call to action and website URL.`
      : `Single-scene visual that exactly matches the narration, no unrelated objects, no random background storylines.`
  ].join(' ');
}

function buildYouTubeScenePlan(duration: number): YouTubeScenePlan {
  const targetScenes = duration <= 120 ? 6 : duration <= 300 ? 8 : duration <= 900 ? 10 : 12;
  const beatsTemplate =
    targetScenes <= 6
      ? ['hook', 'setup', 'conflict', 'rising stakes', 'emotional peak', 'ending']
      : targetScenes <= 8
        ? ['hook', 'setup', 'conflict', 'investigation', 'rising stakes', 'emotional peak', 'turn', 'ending']
        : ['hook', 'setup', 'conflict', 'complication', 'discovery', 'rising stakes', 'emotional peak', 'twist', 'aftermath', 'ending', 'cta', 'credits'];

  const beats = beatsTemplate.slice(0, targetScenes);
  const baseDuration = Math.floor(duration / targetScenes);
  const timings = beats.map((_, index) => {
    if (index === 0) return Math.min(5, Math.max(4, Math.round(duration * 0.08)));
    if (index === targetScenes - 1) return Math.min(9, Math.max(6, Math.round(duration * 0.1)));
    return Math.max(6, baseDuration);
  });

  const total = timings.reduce((sum, value) => sum + value, 0);
  let adjustment = duration - total;
  let pointer = 1;
  while (adjustment !== 0 && timings.length > 0) {
    const index = pointer % Math.max(timings.length - 1, 1);
    const targetIndex = Math.min(index + 1, timings.length - 2 >= 1 ? timings.length - 2 : 0);
    if (adjustment > 0) {
      timings[targetIndex] += 1;
      adjustment -= 1;
    } else if (timings[targetIndex] > 5) {
      timings[targetIndex] -= 1;
      adjustment += 1;
    } else {
      pointer += 1;
      if (pointer > 50) break;
      continue;
    }
    pointer += 1;
  }

  return { targetScenes, timings, beats };
}

function buildDefaultCharacterProfiles(topic: string, visualStyle: string): CharacterProfile[] {
  const protagonist = topic.split(/\s+/).slice(0, 3).join(' ') || 'Main Host';
  return [
    {
      name: protagonist,
      role: 'protagonist/host',
      face: 'expressive face, memorable eyes, cinematic close-up friendly',
      clothes: visualStyle === 'anime' ? 'stylized signature outfit with bold accent colors' : 'signature jacket or outfit that repeats across scenes',
      style: `${visualStyle} hero design with consistent silhouette`,
      personality: 'curious, emotionally engaging, credible storyteller',
      voiceHint: 'warm storyteller with dynamic pacing'
    },
    {
      name: 'Supporting Presence',
      role: 'mentor, rival, or side character when needed',
      face: 'distinct secondary facial features with strong profile',
      clothes: visualStyle === 'cartoon' ? 'simple stylized supporting costume' : 'supporting wardrobe with muted complementary colors',
      style: `${visualStyle} supporting character`,
      personality: 'grounding, reactive, helps build conflict and contrast',
      voiceHint: 'calm guide or contrast voice'
    }
  ];
}

function buildYouTubeStoryProfile(topic: string, visualStyle: string): StoryProfile {
  return {
    premise: `A cinematic YouTube story about ${topic}.`,
    hook: `Open with a curiosity gap around ${topic} in the first 5 seconds.`,
    conflict: `Introduce tension, uncertainty, or a meaningful challenge around ${topic}.`,
    emotionalPeaks: [
      `A discovery moment that changes how the audience sees ${topic}.`,
      `An emotional or surprising high point that rewards attention.`
    ],
    ending: `Close with a memorable payoff, strong resolution, or twist that feels earned.`,
    style: visualStyle,
    musicMood: visualStyle === 'anime' ? 'dramatic orchestral rise with energetic percussion' : visualStyle === 'cartoon' ? 'playful cinematic rhythm' : 'cinematic tension with emotional lift'
  };
}

function buildYouTubeImagePrompt(
  topic: string,
  visualStyle: string,
  beat: string,
  sceneTitle: string,
  narration: string,
  visualDescription: string,
  characterActions: string,
  characters: string[],
  characterProfiles: CharacterProfile[]
): string {
  const consistentCharacterNotes = characterProfiles
    .map((character) => `${character.name}: ${character.face}, ${character.clothes}, ${character.style}`)
    .join('; ');
  const characterCast = characters.length > 0 ? `Visible characters: ${characters.join(', ')}.` : '';

  return [
    `Cinematic YouTube story frame about ${topic}.`,
    `Scene beat: ${beat}.`,
    `Scene title: ${sceneTitle}.`,
    narration ? `Narration context: ${narration}.` : '',
    visualDescription ? `Visual focus: ${visualDescription}.` : '',
    characterActions ? `Character action: ${characterActions}.` : '',
    characterCast,
    `Keep character continuity across scenes using: ${consistentCharacterNotes}.`,
    `Visual style: ${visualStyle}, cinematic lighting, layered depth, emotional facial expression, story continuity, professional composition, 16:9 landscape frame.`,
    `No random props, no unrelated characters, preserve the same wardrobe and face details scene to scene.`
  ].filter(Boolean).join(' ');
}

function buildYouTubeVideoPrompt(scene: Scene, visualStyle: string): string {
  return [
    scene.image_prompt,
    `Motion direction: ${scene.character_actions || 'subtle cinematic movement that supports the narration'}.`,
    `Transition into next beat with ${scene.transition || 'smooth cinematic dissolve'}.`,
    `Emotion: ${scene.emotion || 'engaging'}.`,
    `Cinematic ${visualStyle} video shot, 16:9, YouTube storytelling quality.`
  ].join(' ');
}

function buildYouTubeThumbnailPrompt(topic: string, storyProfile: StoryProfile, characterProfiles: CharacterProfile[]): string {
  const leadCharacter = characterProfiles[0];
  return [
    `YouTube thumbnail for ${topic}.`,
    `Big emotional expression from ${leadCharacter?.name || 'the protagonist'}.`,
    `Visualize the hook: ${storyProfile.hook}.`,
    `Cinematic lighting, bold contrast, clean background, space for large thumbnail text, 16:9, high click-through design.`
  ].join(' ');
}

export async function analyzeWebsite(url: string): Promise<BusinessInfo> {
  const ai = getAI();
  
  // Extract domain name from URL for better fallback
  let domainName = "business";
  try {
    const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
    domainName = urlObj.hostname.replace(/^www\./, '').split('.')[0];
  } catch (e) {
    // Keep default
  }

  try {
    // Use AI to analyze the URL and extract comprehensive brand data
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze this website URL: ${url}. 
      
Based on the domain name and common web patterns, infer what business this is.

Provide comprehensive brand information in JSON format:
1. name: The business name
2. description: A short description of what the business does
3. services: Key services or products offered (array)
4. targetAudience: Who the ideal customer is
5. logo: URL to the logo image (look for common logo paths like /logo, /images/logo, favicon, or og:image meta tag). Return empty string if not found.
6. brandColors: Primary brand colors as hex codes or color names (array of 2-4 colors)
7. industry: The industry category (e.g., "technology", "fitness", "luxury", "healthcare", "food", "education", "fashion", "finance", "real estate", "travel", "beauty", "sports", "entertainment", "general business")

Be conservative with logo - only return a URL if you can reasonably determine it from common patterns.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            description: { type: Type.STRING },
            services: { type: Type.ARRAY, items: { type: Type.STRING } },
            targetAudience: { type: Type.STRING },
            logo: { type: Type.STRING },
            brandColors: { type: Type.ARRAY, items: { type: Type.STRING } },
            industry: { type: Type.STRING },
          },
          required: ["name", "description", "services", "targetAudience"],
        },
      },
    });

    const result = JSON.parse(response.text);
    
    // Ensure brandColors is always defined
    if (!result.brandColors || result.brandColors.length === 0) {
      result.brandColors = getDefaultBrandColors(result.industry);
    }
    
    // Ensure industry is always defined
    if (!result.industry) {
      result.industry = inferIndustry(domainName, result.name, result.description);
    }
    
    return result;
  } catch (error) {
    console.error("Analysis failed, using default business profile", error);
    // Fallback: Return a generic business profile
    return {
      name: domainName.charAt(0).toUpperCase() + domainName.slice(1) + " Business",
      description: "A professional business offering quality products and services to customers.",
      services: ["Product Sales", "Customer Service", "Online Support"],
      targetAudience: "General consumers looking for quality solutions",
      logo: "",
      brandColors: ["#2563EB", "#1E40AF"],
      industry: inferIndustry(domainName, domainName + " Business", "")
    };
  }
}

// Helper function to infer industry from business name/description
function inferIndustry(domain: string, name: string, description: string): string {
  const combined = (domain + " " + name + " " + description).toLowerCase();
  
  const industryPatterns: [string, RegExp][] = [
    ["technology", /tech|software|app|cloud|data|ai|web|dev|solution|digital/],
    ["fitness", /fitness|gym|workout|exercise|health|sport|training|yoga/],
    ["luxury", /luxury|premium|high-end|exclusive|designer|brand/],
    ["healthcare", /medical|health|doctor|clinic|hospital|pharma|wellness/],
    ["food", /food|restaurant|cafe|coffee|meal|chef|dining|organic/],
    ["education", /education|school|college|course|learning|training|tutorial|academy/],
    ["fashion", /fashion|clothing|apparel|shoes|wear|style|design/],
    ["finance", /finance|bank|investment|insurance|real estate|property|loan/],
    ["beauty", /beauty|spa|salon|cosmetics|skincare|makeup/],
    ["travel", /travel|hotel|flight|tourism|vacation|booking|resort/],
    ["entertainment", /music|movie|game|entertainment|art|gallery|theater/],
  ];
  
  for (const [industry, pattern] of industryPatterns) {
    if (pattern.test(combined)) {
      return industry;
    }
  }
  
  return "general business";
}

// Get default brand colors based on industry
function getDefaultBrandColors(industry?: string): string[] {
  const colorMap: Record<string, string[]> = {
    technology: ["#2563EB", "#1E40AF", "#06B6D4"],
    fitness: ["#10B981", "#059669", "#F59E0B"],
    luxury: ["#1F2937", "#D4AF37", "#000000"],
    healthcare: ["#10B981", "#059669", "#3B82F6"],
    food: ["#F97316", "#EF4444", "#EAB308"],
    education: ["#3B82F6", "#8B5CF6", "#6366F1"],
    fashion: ["#1F2937", "#F472B6", "#9CA3AF"],
    finance: ["#1E3A8A", "#1F2937", "#10B981"],
    beauty: ["#F472B6", "#EC4899", "#FEF3C7"],
    travel: ["#0EA5E9", "#06B6D4", "#F97316"],
    entertainment: ["#8B5CF6", "#EC4899", "#F59E0B"],
  };
  
  return colorMap[industry || ""] || ["#2563EB", "#1E40AF"];
}

/**
 * Create a BrandStyle object from BusinessInfo
 * This ensures consistent branding across all generated images
 */
export function createBrandStyle(businessInfo: BusinessInfo): BrandStyle {
  const industry = businessInfo.industry || "general business";
  const colors = businessInfo.brandColors && businessInfo.brandColors.length > 0
    ? businessInfo.brandColors.join(", ")
    : getDefaultBrandColors(industry).join(", ");
  
  // Determine tone based on industry
  const toneMap: Record<string, string> = {
    luxury: "sophisticated, elegant, premium",
    fitness: "energetic, motivating, dynamic",
    technology: "innovative, clean, professional",
    healthcare: "trustworthy, caring, professional",
    food: "appetizing, warm, inviting",
    education: "inspiring, trustworthy, academic",
    finance: "professional, trustworthy, secure",
    beauty: "glamorous, elegant, soft",
    travel: "adventurous, relaxing, inspiring",
  };
  
  return {
    name: businessInfo.name || "Business",
    colors: colors,
    tone: toneMap[industry] || "professional advertising",
    industry: industry,
    logo: businessInfo.logo || "",
    primaryColor: businessInfo.brandColors?.[0] || getDefaultBrandColors(industry)[0],
    secondaryColor: businessInfo.brandColors?.[1] || getDefaultBrandColors(industry)[1],
  };
}

/**
 * Generate a brand-consistent image prompt for a scene
 * This ensures all images in the ad have consistent style, colors, and branding
 */
export function buildBrandConsistentPrompt(
  sceneNarration: string,
  sceneNumber: number,
  totalScenes: number,
  brandStyle: BrandStyle,
  isFinalCTA: boolean = false,
  websiteUrl?: string
): string {
  // Base prompt structure
  const basePrompt = isFinalCTA 
    ? buildCTAPrompt(brandStyle, websiteUrl)
    : buildScenePrompt(sceneNarration, sceneNumber, totalScenes, brandStyle);
  
  return basePrompt;
}

/**
 * Build a regular scene prompt with brand consistency
 */
function buildScenePrompt(
  narration: string,
  sceneNumber: number,
  totalScenes: number,
  brandStyle: BrandStyle
): string {
  const sceneContext = narration || `Scene ${sceneNumber} of ${totalScenes}`;
  
  return `Professional advertisement image for ${brandStyle.name}.

Scene context: ${sceneContext}

Style:
- Industry: ${brandStyle.industry}
- Colors: ${brandStyle.colors}
- Tone: ${brandStyle.tone}

Visual Requirements:
- Cinematic lighting with professional studio setup
- High quality commercial photography
- Shallow depth of field for product focus
- Clean, balanced composition
- Consistent color grading across all scenes

Branding Elements:
${brandStyle.logo ? `- Include brand logo subtly integrated into the scene` : `- Maintain brand color palette`}
- Same visual style as other scenes in this advertisement

Camera & Perspective:
- Dynamic angle with realistic perspective
- Professional advertising shot
- 16:9 aspect ratio for video

Make it look like a real, high-converting Instagram ad or commercial. The image should feel authentic, not AI-generated.`;
}

/**
 * Build a special CTA (Call-to-Action) final scene prompt
 * This scene is designed to drive conversion
 */
function buildCTAPrompt(brandStyle: BrandStyle, websiteUrl?: string): string {
  const displayUrl = websiteUrl ? websiteUrl.replace(/^https?:\/\//, '') : brandStyle.name.toLowerCase() + '.com';
  
  return `Professional product advertisement - FINAL CALL TO ACTION SCENE.

Context: This is the final scene of the advertisement designed to convert viewers.

Brand: ${brandStyle.name}
- Primary color: ${brandStyle.primaryColor || 'brand blue'}
- Secondary color: ${brandStyle.secondaryColor || 'white'}

Visual Requirements:
- Clean, uncluttered background with brand colors
- Product/center subject perfectly centered
- Professional product photography lighting
- High contrast for readability
- Maximum impact design

Must Include:
- Brand logo prominently visible (top corner)
- Website URL clearly displayed: ${displayUrl}
- Eye-catching CTA text like "Shop Now", "Learn More", or "Get Started"
- Professional finish that looks like a real Instagram ad

Style:
- ${brandStyle.tone}
- Clean and modern
- High conversion optimization
- Same consistent style as previous scenes in the ad

Camera:
- Front-facing, centered composition
- Professional commercial photography
- 16:9 aspect ratio

Make viewers want to click and visit the website!`;
}

/**
 * Generate industry-specific visual modifiers
 * This helps maintain brand consistency across different types of businesses
 */
export function getIndustryVisualModifiers(industry: string): {
  lighting: string;
  background: string;
  composition: string;
  mood: string;
} {
  const modifiers: Record<string, { lighting: string; background: string; composition: string; mood: string }> = {
    technology: {
      lighting: "clean, cool LED lighting, modern tech glow",
      background: "sleek dark gradient or clean white, futuristic elements",
      composition: "centered product, generous negative space, minimalist",
      mood: "innovative, cutting-edge, professional"
    },
    fitness: {
      lighting: "dynamic warm lighting, energy and movement",
      background: "gym setting or energetic environment, bold colors",
      composition: "action-oriented, full body or dynamic pose",
      mood: "energetic, motivating, powerful"
    },
    luxury: {
      lighting: "dramatic accent lighting, golden hour warmth",
      background: "elegant settings, marble or rich textures",
      composition: "balanced, sophisticated, plenty of space",
      mood: "sophisticated, exclusive, timeless"
    },
    healthcare: {
      lighting: "soft, clean daylight, gentle and welcoming",
      background: "medical environment or clean white/blue",
      composition: "warm and approachable, centered subject",
      mood: "trustworthy, caring, professional"
    },
    food: {
      lighting: "warm, appetizing natural light, food photography lighting",
      background: "rustic table or clean studio, ingredients visible",
      composition: "hero food centered, styled professionally",
      mood: "appetizing, fresh, delicious"
    },
    education: {
      lighting: "bright, inspiring daylight",
      background: "academic setting or clean modern classroom",
      composition: "teacher/student or learning materials centered",
      mood: "inspiring, trustworthy, academic"
    },
    fashion: {
      lighting: "professional fashion photography lighting",
      background: "clean minimal or editorial setting",
      composition: "model or garment focused, editorial style",
      mood: "stylish, aspirational, trendsetting"
    },
    finance: {
      lighting: "professional, trustworthy lighting setup",
      background: "corporate setting or clean gradient",
      composition: "balanced, stable, professional",
      mood: "trustworthy, secure, professional"
    },
    beauty: {
      lighting: "soft, flattering beauty lighting",
      background: "clean, soft, elegant setting",
      composition: "focus on face or product, close-up",
      mood: "glamorous, elegant, natural"
    },
    travel: {
      lighting: "golden hour or scenic natural light",
      background: "stunning destination or travel imagery",
      composition: "immersive, showing experience",
      mood: "adventurous, relaxing, inspiring"
    },
    entertainment: {
      lighting: "dynamic, colorful stage lighting",
      background: "theatrical or colorful backdrop",
      composition: "entertaining, engaging, dynamic",
      mood: "exciting, fun, engaging"
    }
  };
  
  return modifiers[industry] || {
    lighting: "professional studio lighting",
    background: "clean modern background",
    composition: "centered, balanced composition",
    mood: "professional, engaging"
  };
}

export interface AdCopy {
  headline: string;
  subtext: string;
  cta: string;
  imagePrompt: string;
}

/**
 * Generate ad copy for Image Ads
 * Creates headline, subtext, CTA, and image prompt
 */
export async function generateAdCopy(
  product: string,
  websiteUrl?: string,
  language: SupportedLanguage = 'english'
): Promise<AdScript> {
  const ai = getAI();
  const languageLabel = getLanguageLabel(language);
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Create advertising copy for an image ad in ${languageLabel}.
    
    PRODUCT/IDEA: ${product}
    ${websiteUrl ? `WEBSITE: ${websiteUrl}` : ''}
    
    Create:
    1. HEADLINE (max 5 words): Catchy, attention-grabbing headline
    2. SUBTEXT (max 15 words): Brief description or value proposition
    3. CTA (2-4 words): Clear call-to-action like "Shop Now", "Learn More", "Get Started", "Sign Up Free"
    4. IMAGE PROMPT: Detailed prompt for generating a high-quality ad image
    5. SEO PACKAGE:
       - metaTitle (max 60 characters)
       - metaDescription (150-160 characters)
       - primaryKeyword
       - secondaryKeywords (2-4)
       - targetKeywords (primary + secondary + 1 long-tail)
       - seoScore (0-100)
    
    Requirements:
    - NO website URLs in the copy
    - Professional, marketing-style language
    - HEADLINE, SUBTEXT, and CTA must be written in ${languageLabel}
    - Image should be suitable for advertising (product shot, lifestyle, or concept)
    - Write the IMAGE PROMPT in English so image generation quality stays strong, but make it perfectly aligned to the ${languageLabel} copy
    
    Return JSON:
    {
      "headline": "...",
      "subtext": "...",
      "cta": "...",
      "imagePrompt": "...",
      "seoMetadata": {
        "headline": "...",
        "metaTitle": "...",
        "metaDescription": "...",
        "primaryKeyword": "...",
        "secondaryKeywords": ["...", "..."],
        "targetKeywords": ["...", "...", "..."],
        "cta": "...",
        "seoScore": 90,
        "tone": "Professional, persuasive, human-like"
      }
    }`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headline: { type: Type.STRING },
          subtext: { type: Type.STRING },
          cta: { type: Type.STRING },
          imagePrompt: { type: Type.STRING },
          seoMetadata: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              metaTitle: { type: Type.STRING },
              metaDescription: { type: Type.STRING },
              primaryKeyword: { type: Type.STRING },
              secondaryKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              targetKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              cta: { type: Type.STRING },
              seoScore: { type: Type.NUMBER },
              tone: { type: Type.STRING }
            },
            required: ["headline", "metaTitle", "metaDescription", "primaryKeyword", "secondaryKeywords", "targetKeywords", "cta", "seoScore", "tone"]
          }
        },
        required: ["headline", "subtext", "cta", "imagePrompt", "seoMetadata"]
      }
    }
  });

  const result = JSON.parse(response.text);
  const seoMetadata = normalizeSeoMetadata(result.seoMetadata, {
    headline: result.headline,
    metaTitle: result.headline,
    metaDescription: result.subtext,
    primaryKeyword: product,
    secondaryKeywords: ['image ad copy', `${product} benefits`],
    targetKeywords: [product, 'high-converting ad copy', `${product} image ad`],
    cta: result.cta,
    seoScore: 88
  });
  
  // Convert to AdScript format for compatibility
  return {
    hook: result.headline,
    body: result.subtext,
    cta: result.cta,
    visualPrompts: [result.imagePrompt],
    duration: 0,
    language,
    seoMetadata,
    scenes: [{
      scene: 1,
      duration: 0,
      narration: result.headline,
      overlay: result.cta,
      image_prompt: result.imagePrompt,
      video_prompt: result.imagePrompt
    }]
  };
}

export async function generateAdScript(
  info: BusinessInfo,
  style: string,
  duration: number = 15,
  language: SupportedLanguage = 'english'
): Promise<AdScript> {
  const cacheKey = buildAICacheKey('ad-script', { info, style, duration, language });
  return withAICache(cacheKey, SCRIPT_CACHE_TTL_MS, async () => {
    const ai = getAI();
    const languageLabel = getLanguageLabel(language);
    
    const targetWords = Math.floor(duration * 2.5);
    const minWords = targetWords - 5;
    const maxWords = targetWords + 5;
    const durationPlan = buildDurationPlan(duration);
    const sceneCount = durationPlan.sceneCount;
    const sceneTimings = durationPlan.timings;
    const wordsPerScene = sceneTimings.map(getWordsForSceneDuration);

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `${buildAdLanguagePrompt(language)}
      Create a STRICTLY ${duration}-second video ad script in ${languageLabel} for this business: ${JSON.stringify(info)}.
      Style: ${style}.
      
      CRITICAL REQUIREMENTS:
      1. The total spoken words MUST be between ${minWords} and ${maxWords} words (target: ${targetWords} words for a ${duration}-second ad at 2.5 words/sec).
      2. Create exactly ${sceneCount} scenes with these durations (seconds): ${JSON.stringify(sceneTimings)}.
      3. Each scene must have narration that fits its time allocation (${wordsPerScene.join(', ')} words respectively).
      4. Scene structure:
         ${durationPlan.phases.map((phase, index) => `- Scene ${index + 1} (${sceneTimings[index]}s): ${phase.toUpperCase()} - ${phase === 'hook' ? 'grab attention immediately' : phase === 'problem' ? 'show the customer pain point' : phase === 'solution' ? 'present the offering clearly' : phase === 'benefits' ? 'prove value with outcomes' : 'close with a strong call to action'}`).join('\n       ')}
      5. Each scene needs: narration text, short overlay text (3-5 words), cinematic image prompt, and video prompt for Veo generation.
      6. Total words in ALL narrations combined must be ${minWords}-${maxWords} words.
      7. Final scene MUST be a CTA scene with product focus and website/brand callout if available.
      8. Keep all scenes tightly aligned so visuals directly match the narration and overlays.
      9. Narration, overlay text, hook, body, and CTA must be written naturally in ${languageLabel}.
      10. Write image_prompt and video_prompt in English for best visual-model performance, but keep them exactly aligned to the ${languageLabel} narration and overlay.
      11. Also generate an SEO/conversion package with:
          - headline
          - metaTitle (max 60 characters)
          - metaDescription (150-160 characters)
          - primaryKeyword
          - secondaryKeywords (2-4)
          - targetKeywords (primary + secondary + long-tail)
          - CTA
          - seoScore (0-100)
      
      Return a JSON object with:
      - hook: string (Scene 1 narration)
      - body: string (combined scenes 2-${sceneCount - 1} narration)
      - cta: string (final scene narration)
      - visualPrompts: string[] (one image prompt per scene, ${sceneCount} total)
      - duration: number (the requested duration)
      - seoMetadata: {headline, metaTitle, metaDescription, primaryKeyword, secondaryKeywords, targetKeywords, cta, seoScore, tone}
      - scenes: array of {scene, duration, narration, overlay, image_prompt, video_prompt} objects`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            hook: { type: Type.STRING },
            body: { type: Type.STRING },
            cta: { type: Type.STRING },
            visualPrompts: { type: Type.ARRAY, items: { type: Type.STRING } },
            duration: { type: Type.NUMBER },
            seoMetadata: {
              type: Type.OBJECT,
              properties: {
                headline: { type: Type.STRING },
                metaTitle: { type: Type.STRING },
                metaDescription: { type: Type.STRING },
                primaryKeyword: { type: Type.STRING },
                secondaryKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                targetKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                cta: { type: Type.STRING },
                seoScore: { type: Type.NUMBER },
                tone: { type: Type.STRING }
              },
              required: ["headline", "metaTitle", "metaDescription", "primaryKeyword", "secondaryKeywords", "targetKeywords", "cta", "seoScore", "tone"]
            },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  scene: { type: Type.NUMBER },
                  duration: { type: Type.NUMBER },
                  narration: { type: Type.STRING },
                  overlay: { type: Type.STRING },
                  image_prompt: { type: Type.STRING },
                  video_prompt: { type: Type.STRING }
                },
                required: ["scene", "duration", "narration", "overlay", "image_prompt", "video_prompt"]
              }
            }
          },
          required: ["hook", "body", "cta", "visualPrompts", "duration", "seoMetadata", "scenes"],
        },
      },
    });

    const result = JSON.parse(response.text);
    const validatedResult = validateAndFixScript(result, duration, minWords, maxWords);
    const seoMetadata = normalizeSeoMetadata(result.seoMetadata, {
      headline: result.hook || `${info.name} Video Ad`,
      metaTitle: `${info.name} | ${style} video ad`,
      metaDescription: `${info.name}: ${info.description}`.slice(0, 160),
      primaryKeyword: info.name,
      secondaryKeywords: [style, info.targetAudience, 'video ad'],
      targetKeywords: [info.name, `${style} video ad`, `${info.name} for ${info.targetAudience}`],
      cta: result.cta || 'Get started today',
      seoScore: 86
    });
    const enrichedScenes = validatedResult.scenes.map((scene, index) => {
      const phase = durationPlan.phases[index] || (index === validatedResult.scenes.length - 1 ? 'cta' : 'benefits');
      const overlay = (scene.overlay || phase.toUpperCase()).trim();
      const narration = (scene.narration || '').trim();
      const isFinalScene = index === validatedResult.scenes.length - 1;

      return {
        ...scene,
        scene: index + 1,
        duration: sceneTimings[index] || scene.duration || 5,
        overlay,
        image_prompt: buildSceneImagePrompt(info, style, phase, narration, overlay, isFinalScene, sceneTimings[index] || scene.duration || 5),
        video_prompt: `${buildSceneImagePrompt(info, style, phase, narration, overlay, isFinalScene, sceneTimings[index] || scene.duration || 5)}, subtle motion cues, premium ad video shot`
      };
    });
    
    return {
      ...validatedResult,
      duration,
      hook: enrichedScenes[0]?.narration || validatedResult.hook,
      body: enrichedScenes.slice(1, -1).map(scene => scene.narration).join(' '),
      cta: enrichedScenes[enrichedScenes.length - 1]?.narration || validatedResult.cta,
      visualPrompts: enrichedScenes.map(scene => scene.image_prompt),
      language,
      seoMetadata,
      scenes: enrichedScenes
    };
  });
}

/**
 * Generate a YouTube video script with proper storytelling structure
 * - Hook: Attention grabber (3-5 sec)
 * - Main Points: 4-8 detailed sections (4-8 sec each)
 * - Conclusion: Summary + CTA (5-7 sec)
 */
export async function generateYouTubeScript(
  topic: string,
  existingScript: string,
  duration: number = 60,
  options: YouTubeGenerationOptions = {}
): Promise<AdScript> {
  const visualStyle = options.visualStyle || 'realistic';
  const language = options.language || 'english';
  const cacheKey = buildAICacheKey('youtube-script', { topic, existingScript, duration, visualStyle, language });
  return withAICache(cacheKey, SCRIPT_CACHE_TTL_MS, async () => {
  const ai = getAI();
  const languageLabel = getLanguageLabel(language);
  const scenePlan = buildYouTubeScenePlan(duration);
  const targetScenes = scenePlan.targetScenes;
  const storyProfile = buildYouTubeStoryProfile(topic, visualStyle);
  const characterProfiles = buildDefaultCharacterProfiles(topic, visualStyle);
  const targetWords = Math.floor(duration * 2.15);
  const minWords = targetWords - 20;
  const maxWords = targetWords + 20;
  const prompt = existingScript && existingScript.trim()
    ? `Topic: ${topic}
    Language: ${languageLabel}
    
    User-provided script:
    ${existingScript}
    
    Convert this script into a YouTube story structure with ${targetScenes} scenes in ${languageLabel}.`
    : `Create a ${duration}-second YouTube video about: ${topic} in ${languageLabel}
    
    This should be engaging educational/entertainment content, NOT an advertisement.`;
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `${prompt}
    
    ADVANCED STORYTELLING REQUIREMENTS:
    1. Build a complete YouTube story arc with these beats:
       ${scenePlan.beats.map((beat, index) => `- Scene ${index + 1} (${scenePlan.timings[index]}s): ${beat.toUpperCase()}`).join('\n       ')}
    2. Include a curiosity-driven hook in the first 5 seconds, a real conflict, rising stakes, at least one emotional peak, and a strong ending or twist.
    3. This is YouTube content, not an ad. Make it feel like a cinematic mini-story or compelling explainer with narrative momentum.
    4. Maintain a consistent main character or host across all scenes.
    5. Keep total narration between ${minWords} and ${maxWords} words for a ${duration}s video.
    6. Visual style: ${visualStyle}. Aspect ratio: 16:9 landscape.
    6a. All narration, overlays, titles, metadata title/description, and CTA wording must be in ${languageLabel}.
    7. Every scene must include:
       - title
       - narration
       - overlay
       - visual_description
       - character_actions
       - storyBeat
       - emotion
       - characters (array of character names visible in scene)
       - transition
       - sound_effects (array)
       - image_prompt
       - video_prompt
       - voice_hint
    8. Image prompts must be cinematic, emotional, deep, continuous, and character-consistent.
    9. Generate channel-ready YouTube metadata: title, description, tags, thumbnail prompt.
    10. Use these continuity anchors for characters:
        ${characterProfiles.map((character) => `- ${character.name}: ${character.role}, ${character.face}, ${character.clothes}, ${character.style}, personality ${character.personality}, voice ${character.voiceHint}`).join('\n        ')}
    11. Also return SEO metadata for the page:
        - headline
        - metaTitle (max 60 characters)
        - metaDescription (150-160 characters)
        - primaryKeyword
        - secondaryKeywords
        - targetKeywords
        - cta
        - seoScore
        - tone

    Return JSON:
    {
      "hook": "Scene 1 narration",
      "body": "Combined middle-story narration",
      "cta": "Ending narration",
      "visualPrompts": ["prompt1", "prompt2", ...],
      "duration": ${duration},
      "characterProfiles": [
        {"name":"...", "role":"...", "face":"...", "clothes":"...", "style":"...", "personality":"...", "voiceHint":"..."}
      ],
      "storyProfile": {
        "premise":"...",
        "hook":"...",
        "conflict":"...",
        "emotionalPeaks":["..."],
        "ending":"...",
        "style":"${visualStyle}",
        "musicMood":"..."
      },
      "youtubeMetadata": {
        "title":"...",
        "description":"...",
        "tags":["..."],
        "thumbnailPrompt":"..."
      },
      "seoMetadata": {
        "headline":"...",
        "metaTitle":"...",
        "metaDescription":"...",
        "primaryKeyword":"...",
        "secondaryKeywords":["..."],
        "targetKeywords":["..."],
        "cta":"...",
        "seoScore":90,
        "tone":"Professional, persuasive, human-like"
      },
      "scenes": [
        {
          "scene": 1,
          "duration": ${scenePlan.timings[0]},
          "title": "...",
          "narration": "...",
          "overlay": "...",
          "visual_description": "...",
          "character_actions": "...",
          "storyBeat": "${scenePlan.beats[0]}",
          "emotion": "...",
          "characters": ["..."],
          "transition": "...",
          "sound_effects": ["..."],
          "image_prompt": "...",
          "video_prompt": "...",
          "voice_hint": "..."
        },
        ...
      ]
    }`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          hook: { type: Type.STRING },
          body: { type: Type.STRING },
          cta: { type: Type.STRING },
          visualPrompts: { type: Type.ARRAY, items: { type: Type.STRING } },
          duration: { type: Type.NUMBER },
          characterProfiles: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                role: { type: Type.STRING },
                face: { type: Type.STRING },
                clothes: { type: Type.STRING },
                style: { type: Type.STRING },
                personality: { type: Type.STRING },
                voiceHint: { type: Type.STRING }
              },
              required: ["name", "role", "face", "clothes", "style", "personality", "voiceHint"]
            }
          },
          storyProfile: {
            type: Type.OBJECT,
            properties: {
              premise: { type: Type.STRING },
              hook: { type: Type.STRING },
              conflict: { type: Type.STRING },
              emotionalPeaks: { type: Type.ARRAY, items: { type: Type.STRING } },
              ending: { type: Type.STRING },
              style: { type: Type.STRING },
              musicMood: { type: Type.STRING }
            },
            required: ["premise", "hook", "conflict", "emotionalPeaks", "ending", "style", "musicMood"]
          },
          youtubeMetadata: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } },
              thumbnailPrompt: { type: Type.STRING }
            },
            required: ["title", "description", "tags", "thumbnailPrompt"]
          },
          seoMetadata: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              metaTitle: { type: Type.STRING },
              metaDescription: { type: Type.STRING },
              primaryKeyword: { type: Type.STRING },
              secondaryKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              targetKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              cta: { type: Type.STRING },
              seoScore: { type: Type.NUMBER },
              tone: { type: Type.STRING }
            },
            required: ["headline", "metaTitle", "metaDescription", "primaryKeyword", "secondaryKeywords", "targetKeywords", "cta", "seoScore", "tone"]
          },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                scene: { type: Type.NUMBER },
                duration: { type: Type.NUMBER },
                title: { type: Type.STRING },
                narration: { type: Type.STRING },
                overlay: { type: Type.STRING },
                visual_description: { type: Type.STRING },
                character_actions: { type: Type.STRING },
                storyBeat: { type: Type.STRING },
                emotion: { type: Type.STRING },
                characters: { type: Type.ARRAY, items: { type: Type.STRING } },
                transition: { type: Type.STRING },
                sound_effects: { type: Type.ARRAY, items: { type: Type.STRING } },
                image_prompt: { type: Type.STRING },
                video_prompt: { type: Type.STRING },
                voice_hint: { type: Type.STRING }
              },
              required: ["scene", "duration", "title", "narration", "overlay", "visual_description", "character_actions", "storyBeat", "emotion", "characters", "transition", "sound_effects", "image_prompt", "video_prompt", "voice_hint"]
            }
          }
        },
        required: ["hook", "body", "cta", "visualPrompts", "duration", "seoMetadata", "scenes"],
      },
    },
  });

  const result = JSON.parse(response.text);

  if (!result.scenes || result.scenes.length === 0) {
    console.warn('YouTube script generation failed, creating fallback');
    return createYouTubeFallback(topic, duration, visualStyle);
  }

  const normalizedScenes: Scene[] = Array.from({ length: targetScenes }, (_, index) => {
    const existingScene = result.scenes[index] || result.scenes[result.scenes.length - 1] || {};
    const beat = scenePlan.beats[index];
    const characters = Array.isArray(existingScene.characters) && existingScene.characters.length > 0
      ? existingScene.characters
      : [characterProfiles[0]?.name || 'Main Host'];
    const title = (existingScene.title || `${beat.toUpperCase()}: ${topic}`).trim();
    const narration = (existingScene.narration || `${topic} moves into the ${beat} beat here.`).trim();
    const visualDescription = (existingScene.visual_description || `Cinematic ${beat} visual centered on ${topic}.`).trim();
    const characterActions = (existingScene.character_actions || `The lead character reacts to the ${beat} of the story.`).trim();

    const sceneBase: Scene = {
      scene: index + 1,
      duration: scenePlan.timings[index],
      title,
      narration,
      overlay: (existingScene.overlay || title).trim(),
      visual_description: visualDescription,
      character_actions: characterActions,
      storyBeat: beat,
      emotion: (existingScene.emotion || (beat.includes('peak') ? 'intense' : beat === 'ending' ? 'satisfying' : 'curious')).trim(),
      characters,
      transition: (existingScene.transition || (index === 0 ? 'cold open cut' : 'cinematic dissolve')).trim(),
      sound_effects: Array.isArray(existingScene.sound_effects) && existingScene.sound_effects.length > 0
        ? existingScene.sound_effects
        : beat.includes('conflict')
          ? ['rising tension', 'ambient room tone']
          : beat.includes('peak')
            ? ['heartbeat swell', 'impact whoosh']
            : ['soft cinematic ambience'],
      voice_hint: (existingScene.voice_hint || (index === 0 ? 'urgent and intriguing' : beat.includes('peak') ? 'intense and emotional' : 'clear storyteller')).trim(),
      image_prompt: '',
      video_prompt: ''
    };

    sceneBase.image_prompt = buildYouTubeImagePrompt(
      topic,
      visualStyle,
      beat,
      sceneBase.title || '',
      sceneBase.narration,
      sceneBase.visual_description || '',
      sceneBase.character_actions || '',
      sceneBase.characters || [],
      result.characterProfiles || characterProfiles
    );
    sceneBase.image_variations = [
      `${sceneBase.image_prompt}, master shot, polished cinematic frame`,
      `${sceneBase.image_prompt}, alternate camera angle, story continuity, emotional close-up`
    ];
    sceneBase.video_prompt = existingScene.video_prompt || buildYouTubeVideoPrompt(sceneBase, visualStyle);
    return sceneBase;
  });

  const finalCharacterProfiles = Array.isArray(result.characterProfiles) && result.characterProfiles.length > 0
    ? result.characterProfiles
    : characterProfiles;
  const finalStoryProfile: StoryProfile = result.storyProfile || storyProfile;
  const finalYouTubeMetadata: YouTubeMetadata = {
    title: result.youtubeMetadata?.title || `${topic}: The Story You Didn't Expect`,
    description: result.youtubeMetadata?.description || `A cinematic story-driven breakdown of ${topic}, with conflict, emotion, and a strong ending.`,
    tags: Array.isArray(result.youtubeMetadata?.tags) && result.youtubeMetadata.tags.length > 0
      ? result.youtubeMetadata.tags
      : [topic, `${topic} story`, 'cinematic youtube', 'ai generated video', visualStyle],
    thumbnailPrompt: result.youtubeMetadata?.thumbnailPrompt || buildYouTubeThumbnailPrompt(topic, finalStoryProfile, finalCharacterProfiles)
  };
  const seoMetadata = normalizeSeoMetadata(result.seoMetadata, {
    headline: finalYouTubeMetadata.title,
    metaTitle: finalYouTubeMetadata.title,
    metaDescription: finalYouTubeMetadata.description,
    primaryKeyword: topic,
    secondaryKeywords: ['youtube video', visualStyle, `${topic} story`],
    targetKeywords: [topic, `${topic} explained`, `${topic} youtube video`],
    cta: result.cta || 'Watch till the end',
    seoScore: 90
  });

  return {
    hook: result.hook || normalizedScenes[0]?.narration || '',
    body: result.body || normalizedScenes.slice(1, -1).map((scene) => scene.narration).join(' '),
    cta: result.cta || normalizedScenes[normalizedScenes.length - 1]?.narration || '',
    visualPrompts: normalizedScenes.map((scene) => scene.image_prompt),
    duration: duration,
    language,
    scenes: normalizedScenes,
    characterProfiles: finalCharacterProfiles,
    storyProfile: finalStoryProfile,
    youtubeMetadata: finalYouTubeMetadata,
    seoMetadata
  };
  });
}

/**
 * Generate an Instagram Reels script optimized for short-form vertical content
 * - Hook: First 2 seconds to grab attention
 * - 3-5 quick points: Fast-paced content
 * - CTA: Call to action at the end
 * - Total: 10-15 seconds, 9:16 aspect ratio
 */
export async function generateReelsScript(
  reelIdea: string,
  duration: number = 15,
  language: SupportedLanguage = 'english'
): Promise<AdScript> {
  const cacheKey = buildAICacheKey('reels-script', { reelIdea, duration, language });
  return withAICache(cacheKey, SCRIPT_CACHE_TTL_MS, async () => {
  const ai = getAI();
  const languageLabel = getLanguageLabel(language);

  const reelPlan = duration <= 15
    ? { targetScenes: 4, timings: [4, 4, 4, 3], labels: ['hook', 'point', 'point', 'cta'] }
    : duration <= 30
      ? { targetScenes: 5, timings: [6, 6, 6, 6, 6], labels: ['hook', 'point', 'point', 'point', 'cta'] }
      : { targetScenes: 7, timings: [8, 8, 9, 9, 9, 9, 8], labels: ['hook', 'point', 'point', 'point', 'point', 'point', 'cta'] };

  const targetScenes = reelPlan.targetScenes;
  const sceneTimings = reelPlan.timings;
  const hookDuration = sceneTimings[0];
  const ctaDuration = sceneTimings[sceneTimings.length - 1];
  const pointDuration = sceneTimings[1] || 4;

  // Slightly slower than before so reels do not overstuff narration
  const targetWords = Math.floor(duration * 2.2);
  const minWords = Math.max(10, targetWords - 6);
  const maxWords = targetWords + 6;
  const wordsPerScene = sceneTimings.map((timing) => Math.max(7, Math.round(timing * 2.2)));
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `${buildAdLanguagePrompt(language)}
    Create a ${duration}-second Instagram Reels script for: "${reelIdea}"
    Language: ${languageLabel}
    
    CRITICAL REELS REQUIREMENTS:
    1. TOTAL DURATION: ${duration} seconds
    2. ASPECT RATIO: 9:16 (vertical video)
    3. STRUCTURE:
       ${reelPlan.labels.map((label, index) => `- Scene ${index + 1} (${sceneTimings[index]}s): ${label === 'hook' ? 'HOOK - stop the scroll immediately' : label === 'cta' ? 'CTA - clear social action' : 'QUICK POINT - one tight idea only'}`).join('\n       ')}
    4. STYLE: Fast-paced, engaging, trendy, scroll-stopping content
    5. NO WEBSITE URLs in the script - this is Reels content, not an ad
    6. Target word count: ${minWords}-${maxWords} words total
    7. Each scene narration must fit its exact duration (${wordsPerScene.join(', ')} words approx. by scene)
    8. Each scene needs: narration, overlay text (3-5 words max), image prompt, and video prompt
    9. Keep the language neat, punchy, and easy to finish within the duration. No long sentences.
    10. Narration, overlay text, hook, body, and CTA must all be in ${languageLabel}.
    11. Also return SEO metadata for this reel:
        - headline
        - metaTitle (max 60 characters)
        - metaDescription (150-160 characters)
        - primaryKeyword
        - secondaryKeywords
        - targetKeywords
        - cta
        - seoScore
        - tone
    
    VIDEO PROMPTS: Create vertical (9:16) video prompts that are dynamic, visually engaging, and suitable for social media.
    IMAGE PROMPTS: Every image prompt must explicitly include "vertical 9:16 composition, mobile format, portrait orientation, centered subject, safe for mobile viewing, no important content on the sides".
    
    Return JSON:
    {
      "hook": "Scene 1 narration - attention grabber",
      "body": "Combined quick points narration",
      "cta": "Final CTA narration",
      "visualPrompts": ["prompt1", "prompt2", ...],
      "duration": ${duration},
      "seoMetadata": {
        "headline":"...",
        "metaTitle":"...",
        "metaDescription":"...",
        "primaryKeyword":"...",
        "secondaryKeywords":["..."],
        "targetKeywords":["..."],
        "cta":"...",
        "seoScore":88,
        "tone":"Professional, persuasive, human-like"
      },
      "scenes": [
        {scene: 1, duration: ${hookDuration}, narration: "...", overlay: "...", image_prompt: "...", video_prompt: "..."},
        {scene: 2, duration: ${pointDuration}, narration: "...", overlay: "...", image_prompt: "...", video_prompt: "..."},
        ...
      ]
    }`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          hook: { type: Type.STRING },
          body: { type: Type.STRING },
          cta: { type: Type.STRING },
          visualPrompts: { type: Type.ARRAY, items: { type: Type.STRING } },
          duration: { type: Type.NUMBER },
          seoMetadata: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              metaTitle: { type: Type.STRING },
              metaDescription: { type: Type.STRING },
              primaryKeyword: { type: Type.STRING },
              secondaryKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              targetKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              cta: { type: Type.STRING },
              seoScore: { type: Type.NUMBER },
              tone: { type: Type.STRING }
            },
            required: ["headline", "metaTitle", "metaDescription", "primaryKeyword", "secondaryKeywords", "targetKeywords", "cta", "seoScore", "tone"]
          },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                scene: { type: Type.NUMBER },
                duration: { type: Type.NUMBER },
                narration: { type: Type.STRING },
                overlay: { type: Type.STRING },
                image_prompt: { type: Type.STRING },
                video_prompt: { type: Type.STRING }
              },
              required: ["scene", "duration", "narration", "overlay", "image_prompt", "video_prompt"]
            }
          }
        },
        required: ["hook", "body", "cta", "visualPrompts", "duration", "seoMetadata", "scenes"],
      },
    },
  });

  const result = JSON.parse(response.text);
  
  // Validate and fix
  if (!result.scenes || result.scenes.length === 0) {
    console.warn('Reels script generation failed, creating fallback');
    return createReelsFallback(reelIdea, duration);
  }

  const normalizedScenes = Array.from({ length: targetScenes }, (_, index) => {
    const existingScene = result.scenes[index] || result.scenes[result.scenes.length - 1] || {};
    const label = reelPlan.labels[index];
    const fallbackNarration =
      label === 'hook'
        ? `Stop scrolling. ${reelIdea} starts here.`
        : label === 'cta'
          ? `Follow for more ${reelIdea} tips.`
          : `Quick ${reelIdea} point ${index}.`;
    const narration = (existingScene.narration || fallbackNarration).trim();
    const overlay = (existingScene.overlay || (label === 'hook' ? 'WATCH THIS' : label === 'cta' ? 'FOLLOW FOR MORE' : `POINT ${index}`)).trim();
    const imagePromptBase = existingScene.image_prompt || `Vertical content about ${reelIdea}`;

    return {
      scene: index + 1,
      duration: sceneTimings[index],
      narration,
      overlay,
      image_prompt: `${imagePromptBase}, vertical 9:16 composition, mobile format, portrait orientation, centered subject, professional advertisement style, cinematic lighting, no important content on the sides`,
      video_prompt: `${existingScene.video_prompt || imagePromptBase}, vertical 9:16, portrait format, mobile-first social media content`
    };
  });
  const seoMetadata = normalizeSeoMetadata(result.seoMetadata, {
    headline: result.hook || `${reelIdea} Reel`,
    metaTitle: `${reelIdea}`.slice(0, 60),
    metaDescription: `Scroll-stopping reel about ${reelIdea} with a clear hook, quick value, and strong CTA.`.slice(0, 160),
    primaryKeyword: reelIdea,
    secondaryKeywords: ['instagram reel', 'short-form video', 'viral hook'],
    targetKeywords: [reelIdea, `${reelIdea} reel`, `${reelIdea} short-form content`],
    cta: result.cta || 'Follow for more',
    seoScore: 87
  });
  
  return {
    hook: result.hook || normalizedScenes[0]?.narration || '',
    body: result.body || normalizedScenes.slice(1, -1).map((s: any) => s.narration).join(' '),
    cta: result.cta || normalizedScenes[normalizedScenes.length - 1]?.narration || '',
    visualPrompts: normalizedScenes.map((s: any) => s.image_prompt),
    duration,
    language,
    seoMetadata,
    scenes: normalizedScenes
  };
  });
}

export async function generateStoryScript(
  storyIdea: string,
  duration: number = 45,
  language: SupportedLanguage = 'english',
  options: {
    genre?: 'cinematic' | 'motivational' | 'emotional' | 'suspense' | 'kids';
    mood?: 'hopeful' | 'dramatic' | 'inspiring' | 'mysterious' | 'heartwarming';
    visualStyle?: 'realistic' | 'stylized' | 'dreamy';
    mainCharacterName?: string;
    mainCharacterLook?: string;
    supportingCharacters?: string[];
    transitionStyle?: 'cinematic-cut' | 'fade' | 'slide';
    recommendedVoice?: string;
  } = {}
): Promise<AdScript> {
  const genre = options.genre || 'cinematic';
  const mood = options.mood || 'dramatic';
  const visualStyle = options.visualStyle || 'realistic';
  const mainCharacterName = options.mainCharacterName || '';
  const mainCharacterLook = options.mainCharacterLook || '';
  const supportingCharacters = Array.isArray(options.supportingCharacters) ? options.supportingCharacters : [];
  const transitionStyle = options.transitionStyle || 'cinematic-cut';
  const recommendedVoice = options.recommendedVoice || 'storyteller';
  const cacheKey = buildAICacheKey('story-script', { storyIdea, duration, language, genre, mood, visualStyle, mainCharacterName, mainCharacterLook, supportingCharacters, transitionStyle, recommendedVoice });
  return withAICache(cacheKey, SCRIPT_CACHE_TTL_MS, async () => {
    const ai = getAI();
    const languageLabel = getLanguageLabel(language);
    const storyPlan = buildStoryScenePlan(duration);
    const targetWords = Math.floor(duration * 2.1);
    const minWords = Math.max(20, targetWords - 12);
    const maxWords = targetWords + 12;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Create a cinematic story video script in ${languageLabel} for this story idea: "${storyIdea}".

STORY MODE REQUIREMENTS:
1. Total duration: ${duration} seconds.
2. Create exactly ${storyPlan.targetScenes} scenes with these durations: ${JSON.stringify(storyPlan.timings)}.
3. Story arc:
   ${storyPlan.beats.map((beat, index) => `- Scene ${index + 1} (${storyPlan.timings[index]}s): ${beat.toUpperCase()}`).join('\n   ')}
4. Keep total narration between ${minWords} and ${maxWords} words.
5. Narration, overlays, hook, body, CTA, and metadata must all be in ${languageLabel}.
6. image_prompt and video_prompt must be in English for best visual generation quality.
7. Genre: ${genre}. Mood: ${mood}. Visual style: ${visualStyle}.
8. Make every scene realistic, cinematic, emotionally clear, and visually consistent.
9. Maintain the same main character or visual identity across the full story.
10. Every scene needs narration, overlay text, image_prompt, and video_prompt.
11. Also return SEO metadata:
${mainCharacterName ? `12. Main character name: ${mainCharacterName}. Keep this character consistent across scenes.` : ''}
${mainCharacterLook ? `13. Main character look: ${mainCharacterLook}. Carry these visual details across scenes.` : ''}
${supportingCharacters.length > 0 ? `14. Supporting characters: ${supportingCharacters.join(', ')}.` : ''}
15. Preferred transition style between scenes: ${transitionStyle}.
16. Recommended narration voice mood: ${recommendedVoice}.
   - headline
   - metaTitle (max 60 characters)
   - metaDescription (150-160 characters)
   - primaryKeyword
   - secondaryKeywords
   - targetKeywords
   - cta
   - seoScore
   - tone

Return JSON:
{
  "hook": "...",
  "body": "...",
  "cta": "...",
  "visualPrompts": ["..."],
  "duration": ${duration},
  "seoMetadata": {
    "headline":"...",
    "metaTitle":"...",
    "metaDescription":"...",
    "primaryKeyword":"...",
    "secondaryKeywords":["..."],
    "targetKeywords":["..."],
    "cta":"...",
    "seoScore":89,
    "tone":"Professional, persuasive, human-like"
  },
  "scenes": [
    {
      "scene": 1,
      "duration": 8,
      "narration": "...",
      "overlay": "...",
      "image_prompt": "...",
      "video_prompt": "..."
    }
  ]
}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            hook: { type: Type.STRING },
            body: { type: Type.STRING },
            cta: { type: Type.STRING },
            visualPrompts: { type: Type.ARRAY, items: { type: Type.STRING } },
            duration: { type: Type.NUMBER },
            seoMetadata: {
              type: Type.OBJECT,
              properties: {
                headline: { type: Type.STRING },
                metaTitle: { type: Type.STRING },
                metaDescription: { type: Type.STRING },
                primaryKeyword: { type: Type.STRING },
                secondaryKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                targetKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                cta: { type: Type.STRING },
                seoScore: { type: Type.NUMBER },
                tone: { type: Type.STRING }
              },
              required: ["headline", "metaTitle", "metaDescription", "primaryKeyword", "secondaryKeywords", "targetKeywords", "cta", "seoScore", "tone"]
            },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  scene: { type: Type.NUMBER },
                  duration: { type: Type.NUMBER },
                  narration: { type: Type.STRING },
                  overlay: { type: Type.STRING },
                  image_prompt: { type: Type.STRING },
                  video_prompt: { type: Type.STRING }
                },
                required: ["scene", "duration", "narration", "overlay", "image_prompt", "video_prompt"]
              }
            }
          },
          required: ["hook", "body", "cta", "visualPrompts", "duration", "seoMetadata", "scenes"]
        }
      }
    });

    const result = JSON.parse(response.text);
    if (!result.scenes || result.scenes.length === 0) {
      return createStoryFallback(storyIdea, duration, language);
    }

    const normalizedScenes = Array.from({ length: storyPlan.targetScenes }, (_, index) => {
      const existingScene = result.scenes[index] || result.scenes[result.scenes.length - 1] || {};
      const beat = storyPlan.beats[index];
      const fallbackNarration = index === 0
        ? `This is how ${storyIdea} began.`
        : index === storyPlan.targetScenes - 1
          ? `And that is how the story of ${storyIdea} ends.`
          : `${storyIdea} moves through ${beat}.`;

      return {
        scene: index + 1,
        duration: storyPlan.timings[index],
        narration: (existingScene.narration || fallbackNarration).trim(),
        overlay: (existingScene.overlay || beat.toUpperCase()).trim(),
        image_prompt: (existingScene.image_prompt || `${visualStyle} cinematic scene about ${storyIdea}, ${beat}, ${mood} mood, consistent character design, film still quality`).trim(),
        video_prompt: (existingScene.video_prompt || `${visualStyle} cinematic scene about ${storyIdea}, ${beat}, ${mood} mood, subtle camera movement, film still quality`).trim(),
        title: typeof existingScene.title === 'string' ? existingScene.title.trim() : '',
        storyBeat: beat,
        emotion: typeof existingScene.emotion === 'string' ? existingScene.emotion.trim() : '',
        voice_hint: typeof existingScene.voice_hint === 'string' ? existingScene.voice_hint.trim() : recommendedVoice,
        transition: typeof existingScene.transition === 'string' ? existingScene.transition.trim() : transitionStyle,
        characters: supportingCharacters.length > 0
          ? [mainCharacterName || 'Main Character', ...supportingCharacters].filter(Boolean)
          : (mainCharacterName ? [mainCharacterName] : [])
      };
    });

    const seoMetadata = normalizeSeoMetadata(result.seoMetadata, {
      headline: result.hook || `${storyIdea} Story Video`,
      metaTitle: `${storyIdea} story video`.slice(0, 60),
      metaDescription: `Watch a cinematic AI-generated story about ${storyIdea} with realistic visuals and emotional pacing.`.slice(0, 160),
      primaryKeyword: storyIdea,
      secondaryKeywords: ['story video', 'cinematic storytelling', 'ai story reel'],
      targetKeywords: [storyIdea, `${storyIdea} story video`, `${storyIdea} cinematic reel`],
      cta: result.cta || 'Watch the full story',
      seoScore: 89
    });

    return {
      hook: result.hook || normalizedScenes[0]?.narration || '',
      body: result.body || normalizedScenes.slice(1, -1).map((scene) => scene.narration).join(' '),
      cta: result.cta || normalizedScenes[normalizedScenes.length - 1]?.narration || '',
      visualPrompts: normalizedScenes.map((scene) => scene.image_prompt),
      duration,
      language,
      seoMetadata,
      storyProfile: {
        premise: storyIdea,
        hook: result.hook || normalizedScenes[0]?.narration || '',
        conflict: normalizedScenes.find((scene) => scene.storyBeat === 'conflict' || scene.storyBeat === 'rising stakes')?.narration || '',
        emotionalPeaks: normalizedScenes.filter((scene) => scene.storyBeat === 'emotional peak' || scene.storyBeat === 'twist').map((scene) => scene.narration),
        ending: result.cta || normalizedScenes[normalizedScenes.length - 1]?.narration || '',
        style: `${genre} / ${visualStyle}`,
        musicMood: mood,
        mainCharacterName,
        mainCharacterLook,
        supportingCharacters,
        transitionStyle,
        recommendedVoice
      },
      scenes: normalizedScenes
    };
  });
}

/**
 * Create fallback Reels script if AI fails
 */
function createReelsFallback(reelIdea: string, duration: number): AdScript {
  const scenePlan = duration <= 15
    ? { count: 4, timings: [4, 4, 4, 3], labels: ['hook', 'point', 'point', 'cta'] }
    : duration <= 30
      ? { count: 5, timings: [6, 6, 6, 6, 6], labels: ['hook', 'point', 'point', 'point', 'cta'] }
      : { count: 7, timings: [8, 8, 9, 9, 9, 9, 8], labels: ['hook', 'point', 'point', 'point', 'point', 'point', 'cta'] };
  const sceneCount = scenePlan.count;
  
  const scenes = [];
  for (let i = 0; i < sceneCount; i++) {
    let narration = '';
    let overlay = '';
    
    switch (i) {
      case 0: // Hook
        narration = `Stop scrolling! Here's what you need to know about ${reelIdea}.`;
        overlay = 'STOP HERE';
        break;
      case 1: // Point 1
        narration = `Point #1: This is a game-changer for ${reelIdea}.`;
        overlay = 'POINT 1';
        break;
      case 2: // Point 2
        narration = `Point #2: Don't miss this insider tip about ${reelIdea}.`;
        overlay = 'POINT 2';
        break;
      case 3: // CTA
        narration = `Follow for more! Like and share if this helped!`;
        overlay = 'FOLLOW ME';
        break;
    }
    
    scenes.push({
      scene: i + 1,
      duration: scenePlan.timings[i],
      narration,
      overlay,
      image_prompt: `Vertical 9:16 social media content about ${reelIdea}, mobile format, portrait orientation, centered subject, professional advertisement style, cinematic lighting, trendy and engaging`,
      video_prompt: `Dynamic vertical video about ${reelIdea}, 9:16 aspect ratio, portrait mobile format, social media trending style, high energy`
    });
  }
  
  return {
    hook: scenes[0].narration,
    body: scenes.slice(1, -1).map(s => s.narration).join(' '),
    cta: scenes[scenes.length - 1].narration,
    visualPrompts: scenes.map(s => s.image_prompt),
    duration,
    language: 'english',
    scenes
  };
}

/**
 * Create fallback YouTube script if AI fails
 */
function createYouTubeFallback(topic: string, duration: number, visualStyle: string = 'realistic'): AdScript {
  const scenePlan = buildYouTubeScenePlan(duration);
  const characterProfiles = buildDefaultCharacterProfiles(topic, visualStyle);
  const storyProfile = buildYouTubeStoryProfile(topic, visualStyle);

  const scenes: Scene[] = scenePlan.beats.map((beat, index) => {
    const title =
      beat === 'hook'
        ? `Why ${topic} Changes Everything`
        : beat === 'ending'
          ? `The Final Reveal`
          : `${beat.replace(/\b\w/g, (match) => match.toUpperCase())}: ${topic}`;
    const narration =
      beat === 'hook'
        ? `What if everything you thought about ${topic} was only the beginning?`
        : beat === 'conflict'
          ? `The real problem with ${topic} appears when the pressure starts rising and the easy answers fail.`
          : beat.includes('peak')
            ? `This is the turning point, where the emotional stakes of ${topic} finally hit hard.`
            : beat === 'ending'
              ? `And that is why the ending of this ${topic} story lands so powerfully.`
              : `This scene pushes the ${topic} story forward with a clear new development.`;
    const visualDescription = `Cinematic ${beat} sequence tied to ${topic} with clear visual continuity.`;
    const characterActions = `The lead character reacts physically to the ${beat} beat and drives the scene forward.`;

    const scene: Scene = {
      scene: index + 1,
      duration: scenePlan.timings[index],
      title,
      narration,
      overlay: title,
      visual_description: visualDescription,
      character_actions: characterActions,
      storyBeat: beat,
      emotion: beat === 'hook' ? 'curious' : beat.includes('peak') ? 'intense' : beat === 'ending' ? 'satisfying' : 'focused',
      characters: [characterProfiles[0].name],
      transition: index === 0 ? 'cold open cut' : 'cinematic dissolve',
      sound_effects: beat.includes('conflict') ? ['distant rumble', 'tense ambience'] : ['soft cinematic ambience'],
      voice_hint: beat === 'hook' ? 'intriguing and urgent' : beat.includes('peak') ? 'emotional and elevated' : 'clear narrator',
      image_prompt: '',
      video_prompt: ''
    };

    scene.image_prompt = buildYouTubeImagePrompt(
      topic,
      visualStyle,
      beat,
      title,
      narration,
      visualDescription,
      characterActions,
      scene.characters || [],
      characterProfiles
    );
    scene.image_variations = [
      `${scene.image_prompt}, hero shot`,
      `${scene.image_prompt}, alternate dramatic angle`
    ];
    scene.video_prompt = buildYouTubeVideoPrompt(scene, visualStyle);
    return scene;
  });

  return {
    hook: scenes[0].narration,
    body: scenes.slice(1, -1).map((scene) => scene.narration).join(' '),
    cta: scenes[scenes.length - 1].narration,
    visualPrompts: scenes.map((scene) => scene.image_prompt),
    duration,
    language: 'english',
    scenes,
    characterProfiles,
    storyProfile,
    youtubeMetadata: {
      title: `${topic}: A Cinematic Story Explained`,
      description: `An AI-crafted cinematic YouTube story about ${topic}, built with a full hook-conflict-payoff structure.`,
      tags: [topic, 'youtube story', 'cinematic ai', visualStyle],
      thumbnailPrompt: buildYouTubeThumbnailPrompt(topic, storyProfile, characterProfiles)
    }
  };
}

/**
 * Validates and fixes the generated script to ensure it meets duration requirements
 */
function validateAndFixScript(script: any, duration: number, minWords: number, maxWords: number): AdScript {
  const plan = buildDurationPlan(duration);

  // Calculate total word count from all narrations
  let totalWords = 0;
  if (script.scenes && Array.isArray(script.scenes)) {
    for (const scene of script.scenes) {
      if (scene.narration) {
        totalWords += scene.narration.split(/\s+/).filter((w: string) => w.length > 0).length;
      }
    }
  }
  
  // Ensure we have valid scenes
  if (!script.scenes || !Array.isArray(script.scenes) || script.scenes.length === 0) {
    // Generate fallback scenes if AI failed
    console.warn('Script validation failed: No scenes generated, creating fallback structure');
    return createFallbackScript(duration, minWords, maxWords);
  }

  if (script.scenes.length !== plan.sceneCount) {
    console.warn(`Script validation: Expected ${plan.sceneCount} scenes, received ${script.scenes.length}. Normalizing scene count.`);
    script.scenes = Array.from({ length: plan.sceneCount }, (_, index) => {
      const existing = script.scenes[index] || script.scenes[script.scenes.length - 1] || {};
      return {
        ...existing,
        scene: index + 1,
        duration: plan.timings[index],
        narration: (existing.narration || '').trim(),
        overlay: (existing.overlay || '').trim(),
        image_prompt: existing.image_prompt || '',
        video_prompt: existing.video_prompt || existing.image_prompt || ''
      };
    });
  }
  
  // Validate word count
  if (totalWords < minWords || totalWords > maxWords) {
    console.warn(`Script validation: Word count ${totalWords} outside range [${minWords}, ${maxWords}], adjusting scenes`);
    script = adjustWordCount(script, duration, minWords, maxWords, totalWords);
  }
  
  // Validate scene durations match total duration
  const sceneDurationTotal = script.scenes.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);
  if (sceneDurationTotal !== duration) {
    console.warn(`Script validation: Scene durations ${sceneDurationTotal} don't match ${duration}, adjusting`);
    script = adjustSceneDurations(script, duration);
  }
  
  // Ensure each scene has required fields
  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    scene.scene = i + 1;
    scene.duration = plan.timings[i] || scene.duration || 5;
    if (!scene.overlay) scene.overlay = '';
    if (!scene.image_prompt) scene.image_prompt = script.visualPrompts?.[i] || '';
    if (!scene.video_prompt) scene.video_prompt = scene.image_prompt + ', cinematic video, dynamic movement';
  }
  
  return {
    hook: script.hook || script.scenes[0]?.narration || '',
    body: script.body || script.scenes.slice(1, -1).map((s: any) => s.narration).join(' '),
    cta: script.cta || script.scenes[script.scenes.length - 1]?.narration || '',
    visualPrompts: script.visualPrompts || script.scenes.map((s: any) => s.image_prompt),
    duration: script.duration || duration,
    language: script.language || 'english',
    scenes: script.scenes
  };
}

/**
 * Adjusts scene word counts to fit within target range
 */
function adjustWordCount(script: any, duration: number, minWords: number, maxWords: number, currentWords: number): any {
  const diff = currentWords - Math.floor((minWords + maxWords) / 2);
  
  if (script.scenes && script.scenes.length > 0) {
    // Distribute adjustment across middle scenes (not first or last)
    const adjustableScenes = script.scenes.slice(1, -1);
    if (adjustableScenes.length > 0) {
      const wordsPerScene = Math.ceil(Math.abs(diff) / adjustableScenes.length);
      
      for (const scene of adjustableScenes) {
        if (diff > 0 && scene.narration) {
          // Too many words, try to shorten
          const words = scene.narration.split(/\s+/);
          if (words.length > wordsPerScene) {
            scene.narration = words.slice(0, -wordsPerScene).join(' ') + '.';
          }
        } else if (diff < 0 && scene.narration) {
          // Too few words, try to expand slightly
          scene.narration += ' ';
        }
      }
    }
  }
  
  return script;
}

/**
 * Adjusts scene durations to match the total duration
 */
function adjustSceneDurations(script: any, targetDuration: number): any {
  if (!script.scenes || script.scenes.length === 0) return script;

  const plan = buildDurationPlan(targetDuration);
  script.scenes = script.scenes.map((scene: any, index: number) => ({
    ...scene,
    duration: plan.timings[index] || scene.duration || 5
  }));
  return script;
}

/**
 * Creates a fallback script if AI generation fails
 */
function createFallbackScript(durationParam: number, minWords: number, maxWords: number): AdScript {
  const sceneCount = durationParam <= 15 ? 3 : durationParam <= 30 ? 4 : 5;
  const targetWords = Math.floor(durationParam * 2.5);
  const wordsPerScene = Math.floor(targetWords / sceneCount);
  
  const scenes: Scene[] = [];
  const hooks = [
    "Ready to transform your business?",
    "Tired of slow results?",
    "What if you could?"
  ];
  const problems = [
    "Most businesses struggle with inefficiency and wasted time.",
    "Traditional solutions cost too much and deliver too little.",
    "You're working harder but not seeing the results you deserve."
  ];
  const solutions = [
    "Our platform streamlines your operations with powerful AI-driven tools.",
    "We combine cutting-edge technology with simple, intuitive design.",
    "Get measurable results in weeks, not months."
  ];
  const ctas = [
    "Start your free trial today at our website.",
    "Visit our website to learn more now.",
    "Click the link to get started instantly."
  ];
  
  for (let i = 0; i < sceneCount; i++) {
    let narration = '';
    let overlay = '';
    
    switch (i) {
      case 0:
        narration = hooks[i % hooks.length];
        overlay = 'GET STARTED';
        break;
      case sceneCount - 1:
        narration = ctas[i % ctas.length];
        overlay = 'ACT NOW';
        break;
      default:
        narration = problems[(i - 1) % problems.length] + ' ' + solutions[(i - 1) % solutions.length];
        overlay = 'LEARN MORE';
    }
    
    const sceneDuration = i === 0 ? 3 : i === sceneCount - 1 ? Math.max(3, durationParam - 3 - (sceneCount - 2) * 3) : 3;
    
    scenes.push({
      scene: i + 1,
      duration: sceneDuration,
      narration: narration,
      overlay: overlay,
      image_prompt: `professional business advertisement scene ${i + 1}, cinematic 16:9`,
      video_prompt: `professional business advertisement scene ${i + 1}, cinematic video, dynamic movement, 16:9 aspect ratio`
    });
  }
  
  return {
    hook: scenes[0]?.narration || '',
    body: scenes.slice(1, -1).map(s => s.narration).join(' '),
    cta: scenes[scenes.length - 1]?.narration || '',
    visualPrompts: scenes.map(s => s.image_prompt),
    duration: durationParam,
    language: 'english',
    scenes: scenes
  };
}

export async function generateAdImage(prompt: string): Promise<string | undefined> {
  const cacheKey = buildAICacheKey('ad-image', { prompt });
  return withAICache(cacheKey, IMAGE_CACHE_TTL_MS, async () => {
    const { value, metadata } = await runWithProviderFallback<string | undefined>([
      {
        name: 'gemini-image',
        retries: 2,
        timeoutMs: 45000,
        retryLabel: 'Gemini image generation',
        run: async () => {
          const ai = getAI();
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: [{ text: prompt }],
            config: {
              imageConfig: {
                aspectRatio: "16:9",
              },
            },
          });

          for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
              return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
          }

          throw new Error('Gemini image response did not include inline image data');
        }
      }
    ]);

    lastImageProviderMetadata = metadata;
    return value;
  });
}

export function getLastImageProviderMetadata(): ProviderExecutionMetadata | null {
  return lastImageProviderMetadata;
}

export async function generateAdImagesConcurrently(prompt: string, count: number = 3): Promise<string[]> {
  const promises = Array.from({ length: count }).map((_, index) => {
    // Modify prompt slightly per variation to ensure distinctness
    return generateAdImage(`${prompt}. Variation ${index + 1} distinct style.`);
  });
  const results = await Promise.all(promises);
  return results.filter((img): img is string => img !== undefined);
}

// Veo video generation interface
export interface VeoVideoResult {
  videoUrl?: string;
  error?: string;
}

/**
 * Generate a video clip using Google's Veo model
 * Uses the correct Veo 3.1 API with async polling
 * @param prompt The video generation prompt
 * @param duration Duration in seconds (5-8 seconds for Veo)
 * @returns Promise resolving to video buffer
 * @throws Error if video generation fails
 */
export async function generateVeoVideo(prompt: string, duration: number = 5): Promise<Buffer | undefined> {
  const ai = getAI();
  const apiKey = process.env.GEMINI_API_KEY;
  const actualDuration = Math.min(Math.max(duration, 5), 8); // Veo supports 5-8 seconds
  
  if (!apiKey) {
    console.error('[Veo API] ERROR: GEMINI_API_KEY not configured');
    throw new Error('GEMINI_API_KEY not configured');
  }
  
  try {
    console.log(`[Veo API] Generating ${actualDuration}s video with prompt: ${prompt.substring(0, 100)}...`);
    console.log(`[Veo API] Model: gemini-2.0-flash-exp-video-01`);
    console.log(`[Veo API] ============================================`);
    
    // Use the SDK to start the video generation operation
    // This returns a long-running operation that we need to poll
    const operation = await ai.models.generateVideos({
      model: "gemini-2.0-flash-exp-video-01",
      prompt: prompt,
      config: {
        numberOfVideos: 1,
      }
    });
    
    console.log(`[Veo API] Operation started, polling for completion...`);
    
    // The SDK should return an operation result. Check if it's done immediately
    // If not, we need to poll for completion using the operation name
    let result = operation as any;
    
    // Check if the operation is already complete
    if (result.done) {
      console.log(`[Veo API] Operation completed immediately`);
    } else if (result.name) {
      // We have an operation name - need to poll
      console.log(`[Veo API] Operation name: ${result.name}, polling for completion...`);
      result = await pollVeoOperation(result.name, apiKey);
    } else {
      // Try to wait a bit and check again
      console.log(`[Veo API] Waiting for operation to complete...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      result = operation as any;
    }
    
    // Check for errors
    if (result.error) {
      throw new Error(`Veo API error: ${result.error.message}`);
    }
    
    // Try different possible response formats
    const possibleVideo = 
      result.video || 
      result.generations?.[0]?.video ||
      result.videoBytes ||
      result.generations?.[0]?.videoBytes;
    
    if (possibleVideo) {
      if (possibleVideo.bytes) {
        console.log(`[Veo API] Video generated successfully: ${possibleVideo.bytes.length} bytes`);
        return Buffer.from(possibleVideo.bytes);
      }
      if (possibleVideo.videoBytes) {
        console.log(`[Veo API] Video generated successfully: ${possibleVideo.videoBytes.length} bytes`);
        return Buffer.from(possibleVideo.videoBytes);
      }
      // If we get a URI, download it
      if (possibleVideo.uri) {
        console.log(`[Veo API] Video URI available: ${possibleVideo.uri}`);
        return await downloadVeoVideo(possibleVideo.uri);
      }
    }
    
    console.error(`[Veo API] No video in response. Result:`, JSON.stringify(result).substring(0, 500));
    return undefined;
  } catch (error: any) {
    console.error(`[Veo API] Video generation failed:`, error.message || error);
    console.error(`[Veo API] Error status:`, error.status);
    console.error(`[Veo API] Error code:`, error.code);
    
    // Check for specific error types
    if (error.status === 403 || error.message?.includes('permission')) {
      console.error(`[Veo API] PERMISSION ERROR: API key may not have Veo access`);
    }
    if (error.status === 404 || error.message?.includes('not found')) {
      console.error(`[Veo API] MODEL ERROR: The video generation model is not available`);
    }
    
    return undefined;
  }
}

/**
 * Poll a Veo operation for completion
 */
async function pollVeoOperation(operationName: string, apiKey: string): Promise<any> {
  const maxAttempts = 120; // Poll for up to 10 minutes (5s * 120)
  const pollInterval = 5000; // 5 seconds between polls
  
  console.log(`[Veo API] Polling operation: ${operationName}`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const operationUrl = `https://generativelanguage.googleapis.com/v1/${operationName}?key=${apiKey}`;
      
      const response = await axios.get(operationUrl, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      
      const status = response.data.done ? 'completed' : 'processing';
      console.log(`[Veo API] Poll attempt ${attempt}/${maxAttempts}: ${status}`);
      
      if (response.data.done) {
        if (response.data.error) {
          throw new Error(`Video generation failed: ${response.data.error.message}`);
        }
        return response.data;
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error: any) {
      console.error(`[Veo API] Poll error:`, error.message);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }
  
  throw new Error('Video generation timed out after 10 minutes');
}

/**
 * Download video from URI
 */
async function downloadVeoVideo(uri: string): Promise<Buffer> {
  console.log(`[Veo API] Downloading video from: ${uri}`);
  
  try {
    const response = await axios({
      url: uri,
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: 300000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      maxRedirects: 5,
    });
    
    console.log(`[Veo API] Video downloaded: ${response.data.length} bytes`);
    return Buffer.from(response.data);
  } catch (error: any) {
    console.error(`[Veo API] Download failed:`, error.message);
    throw new Error(`Failed to download video: ${error.message}`);
  }
}

/**
 * Generate multiple video clips for ad scenes
 * @param scenes Array of scenes with video_prompt and duration
 * @returns Array of video buffers
 * @throws Error if video generation fails (no silent fallback)
 */
export async function generateVeoVideosForScenes(
  scenes: Array<{ video_prompt: string; duration: number }>
): Promise<Buffer[]> {
  console.log(`[Veo] Starting video generation for ${scenes.length} scenes`);
  console.log(`[Veo] API: Google Veo 3 (gemini-2.0-flash-exp-video-01)`);
  console.log(`[Veo] =============================================`);
  
  const videos: Buffer[] = [];
  let hasAnyFailure = false;
  
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    // Veo supports 5-8 second clips, so we cap at 8
    const clipDuration = Math.min(scene.duration, 8);
    
    console.log(`[Veo] Generating scene ${i + 1}/${scenes.length} (${clipDuration}s)...`);
    console.log(`[Veo] Prompt: "${scene.video_prompt.substring(0, 80)}..."`);
    
    try {
      const videoBuffer = await generateVeoVideo(scene.video_prompt, clipDuration);
      
      if (videoBuffer) {
        videos.push(videoBuffer);
        console.log(`[Veo] Scene ${i + 1} generated successfully (${videoBuffer.length} bytes)`);
      } else {
        console.error(`[Veo] Scene ${i + 1} FAILED: No video returned from API`);
        hasAnyFailure = true;
      }
    } catch (error: any) {
      console.error(`[Veo] Scene ${i + 1} FAILED with error:`, error.message || error);
      hasAnyFailure = true;
    }
  }
  
  // STRICT: If any scene failed, we don't return partial results - we throw an error
  // This ensures NO SILENT FALLBACK to image slideshow
  if (hasAnyFailure || videos.length !== scenes.length) {
    const errorMsg = `[Veo] VIDEO GENERATION FAILED: Only ${videos.length}/${scenes.length} clips generated successfully. Cannot proceed with realistic video mode.`;
    console.error(`[Veo] =============================================`);
    console.error(errorMsg);
    console.error(`[Veo] =============================================`);
    throw new Error(errorMsg);
  }
  
  console.log(`[Veo] SUCCESS: All ${videos.length} video clips generated`);
  console.log(`[Veo] =============================================`);
  
  return videos;
}
