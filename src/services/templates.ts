import type { SupportedLanguage } from "./gemini";

export type TemplateContentType = "ads" | "reels" | "youtube" | "story" | "image-ads";

export interface StartupTemplate {
  id: string;
  name: string;
  description: string;
  contentType: TemplateContentType;
  topicPlaceholder: string;
  suggestedDuration?: number;
  suggestedLanguage?: SupportedLanguage;
  suggestedTone?: string;
  suggestedVisualStyle?: "realistic" | "cartoon" | "anime";
  suggestedReelsMode?: "realistic" | "image";
  suggestedStoryGenre?: "cinematic" | "motivational" | "emotional" | "suspense" | "kids";
  suggestedStoryMood?: "hopeful" | "dramatic" | "inspiring" | "mysterious" | "heartwarming";
  suggestedStoryVisualStyle?: "realistic" | "stylized" | "dreamy";
}

export const STARTUP_TEMPLATES: StartupTemplate[] = [
  {
    id: "local-business-offer",
    name: "Local Business Offer",
    description: "Promote a discount, new service, or neighborhood campaign with a direct CTA.",
    contentType: "ads",
    topicPlaceholder: "Weekend offer for your business",
    suggestedDuration: 30,
    suggestedLanguage: "english",
    suggestedTone: "high-converting local promotion"
  },
  {
    id: "festival-reel",
    name: "Festival Reel",
    description: "Fast-moving seasonal promo for Indian audiences with a strong celebratory hook.",
    contentType: "reels",
    topicPlaceholder: "Festival offer for my business",
    suggestedDuration: 15,
    suggestedLanguage: "hindi",
    suggestedReelsMode: "image",
    suggestedTone: "festive and energetic"
  },
  {
    id: "product-launch",
    name: "Product Launch",
    description: "Highlight a new product with problem-solution positioning and premium visuals.",
    contentType: "ads",
    topicPlaceholder: "Launch campaign for our new product",
    suggestedDuration: 30,
    suggestedLanguage: "english",
    suggestedTone: "premium product launch"
  },
  {
    id: "explainer-youtube",
    name: "Explainer Video",
    description: "Educational YouTube script structure for benefits, features, and practical takeaways.",
    contentType: "youtube",
    topicPlaceholder: "Explain how our product works",
    suggestedDuration: 300,
    suggestedLanguage: "english",
    suggestedVisualStyle: "realistic",
    suggestedTone: "clear educational explainer"
  },
  {
    id: "cinematic-story",
    name: "Cinematic Story",
    description: "Turn a short title or plot idea into a realistic, emotionally paced story video.",
    contentType: "story",
    topicPlaceholder: "A story about a forgotten letter that changes a life",
    suggestedDuration: 45,
    suggestedLanguage: "english",
    suggestedTone: "cinematic emotional storytelling",
    suggestedStoryGenre: "cinematic",
    suggestedStoryMood: "dramatic",
    suggestedStoryVisualStyle: "realistic"
  },
  {
    id: "motivational-story",
    name: "Motivational Story",
    description: "Short inspirational story arc with a strong emotional payoff and uplifting narration.",
    contentType: "story",
    topicPlaceholder: "A delivery boy who studies at night to change his future",
    suggestedDuration: 60,
    suggestedLanguage: "hindi",
    suggestedTone: "motivational cinematic storytelling",
    suggestedStoryGenre: "motivational",
    suggestedStoryMood: "inspiring",
    suggestedStoryVisualStyle: "realistic"
  },
  {
    id: "kids-story",
    name: "Kids Story",
    description: "Gentle story flow with soft pacing, simple narration, and friendly visuals.",
    contentType: "story",
    topicPlaceholder: "A little bird learning to fly for the first time",
    suggestedDuration: 45,
    suggestedLanguage: "english",
    suggestedTone: "warm family storytelling",
    suggestedStoryGenre: "kids",
    suggestedStoryMood: "heartwarming",
    suggestedStoryVisualStyle: "dreamy"
  },
  {
    id: "social-image-ad",
    name: "Social Image Ad",
    description: "Single-image ad with headline, offer, and CTA for paid campaigns or social posts.",
    contentType: "image-ads",
    topicPlaceholder: "Create a social ad for my product",
    suggestedLanguage: "english",
    suggestedTone: "direct response social campaign"
  }
];

export function getTemplatesForContentType(contentType: TemplateContentType) {
  return STARTUP_TEMPLATES.filter((template) => template.contentType === contentType);
}
