/**
 * Image Ad Generator Service
 * 
 * Creates 4 high-quality advertisement images per request with:
 * - Ad copy generation (headline, subtext, CTA)
 * - 4 distinct image prompts (product, lifestyle, minimal, bold)
 * - Image generation using Gemini
 * - Text overlay application
 */

import { GoogleGenAI, Type } from "@google/genai";
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// Helper to get fresh AI instance
function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
}

// ============================================================================
// Types
// ============================================================================

export interface ImageAdInput {
  idea: string;
  style: 'modern' | 'minimal' | 'bold' | 'corporate';
  tone: 'professional' | 'energetic' | 'luxury';
  aspectRatio: '1:1' | '4:5' | '9:16';
  productImageUrl?: string;
}

export interface AdCopy {
  headline: string;
  subtext: string;
  cta: string;
}

export interface ImagePrompt {
  variation: number;
  type: 'product' | 'lifestyle' | 'minimal' | 'bold';
  prompt: string;
}

export interface BannerLayout {
  template: 'modern-tech' | 'ecommerce' | 'minimal' | 'bold-marketing';
  headlinePosition: { x: number; y: number; width: number; fontSize: number };
  subtextPosition: { x: number; y: number; width: number; fontSize: number };
  ctaPosition: { x: number; y: number; width: number; fontSize: number };
  logoPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  productPosition: { x: number; y: number; width: number; height: number };
}

export interface AdBanner {
  backgroundImage: string;
  productImage: string;
  headline: string;
  subtext: string;
  cta: string;
  logoText: string;
  logoPosition: BannerLayout['logoPosition'];
  layout: BannerLayout;
  template: BannerLayout['template'];
  aspectRatio: '1:1' | '4:5' | '9:16';
  fallbackPrompt: string;
}

export interface GeneratedImageAd {
  imagePath: string;
  imageUrl: string;
  variation: number;
  type: string;
  banner: AdBanner;
}

export interface ImageAdResult {
  images: GeneratedImageAd[];
  banners: GeneratedImageAd[];
  copy: AdCopy;
  prompts: ImagePrompt[];
  workDir: string;
}

// ============================================================================
// Style Configuration
// ============================================================================

const STYLE_MODIFIERS: Record<string, { lighting: string; background: string; composition: string; colors: string }> = {
  modern: {
    lighting: 'soft studio lighting, professional lighting setup',
    background: 'clean gradient background, abstract geometric shapes, modern UI elements',
    composition: 'centered product, shallow depth of field, premium look',
    colors: 'vibrant colors, gradient overlays, sleek and contemporary'
  },
  minimal: {
    lighting: 'natural daylight, soft diffused lighting',
    background: 'pure white background, clean solid colors, minimalist setting',
    composition: 'generous negative space, centered subject, clean lines',
    colors: 'monochrome, muted tones, subtle color accents'
  },
  bold: {
    lighting: 'dramatic lighting, high contrast, rim lighting',
    background: 'bold solid colors, strong contrast backgrounds, dynamic backdrop',
    composition: 'dynamic angles, full frame product, impactful composition',
    colors: 'saturated colors, high contrast, bold color blocking'
  },
  corporate: {
    lighting: 'professional business lighting, clean and bright',
    background: 'office setting, professional environment, business context',
    composition: 'balanced composition, trustworthy and stable layout',
    colors: 'blue tones, professional palette, trustworthy colors'
  }
};

const ASPECT_RATIOS: Record<string, { ratio: string; description: string }> = {
  '1:1': { ratio: '1:1', description: 'square format, Instagram post, Facebook ad' },
  '4:5': { ratio: '4:5', description: 'portrait format, Instagram feed, Pinterest' },
  '9:16': { ratio: '9:16', description: 'vertical format, Instagram story, mobile ad' }
};

const BANNER_TEMPLATES: Record<ImagePrompt['type'], BannerLayout> = {
  product: {
    template: 'modern-tech',
    headlinePosition: { x: 8, y: 10, width: 52, fontSize: 52 },
    subtextPosition: { x: 8, y: 30, width: 46, fontSize: 24 },
    ctaPosition: { x: 8, y: 78, width: 24, fontSize: 18 },
    logoPosition: 'top-right',
    productPosition: { x: 54, y: 18, width: 40, height: 58 }
  },
  lifestyle: {
    template: 'ecommerce',
    headlinePosition: { x: 8, y: 12, width: 54, fontSize: 48 },
    subtextPosition: { x: 8, y: 34, width: 50, fontSize: 22 },
    ctaPosition: { x: 8, y: 80, width: 26, fontSize: 18 },
    logoPosition: 'top-left',
    productPosition: { x: 56, y: 24, width: 34, height: 52 }
  },
  minimal: {
    template: 'minimal',
    headlinePosition: { x: 10, y: 14, width: 48, fontSize: 44 },
    subtextPosition: { x: 10, y: 32, width: 44, fontSize: 20 },
    ctaPosition: { x: 10, y: 72, width: 22, fontSize: 17 },
    logoPosition: 'bottom-left',
    productPosition: { x: 58, y: 16, width: 28, height: 42 }
  },
  bold: {
    template: 'bold-marketing',
    headlinePosition: { x: 8, y: 10, width: 56, fontSize: 58 },
    subtextPosition: { x: 8, y: 36, width: 48, fontSize: 24 },
    ctaPosition: { x: 8, y: 80, width: 28, fontSize: 19 },
    logoPosition: 'bottom-right',
    productPosition: { x: 52, y: 20, width: 40, height: 60 }
  }
};

// ============================================================================
// Step 1: Generate Ad Copy
// ============================================================================

export async function generateAdCopy(product: string, tone: string): Promise<AdCopy> {
  const ai = getAI();
  
  const toneGuidance = tone === 'professional' 
    ? 'Use professional, trustworthy language that builds credibility.'
    : tone === 'energetic'
    ? 'Use energetic, enthusiastic language that excites and motivates.'
    : 'Use sophisticated, elegant language that conveys exclusivity and premium value.';

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate advertising copy for an image advertisement.
    
    PRODUCT/IDEA: ${product}
    TONE: ${tone}
    
    ${toneGuidance}
    
    Create:
    1. HEADLINE (max 6 words): Catchy, attention-grabbing headline that sparks interest
    2. SUBTEXT (max 15 words): Brief value proposition or supporting statement
    3. CTA (2-4 words): Clear call-to-action like "Shop Now", "Learn More", "Get Started", "Sign Up Free", "Discover More"
    
    Requirements:
    - NO website URLs in the copy
    - Professional marketing language
    - Memorable and impactful
    - No emojis in headline (optional in subtext)
    
    Return JSON:
    {
      "headline": "...",
      "subtext": "...",
      "cta": "..."
    }`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headline: { type: Type.STRING },
          subtext: { type: Type.STRING },
          cta: { type: Type.STRING }
        },
        required: ["headline", "subtext", "cta"]
      }
    }
  });

  const result = JSON.parse(response.text);
  console.log('[ImageAdGenerator] Generated copy:', result);
  
  return {
    headline: result.headline,
    subtext: result.subtext,
    cta: result.cta
  };
}

// ============================================================================
// Step 2: Create 4 Different Image Prompts
// ============================================================================

export function createImagePrompts(idea: string, style: string, aspectRatio: string): ImagePrompt[] {
  const styleConfig = STYLE_MODIFIERS[style] || STYLE_MODIFIERS.modern;
  const aspectConfig = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['1:1'];
  
  const prompts: ImagePrompt[] = [
    {
      variation: 1,
      type: 'product',
      prompt: `Professional product photography of ${idea}. 
        ${styleConfig.lighting}. 
        ${styleConfig.background}. 
        ${styleConfig.composition}.
        Aspect ratio: ${aspectConfig.description}.
        High-quality commercial photography, sharp focus, detailed product shot.`
    },
    {
      variation: 2,
      type: 'lifestyle',
      prompt: `Lifestyle photography showing ${idea} being used in real-life context.
        ${styleConfig.lighting}.
        Warm, inviting environment, authentic moments.
        ${styleConfig.composition}.
        Aspect ratio: ${aspectConfig.description}.
        Human-centric commercial photography, emotional connection, aspirational lifestyle.`
    },
    {
      variation: 3,
      type: 'minimal',
      prompt: `Minimalist advertising design for ${idea}.
        Clean ${styleConfig.background}.
        ${styleConfig.lighting}.
        Maximum negative space, elegant simplicity.
        ${aspectConfig.description}.
        Studio product shot, white background option, clean commercial advertising.`
    },
    {
      variation: 4,
      type: 'bold',
      prompt: `Bold and dynamic marketing creative for ${idea}.
        ${styleConfig.colors}.
        ${styleConfig.lighting}.
        High-impact visual statement, eye-catching composition.
        ${styleConfig.composition}.
        ${aspectConfig.description}.
        Maximum visual impact, memorable advertising, stand-out design.`
    }
  ];

  console.log('[ImageAdGenerator] Generated 4 image prompts:');
  prompts.forEach(p => console.log(`  [${p.variation}] ${p.type}: ${p.prompt.substring(0, 60)}...`));

  return prompts;
}

function buildBannerAssetPrompts(
  idea: string,
  style: string,
  aspectRatio: string,
  type: ImagePrompt['type']
): { backgroundPrompt: string; productPrompt: string; fallbackPrompt: string } {
  const styleConfig = STYLE_MODIFIERS[style] || STYLE_MODIFIERS.modern;
  const aspectConfig = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['1:1'];
  const sharedBannerPrompt = `Professional advertisement banner, clean layout, product-focused, modern UI, bold typography, marketing design, high conversion ad, ${aspectConfig.ratio}, space for text overlays`;

  return {
    backgroundPrompt: [
      sharedBannerPrompt,
      `Background plate for ${idea}.`,
      `${styleConfig.background}.`,
      `${styleConfig.lighting}.`,
      `${styleConfig.colors}.`,
      type === 'lifestyle' ? 'Environment should feel aspirational and human-centered.' : 'Environment should leave clean negative space for ad copy.'
    ].join(' '),
    productPrompt: [
      sharedBannerPrompt,
      `Isolated hero product or subject for ${idea}.`,
      `${styleConfig.composition}.`,
      `${styleConfig.lighting}.`,
      'Transparent-style clean cutout feel, centered subject, sharp focus, premium commercial detail.'
    ].join(' '),
    fallbackPrompt: [
      sharedBannerPrompt,
      `${idea}.`,
      `${styleConfig.background}.`,
      `${styleConfig.composition}.`,
      'Cinematic lighting, professional ad creative, polished conversion-focused design.'
    ].join(' ')
  };
}

async function saveBannerAsset(
  imageBuffer: Buffer,
  workDir: string,
  name: string
): Promise<string> {
  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir, { recursive: true });
  }

  const imagePath = path.join(workDir, `${name}.png`);
  fs.writeFileSync(imagePath, imageBuffer);
  return `/uploads/${path.basename(workDir)}/${name}.png`;
}

function createBannerStructure(
  idea: string,
  copy: AdCopy,
  aspectRatio: ImageAdInput['aspectRatio'],
  type: ImagePrompt['type'],
  backgroundImage: string,
  productImage: string,
  fallbackPrompt: string
): AdBanner {
  const layout = BANNER_TEMPLATES[type];
  return {
    backgroundImage,
    productImage,
    headline: copy.headline,
    subtext: copy.subtext,
    cta: copy.cta,
    logoText: idea.split(/\s+/).slice(0, 2).join(' ').toUpperCase(),
    logoPosition: layout.logoPosition,
    layout,
    template: layout.template,
    aspectRatio,
    fallbackPrompt
  };
}

// ============================================================================
// Step 3: Generate Image using Gemini
// ============================================================================

export async function generateAdImage(prompt: string, aspectRatio: string): Promise<Buffer | undefined> {
  const ai = getAI();
  
  // Map aspect ratio to Gemini's format
  const geminiRatio = aspectRatio === '9:16' ? '9:16' : aspectRatio === '4:5' ? '4:5' : '1:1';

  try {
    console.log('[ImageAdGenerator] Generating image with prompt:', prompt.substring(0, 80) + '...');
    console.log('[ImageAdGenerator] Aspect ratio:', geminiRatio);
    console.log('[ImageAdGenerator] Using model: gemini-2.5-flash-image');

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
      }],
      config: {
        responseModalities: ['image', 'text']
      }
    });

    // Debug: Log the full response structure
    console.log('[ImageAdGenerator] Response received, candidates:', response.candidates?.length);
    
    // Look for inline data in the response
    const imagePart = response.candidates?.[0]?.content?.parts?.find(
      (part: any) => part.inlineData
    );
    
    if (imagePart?.inlineData) {
      const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
      console.log('[ImageAdGenerator] Image generated, size:', buffer.length, 'bytes');
      return buffer;
    }
    
    // Check for text response (some models return text instead of inlineData)
    const textPart = response.candidates?.[0]?.content?.parts?.find(
      (part: any) => part.text
    );
    if (textPart?.text) {
      console.log('[ImageAdGenerator] Text response received:', textPart.text.substring(0, 200));
    }
    
    console.warn('[ImageAdGenerator] No image in response');
    throw new Error("Image generation failed: No image data in response");
  } catch (error: any) {
    console.error('[ImageAdGenerator] Image generation failed:', error.message);
    throw error;
  }
}

// ============================================================================
// Step 4: Apply Text Overlay to Image (using Canvas approach - saves text as metadata)
// ============================================================================

/**
 * Saves the image and adds text information for overlay
 * The actual text rendering will be done client-side for better quality
 * This function saves the base image and returns paths for client-side overlay
 */
export async function saveImageWithTextOverlay(
  imageBuffer: Buffer,
  workDir: string,
  variation: number,
  adCopy: AdCopy
): Promise<GeneratedImageAd> {
  // Ensure directory exists
  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir, { recursive: true });
  }

  const imagePath = path.join(workDir, `ad_image_${variation}.png`);
  fs.writeFileSync(imagePath, imageBuffer);

  const imageUrl = `/uploads/${path.basename(workDir)}/ad_image_${variation}.png`;

  console.log('[ImageAdGenerator] Saved image:', imagePath);

  return {
    imagePath,
    imageUrl,
    variation,
    type: ['product', 'lifestyle', 'minimal', 'bold'][variation - 1],
    banner: {
      backgroundImage: imageUrl,
      productImage: imageUrl,
      headline: adCopy.headline,
      subtext: adCopy.subtext,
      cta: adCopy.cta,
      logoText: 'BRAND',
      logoPosition: 'top-right',
      layout: BANNER_TEMPLATES[['product', 'lifestyle', 'minimal', 'bold'][variation - 1] as ImagePrompt['type']],
      template: BANNER_TEMPLATES[['product', 'lifestyle', 'minimal', 'bold'][variation - 1] as ImagePrompt['type']].template,
      aspectRatio: '1:1',
      fallbackPrompt: ''
    }
  };
}

// ============================================================================
// Main Pipeline: Generate 4 Image Ads
// ============================================================================

export async function generateImageAds(input: ImageAdInput): Promise<ImageAdResult> {
  const { idea, style, tone, aspectRatio, productImageUrl } = input;
  
  console.log('[ImageAdGenerator] ============================================');
  console.log('[ImageAdGenerator] Starting Image Ad Generation Pipeline');
  console.log('[ImageAdGenerator] ============================================');
  console.log('[ImageAdGenerator] Input:', { idea, style, tone, aspectRatio });
  
  // Step 1: Generate Ad Copy
  console.log('[ImageAdGenerator] Step 1: Generating ad copy...');
  const adCopy = await generateAdCopy(idea, tone);
  console.log('[ImageAdGenerator] Ad copy generated:', adCopy);

  // Step 2: Create 4 Image Prompts
  console.log('[ImageAdGenerator] Step 2: Creating 4 image prompts...');
  const prompts = createImagePrompts(idea, style, aspectRatio);

  // Step 3: Generate 4 structured banners (in parallel)
  console.log('[ImageAdGenerator] Step 3: Generating 4 structured banners in parallel...');
  
  // Create work directory
  const workDir = path.join(process.cwd(), 'public', 'uploads', uuidv4());
  fs.mkdirSync(workDir, { recursive: true });

  // Generate all 4 images in parallel
  const imagePromises = prompts.map(async (prompt, index) => {
    try {
      const assetPrompts = buildBannerAssetPrompts(idea, style, aspectRatio, prompt.type);
      const [backgroundBuffer, productBuffer] = await Promise.all([
        generateAdImage(assetPrompts.backgroundPrompt, aspectRatio),
        productImageUrl ? Promise.resolve(undefined) : generateAdImage(assetPrompts.productPrompt, aspectRatio)
      ]);

      const fallbackBuffer = backgroundBuffer || productBuffer || await generateAdImage(assetPrompts.fallbackPrompt, aspectRatio);

      if (!fallbackBuffer) {
        throw new Error(`Failed to generate banner assets for variation ${index + 1}`);
      }

      const backgroundImageUrl = backgroundBuffer
        ? await saveBannerAsset(backgroundBuffer, workDir, `banner_bg_${index + 1}`)
        : await saveBannerAsset(fallbackBuffer, workDir, `banner_bg_${index + 1}`);
      const finalProductImageUrl = productImageUrl
        ? productImageUrl
        : productBuffer
          ? await saveBannerAsset(productBuffer, workDir, `banner_product_${index + 1}`)
          : backgroundImageUrl;
      const previewImageUrl = await saveBannerAsset(fallbackBuffer, workDir, `ad_image_${index + 1}`);

      const result: GeneratedImageAd = {
        imagePath: path.join(workDir, `ad_image_${index + 1}.png`),
        imageUrl: previewImageUrl,
        variation: index + 1,
        type: prompt.type,
        banner: createBannerStructure(
          idea,
          adCopy,
          aspectRatio,
          prompt.type,
          backgroundImageUrl,
          finalProductImageUrl,
          assetPrompts.fallbackPrompt
        )
      };

      console.log(`[ImageAdGenerator] Image ${index + 1} generated successfully`);
      return result;
    } catch (error: any) {
      console.error(`[ImageAdGenerator] Image ${index + 1} generation failed:`, error.message);
      throw error;
    }
  });

  const generatedImages = await Promise.all(imagePromises);

  console.log('[ImageAdGenerator] ============================================');
  console.log('[ImageAdGenerator] All 4 images generated successfully!');
  console.log('[ImageAdGenerator] ============================================');

  return {
    images: generatedImages,
    banners: generatedImages,
    copy: adCopy,
    prompts,
    workDir
  };
}

// ============================================================================
// Helper: Regenerate Single Image
// ============================================================================

export async function regenerateSingleImage(
  input: ImageAdInput,
  variation: number
): Promise<GeneratedImageAd> {
  const prompts = createImagePrompts(input.idea, input.style, input.aspectRatio);
  const prompt = prompts[variation - 1];
  
  const workDir = path.join(process.cwd(), 'public', 'uploads', uuidv4());
  fs.mkdirSync(workDir, { recursive: true });

  const adCopy = await generateAdCopy(input.idea, input.tone);
  const assetPrompts = buildBannerAssetPrompts(input.idea, input.style, input.aspectRatio, prompt.type);
  const [backgroundBuffer, productBuffer] = await Promise.all([
    generateAdImage(assetPrompts.backgroundPrompt, input.aspectRatio),
    input.productImageUrl ? Promise.resolve(undefined) : generateAdImage(assetPrompts.productPrompt, input.aspectRatio)
  ]);
  const fallbackBuffer = backgroundBuffer || productBuffer || await generateAdImage(assetPrompts.fallbackPrompt, input.aspectRatio);

  if (!fallbackBuffer) {
    throw new Error('Failed to regenerate banner');
  }

  const backgroundImageUrl = backgroundBuffer
    ? await saveBannerAsset(backgroundBuffer, workDir, `banner_bg_${variation}`)
    : await saveBannerAsset(fallbackBuffer, workDir, `banner_bg_${variation}`);
  const finalProductImageUrl = input.productImageUrl
    ? input.productImageUrl
    : productBuffer
      ? await saveBannerAsset(productBuffer, workDir, `banner_product_${variation}`)
      : backgroundImageUrl;
  const previewImageUrl = await saveBannerAsset(fallbackBuffer, workDir, `ad_image_${variation}`);

  return {
    imagePath: path.join(workDir, `ad_image_${variation}.png`),
    imageUrl: previewImageUrl,
    variation,
    type: prompt.type,
    banner: createBannerStructure(
      input.idea,
      adCopy,
      input.aspectRatio,
      prompt.type,
      backgroundImageUrl,
      finalProductImageUrl,
      assetPrompts.fallbackPrompt
    )
  };
}
