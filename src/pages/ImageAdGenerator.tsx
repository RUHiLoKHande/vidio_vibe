import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { 
  Sparkles, 
  Image as ImageIcon, 
  Download, 
  RefreshCw, 
  Loader2,
  ArrowLeft,
  Palette,
  RectangleHorizontal,
  MessageSquare,
  Upload
} from "lucide-react";

// Types
interface AdCopy {
  headline: string;
  subtext: string;
  cta: string;
}

interface GeneratedImage {
  url: string;
  variation: number;
  type: string;
  banner: BannerModel;
}

interface BannerLayoutPosition {
  x: number;
  y: number;
  width: number;
  fontSize: number;
}

interface BannerLayout {
  template: "modern-tech" | "ecommerce" | "minimal" | "bold-marketing";
  headlinePosition: BannerLayoutPosition;
  subtextPosition: BannerLayoutPosition;
  ctaPosition: BannerLayoutPosition;
  logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  productPosition: { x: number; y: number; width: number; height: number };
}

interface BannerModel {
  backgroundImage: string;
  productImage: string;
  headline: string;
  subtext: string;
  cta: string;
  logoText: string;
  logoPosition: BannerLayout["logoPosition"];
  layout: BannerLayout;
  template: BannerLayout["template"];
  aspectRatio: "1:1" | "4:5" | "9:16";
  fallbackPrompt: string;
}

interface ImageAdGeneratorProps {
  user: any;
}

export function ImageAdGenerator({ user }: ImageAdGeneratorProps) {
  const navigate = useNavigate();
  
  // Form state
  const [idea, setIdea] = useState("");
  const [style, setStyle] = useState<"modern" | "minimal" | "bold" | "corporate">("modern");
  const [tone, setTone] = useState<"professional" | "energetic" | "luxury">("professional");
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "4:5" | "9:16">("1:1");
  
  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [adCopy, setAdCopy] = useState<AdCopy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [selectedVariation, setSelectedVariation] = useState<number | null>(null);
  const [uploadedProductUrl, setUploadedProductUrl] = useState<string | null>(null);
  const [uploadingProduct, setUploadingProduct] = useState(false);

  const selectedBanner = useMemo(
    () => generatedImages.find((image) => image.variation === selectedVariation) || generatedImages[0] || null,
    [generatedImages, selectedVariation]
  );

  // Generate 4 Image Ads
  const handleGenerate = async () => {
    if (!idea.trim()) {
      setError("Please enter an idea or product description");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedImages([]);
    setAdCopy(null);

    try {
      console.log("Generating image ads with:", { idea, style, tone, aspectRatio });
      
      const response = await axios.post("/api/image-ads/generate-multiple", {
        idea: idea.trim(),
        style,
        tone,
        aspectRatio,
        productImageUrl: uploadedProductUrl
      });

      console.log("Generation response:", response.data);

      if (response.data.success) {
        const structuredBanners = (response.data.banners || response.data.images || []).map((item: any) => ({
          url: item.url,
          variation: item.variation,
          type: item.type,
          banner: item.banner
        }));
        setGeneratedImages(structuredBanners);
        setSelectedVariation(structuredBanners[0]?.variation ?? null);
        setAdCopy(response.data.copy);
      } else {
        setError(response.data.error || "Failed to generate images");
      }
    } catch (err: any) {
      console.error("Generation error:", err);
      setError(err.response?.data?.error || err.message || "Failed to generate image ads");
    } finally {
      setIsGenerating(false);
    }
  };

  // Regenerate single image
  const handleRegenerate = async (variation: number) => {
    setRegeneratingIndex(variation);
    
    try {
      const response = await axios.post("/api/image-ads/regenerate", {
        idea: idea.trim(),
        style,
        tone,
        aspectRatio,
        variation,
        productImageUrl: uploadedProductUrl
      });

      if (response.data.success) {
        setGeneratedImages(prev => 
          prev.map(img => 
            img.variation === variation 
              ? { ...img, url: response.data.image.url, banner: response.data.image.banner }
              : img
          )
        );
      }
    } catch (err: any) {
      console.error("Regeneration error:", err);
      setError(err.message || "Failed to regenerate image");
    } finally {
      setRegeneratingIndex(null);
    }
  };

  const updateBanner = (variation: number, updater: (banner: BannerModel) => BannerModel) => {
    setGeneratedImages((current) =>
      current.map((image) =>
        image.variation === variation
          ? { ...image, banner: updater(image.banner) }
          : image
      )
    );
  };

  const handleProductUpload = async (file?: File) => {
    if (!file) return;

    setUploadingProduct(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('product', file);
      const response = await axios.post('/api/image-ads/upload-product', formData);
      if (response.data.success) {
        setUploadedProductUrl(response.data.productImageUrl);
      }
    } catch (uploadError: any) {
      console.error('Product upload failed:', uploadError);
      setError(uploadError.response?.data?.error || 'Failed to upload product image');
    } finally {
      setUploadingProduct(false);
    }
  };

  const resolveAssetUrl = (assetUrl: string) =>
    assetUrl.startsWith('http') ? assetUrl : `${window.location.origin}${assetUrl}`;

  const drawBannerToCanvas = async (banner: BannerModel) => {
    const dimensions = banner.aspectRatio === '9:16'
      ? { width: 1080, height: 1920 }
      : banner.aspectRatio === '4:5'
        ? { width: 1080, height: 1350 }
        : { width: 1080, height: 1080 };

    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');

    const loadImage = (src?: string) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        if (!src) {
          resolve(null);
          return;
        }

        const image = new window.Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = resolveAssetUrl(src);
      });

    const [background, product] = await Promise.all([
      loadImage(banner.backgroundImage),
      loadImage(banner.productImage)
    ]);

    if (background) {
      ctx.drawImage(background, 0, 0, dimensions.width, dimensions.height);
    } else {
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, dimensions.width, dimensions.height);
    }

    ctx.fillStyle = 'rgba(7, 12, 25, 0.28)';
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    if (product) {
      const box = banner.layout.productPosition;
      ctx.drawImage(
        product,
        (box.x / 100) * dimensions.width,
        (box.y / 100) * dimensions.height,
        (box.width / 100) * dimensions.width,
        (box.height / 100) * dimensions.height
      );
    }

    const drawTextBlock = (text: string, config: BannerLayoutPosition, color: string, weight: string) => {
      const x = (config.x / 100) * dimensions.width;
      const y = (config.y / 100) * dimensions.height;
      const maxWidth = (config.width / 100) * dimensions.width;
      const fontSize = (config.fontSize / 1000) * dimensions.width;
      ctx.fillStyle = color;
      ctx.font = `${weight} ${fontSize}px Arial`;
      ctx.textBaseline = 'top';

      const words = text.split(' ');
      let line = '';
      let lineY = y;
      const lineHeight = fontSize * 1.15;

      for (const word of words) {
        const testLine = line ? `${line} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && line) {
          ctx.fillText(line, x, lineY);
          line = word;
          lineY += lineHeight;
        } else {
          line = testLine;
        }
      }

      if (line) {
        ctx.fillText(line, x, lineY);
      }
    };

    drawTextBlock(banner.headline, banner.layout.headlinePosition, '#ffffff', '700');
    drawTextBlock(banner.subtext, banner.layout.subtextPosition, 'rgba(255,255,255,0.9)', '500');

    const cta = banner.layout.ctaPosition;
    const ctaX = (cta.x / 100) * dimensions.width;
    const ctaY = (cta.y / 100) * dimensions.height;
    const ctaWidth = (cta.width / 100) * dimensions.width;
    const ctaHeight = Math.max(72, (cta.fontSize / 1000) * dimensions.width * 2.4);
    ctx.fillStyle = '#7c3aed';
    ctx.beginPath();
    ctx.roundRect(ctaX, ctaY, ctaWidth, ctaHeight, 28);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${(cta.fontSize / 1000) * dimensions.width}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner.cta, ctaX + ctaWidth / 2, ctaY + ctaHeight / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.max(28, dimensions.width * 0.025)}px Arial`;
    const logoX = banner.logoPosition.includes('right') ? dimensions.width - 220 : 48;
    const logoY = banner.logoPosition.includes('bottom') ? dimensions.height - 90 : 48;
    ctx.fillText(banner.logoText, logoX, logoY);

    return canvas;
  };

  const handleDownloadBanner = async (image: GeneratedImage) => {
    try {
      const canvas = await drawBannerToCanvas(image.banner);
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `banner_variation_${image.variation}.png`;
      link.click();
    } catch (downloadError) {
      console.error('Banner export error:', downloadError);
      setError('Failed to export banner');
    }
  };

  // Download single image
  const handleDownload = async (imageUrl: string, variation: number) => {
    try {
      const fullUrl = imageUrl.startsWith('http') ? imageUrl : `${window.location.origin}${imageUrl}`;
      const response = await axios.get(fullUrl, { responseType: 'blob' });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `ad_variation_${variation}.png`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Download error:", err);
    }
  };

  const styles = [
    { value: "modern", label: "Modern", desc: "Clean UI, gradients", color: "from-purple-500 to-pink-500" },
    { value: "minimal", label: "Minimal", desc: "White background, simple", color: "from-gray-400 to-gray-600" },
    { value: "bold", label: "Bold", desc: "Strong colors, high contrast", color: "from-orange-500 to-red-500" },
    { value: "corporate", label: "Corporate", desc: "Professional, blue tones", color: "from-blue-500 to-cyan-500" }
  ];

  const tones = [
    { value: "professional", label: "Professional", icon: "💼" },
    { value: "energetic", label: "Energetic", icon: "⚡" },
    { value: "luxury", label: "Luxury", icon: "✨" }
  ];

  const ratios = [
    { value: "1:1", label: "1:1", desc: "Square - Instagram, Facebook" },
    { value: "4:5", label: "4:5", desc: "Portrait - Instagram Feed" },
    { value: "9:16", label: "9:16", desc: "Story - Instagram Stories" }
  ];

  const variationTypes = ["Product Focus", "Lifestyle", "Minimal", "Bold Marketing"];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button 
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </button>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-yellow-400" />
            AI Image Ad Generator
          </h1>
        </div>

        {/* Input Section */}
        <div className="bg-gray-800/50 rounded-2xl p-6 mb-8 border border-gray-700">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2 rounded-2xl border border-purple-500/30 bg-gradient-to-r from-purple-900/30 to-pink-900/20 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-white font-semibold text-lg">Upload Product Image</div>
                  <p className="text-sm text-gray-300 mt-1">
                    Upload your product photo first, then write what kind of advertisement banner you want AI to create around it.
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm">
                  <Upload className="w-4 h-4" />
                  {uploadingProduct ? 'Uploading...' : 'Choose Image'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleProductUpload(e.target.files?.[0])}
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4">
                {uploadedProductUrl ? (
                  <>
                    <div className="h-28 w-28 overflow-hidden rounded-xl border border-gray-600 bg-gray-900">
                      <img src={resolveAssetUrl(uploadedProductUrl)} className="h-full w-full object-contain" alt="Uploaded product" />
                    </div>
                    <div className="space-y-2">
                      <div className="rounded-full bg-green-500/20 px-3 py-1 text-xs font-medium text-green-300">
                        Product image uploaded
                      </div>
                      <button
                        type="button"
                        onClick={() => setUploadedProductUrl(null)}
                        className="rounded-lg border border-gray-500 px-3 py-2 text-sm text-gray-200"
                      >
                        Remove Image
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-600 px-4 py-6 text-sm text-gray-400">
                    No product image selected yet. You can still generate banners without upload.
                  </div>
                )}
              </div>
            </div>

            {/* Idea Input */}
            <div className="md:col-span-2">
              <label className="block text-gray-300 text-sm font-medium mb-2">
                What advertisement do you want to create?
              </label>
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="e.g., Make this shoe look like a premium sports ad, create a luxury skincare banner for this bottle, turn this snack pack into a bold grocery offer..."
                className="w-full bg-gray-700/50 border border-gray-600 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                rows={3}
              />
              <p className="mt-2 text-xs text-gray-400">
                Describe the ad style, headline direction, audience, or mood. The uploaded image will be used as the main product layer.
              </p>
            </div>

            {/* Style Selection */}
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2 flex items-center gap-2">
                <Palette className="w-4 h-4" />
                Style
              </label>
              <div className="grid grid-cols-2 gap-2">
                {styles.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setStyle(s.value as any)}
                    className={`p-3 rounded-xl border transition-all ${
                      style === s.value
                        ? "border-purple-500 bg-purple-500/20 text-white"
                        : "border-gray-600 bg-gray-700/30 text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <div className="font-medium">{s.label}</div>
                    <div className="text-xs opacity-70">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Tone Selection */}
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Tone
              </label>
              <div className="grid grid-cols-3 gap-2">
                {tones.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTone(t.value as any)}
                    className={`p-3 rounded-xl border transition-all ${
                      tone === t.value
                        ? "border-purple-500 bg-purple-500/20 text-white"
                        : "border-gray-600 bg-gray-700/30 text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <span className="text-xl">{t.icon}</span>
                    <div className="font-medium mt-1">{t.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect Ratio */}
            <div className="md:col-span-2">
              <label className="block text-gray-300 text-sm font-medium mb-2 flex items-center gap-2">
                <RectangleHorizontal className="w-4 h-4" />
                Aspect Ratio
              </label>
              <div className="grid grid-cols-3 gap-3">
                {ratios.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setAspectRatio(r.value as any)}
                    className={`p-4 rounded-xl border transition-all ${
                      aspectRatio === r.value
                        ? "border-purple-500 bg-purple-500/20 text-white"
                        : "border-gray-600 bg-gray-700/30 text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <div className="text-lg font-bold">{r.label}</div>
                    <div className="text-xs opacity-70">{r.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !idea.trim()}
            className="w-full mt-6 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold py-4 px-6 rounded-xl transition-all flex items-center justify-center gap-3"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating 4 Image Ads...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Generate 4 Image Ads
              </>
            )}
          </button>

          {/* Error Message */}
          {error && (
            <div className="mt-4 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Results Section */}
        {generatedImages.length > 0 && adCopy && selectedBanner && (
          <div className="space-y-6">
            {/* Ad Copy Display */}
            <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700">
              <h2 className="text-xl font-bold text-white mb-4">Generated Ad Copy</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-700/30 rounded-xl p-4">
                  <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">Headline</div>
                  <div className="text-white font-semibold text-lg">{adCopy.headline}</div>
                </div>
                <div className="bg-gray-700/30 rounded-xl p-4">
                  <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">Subtext</div>
                  <div className="text-white">{adCopy.subtext}</div>
                </div>
                <div className="bg-gray-700/30 rounded-xl p-4">
                  <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">CTA</div>
                  <div className="text-purple-400 font-semibold">{adCopy.cta}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <ImageIcon className="w-5 h-5" />
                  Structured Banner Engine
                </h2>

                <div className="grid grid-cols-2 gap-4">
                  {generatedImages.map((image, index) => (
                    <button
                      key={image.variation}
                      onClick={() => setSelectedVariation(image.variation)}
                      className={`overflow-hidden rounded-2xl border text-left transition-all ${
                        selectedBanner.variation === image.variation
                          ? "border-purple-500 shadow-lg shadow-purple-500/20"
                          : "border-gray-700"
                      } bg-gray-800/50`}
                    >
                      <div className="relative aspect-[4/5] bg-gray-900">
                        <img
                          src={resolveAssetUrl(image.banner.backgroundImage)}
                          alt={`Banner background ${image.variation}`}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                        {image.banner.productImage && (
                          <img
                            src={resolveAssetUrl(image.banner.productImage)}
                            alt={`Banner product ${image.variation}`}
                            className="absolute object-contain"
                            style={{
                              left: `${image.banner.layout.productPosition.x}%`,
                              top: `${image.banner.layout.productPosition.y}%`,
                              width: `${image.banner.layout.productPosition.width}%`,
                              height: `${image.banner.layout.productPosition.height}%`
                            }}
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                        <div className="absolute inset-0 p-4">
                          <div className="text-xs uppercase tracking-[0.3em] text-white/75">{variationTypes[index]}</div>
                          <div className="mt-3 max-w-[60%] text-white text-lg font-bold leading-tight">{image.banner.headline}</div>
                          <div className="mt-2 max-w-[58%] text-xs text-white/85">{image.banner.subtext}</div>
                          <div className="absolute bottom-4 left-4 rounded-full bg-purple-600 px-4 py-2 text-xs font-semibold text-white">
                            {image.banner.cta}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-800/50 rounded-2xl border border-gray-700 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-white">Live Banner Preview</h3>
                      <p className="text-sm text-gray-400">{selectedBanner.banner.template} template • Variation #{selectedBanner.variation}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRegenerate(selectedBanner.variation)}
                        disabled={regeneratingIndex === selectedBanner.variation}
                        className="rounded-lg bg-purple-600 px-3 py-2 text-sm text-white"
                      >
                        {regeneratingIndex === selectedBanner.variation ? 'Regenerating...' : 'Regenerate'}
                      </button>
                      <button
                        onClick={() => handleDownloadBanner(selectedBanner)}
                        className="rounded-lg bg-gray-700 px-3 py-2 text-sm text-white"
                      >
                        Export PNG
                      </button>
                    </div>
                  </div>

                  <div className={`relative overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 ${
                    selectedBanner.banner.aspectRatio === '9:16'
                      ? 'aspect-[9/16]'
                      : selectedBanner.banner.aspectRatio === '4:5'
                        ? 'aspect-[4/5]'
                        : 'aspect-square'
                  }`}>
                    <img src={resolveAssetUrl(selectedBanner.banner.backgroundImage)} className="absolute inset-0 h-full w-full object-cover" />
                    {selectedBanner.banner.productImage && (
                      <img
                        src={resolveAssetUrl(selectedBanner.banner.productImage)}
                        className="absolute object-contain"
                        style={{
                          left: `${selectedBanner.banner.layout.productPosition.x}%`,
                          top: `${selectedBanner.banner.layout.productPosition.y}%`,
                          width: `${selectedBanner.banner.layout.productPosition.width}%`,
                          height: `${selectedBanner.banner.layout.productPosition.height}%`
                        }}
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
                    <div className="absolute text-white font-black leading-[0.95]" style={{
                      left: `${selectedBanner.banner.layout.headlinePosition.x}%`,
                      top: `${selectedBanner.banner.layout.headlinePosition.y}%`,
                      width: `${selectedBanner.banner.layout.headlinePosition.width}%`,
                      fontSize: `${selectedBanner.banner.layout.headlinePosition.fontSize / 14}px`
                    }}>
                      {selectedBanner.banner.headline}
                    </div>
                    <div className="absolute text-white/90" style={{
                      left: `${selectedBanner.banner.layout.subtextPosition.x}%`,
                      top: `${selectedBanner.banner.layout.subtextPosition.y}%`,
                      width: `${selectedBanner.banner.layout.subtextPosition.width}%`,
                      fontSize: `${selectedBanner.banner.layout.subtextPosition.fontSize / 16}px`
                    }}>
                      {selectedBanner.banner.subtext}
                    </div>
                    <div className="absolute rounded-full bg-purple-600 px-4 py-2 text-white font-semibold shadow-lg" style={{
                      left: `${selectedBanner.banner.layout.ctaPosition.x}%`,
                      top: `${selectedBanner.banner.layout.ctaPosition.y}%`,
                      width: `${selectedBanner.banner.layout.ctaPosition.width}%`,
                      fontSize: `${selectedBanner.banner.layout.ctaPosition.fontSize / 18}px`,
                      textAlign: 'center'
                    }}>
                      {selectedBanner.banner.cta}
                    </div>
                    <div className="absolute text-xs font-bold tracking-[0.25em] text-white/90" style={{
                      left: selectedBanner.banner.logoPosition.includes('left') ? '6%' : 'auto',
                      right: selectedBanner.banner.logoPosition.includes('right') ? '6%' : 'auto',
                      top: selectedBanner.banner.logoPosition.includes('top') ? '5%' : 'auto',
                      bottom: selectedBanner.banner.logoPosition.includes('bottom') ? '5%' : 'auto'
                    }}>
                      {selectedBanner.banner.logoText}
                    </div>
                  </div>
                </div>

                <div className="bg-gray-800/50 rounded-2xl border border-gray-700 p-5 space-y-4">
                  <h3 className="text-lg font-bold text-white">Editable Layers</h3>
                  <div className="grid grid-cols-1 gap-3">
                    <input
                      value={selectedBanner.banner.headline}
                      onChange={(e) => updateBanner(selectedBanner.variation, (banner) => ({ ...banner, headline: e.target.value }))}
                      className="rounded-xl border border-gray-600 bg-gray-900 px-4 py-3 text-white"
                      placeholder="Headline"
                    />
                    <textarea
                      value={selectedBanner.banner.subtext}
                      onChange={(e) => updateBanner(selectedBanner.variation, (banner) => ({ ...banner, subtext: e.target.value }))}
                      className="rounded-xl border border-gray-600 bg-gray-900 px-4 py-3 text-white"
                      placeholder="Subtext"
                      rows={2}
                    />
                    <input
                      value={selectedBanner.banner.cta}
                      onChange={(e) => updateBanner(selectedBanner.variation, (banner) => ({ ...banner, cta: e.target.value }))}
                      className="rounded-xl border border-gray-600 bg-gray-900 px-4 py-3 text-white"
                      placeholder="CTA"
                    />
                    <input
                      value={selectedBanner.banner.logoText}
                      onChange={(e) => updateBanner(selectedBanner.variation, (banner) => ({ ...banner, logoText: e.target.value }))}
                      className="rounded-xl border border-gray-600 bg-gray-900 px-4 py-3 text-white"
                      placeholder="Logo text"
                    />
                    <select
                      value={selectedBanner.banner.logoPosition}
                      onChange={(e) => updateBanner(selectedBanner.variation, (banner) => ({ ...banner, logoPosition: e.target.value as BannerLayout["logoPosition"] }))}
                      className="rounded-xl border border-gray-600 bg-gray-900 px-4 py-3 text-white"
                    >
                      <option value="top-left">Logo Top Left</option>
                      <option value="top-right">Logo Top Right</option>
                      <option value="bottom-left">Logo Bottom Left</option>
                      <option value="bottom-right">Logo Bottom Right</option>
                    </select>
                    <button
                      onClick={() => updateBanner(selectedBanner.variation, (banner) => ({ ...banner, productImage: '' }))}
                      className="rounded-xl border border-gray-600 px-4 py-3 text-sm text-gray-200"
                    >
                      Remove Product Layer
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm text-gray-300">
                    <label className="space-y-2">
                      <span>Headline Y</span>
                      <input type="range" min={4} max={40} value={selectedBanner.banner.layout.headlinePosition.y}
                        onChange={(e) => updateBanner(selectedBanner.variation, (banner) => ({ ...banner, layout: { ...banner.layout, headlinePosition: { ...banner.layout.headlinePosition, y: Number(e.target.value) } } }))}
                        className="w-full" />
                    </label>
                    <label className="space-y-2">
                      <span>Headline Size</span>
                      <input type="range" min={32} max={82} value={selectedBanner.banner.layout.headlinePosition.fontSize}
                        onChange={(e) => updateBanner(selectedBanner.variation, (banner) => ({ ...banner, layout: { ...banner.layout, headlinePosition: { ...banner.layout.headlinePosition, fontSize: Number(e.target.value) } } }))}
                        className="w-full" />
                    </label>
                    <label className="space-y-2">
                      <span>CTA X</span>
                      <input type="range" min={4} max={60} value={selectedBanner.banner.layout.ctaPosition.x}
                        onChange={(e) => updateBanner(selectedBanner.variation, (banner) => ({ ...banner, layout: { ...banner.layout, ctaPosition: { ...banner.layout.ctaPosition, x: Number(e.target.value) } } }))}
                        className="w-full" />
                    </label>
                    <label className="space-y-2">
                      <span>CTA Width</span>
                      <input type="range" min={18} max={40} value={selectedBanner.banner.layout.ctaPosition.width}
                        onChange={(e) => updateBanner(selectedBanner.variation, (banner) => ({ ...banner, layout: { ...banner.layout, ctaPosition: { ...banner.layout.ctaPosition, width: Number(e.target.value) } } }))}
                        className="w-full" />
                    </label>
                    <label className="space-y-2">
                      <span>Product X</span>
                      <input type="range" min={30} max={70} value={selectedBanner.banner.layout.productPosition.x}
                        onChange={(e) => updateBanner(selectedBanner.variation, (banner) => ({ ...banner, layout: { ...banner.layout, productPosition: { ...banner.layout.productPosition, x: Number(e.target.value) } } }))}
                        className="w-full" />
                    </label>
                    <label className="space-y-2">
                      <span>Product Size</span>
                      <input type="range" min={20} max={60} value={selectedBanner.banner.layout.productPosition.width}
                        onChange={(e) => updateBanner(selectedBanner.variation, (banner) => ({ ...banner, layout: { ...banner.layout, productPosition: { ...banner.layout.productPosition, width: Number(e.target.value), height: Number(e.target.value) + 12 } } }))}
                        className="w-full" />
                    </label>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* Empty State */}
        {!isGenerating && generatedImages.length === 0 && (
          <div className="text-center py-16">
            <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <ImageIcon className="w-12 h-12 text-gray-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-300 mb-2">
              Ready to Create Stunning Image Ads
            </h3>
            <p className="text-gray-500 max-w-md mx-auto">
              Enter your product or idea above, choose your style and tone, 
              and we'll generate 4 professional ad variations ready for your marketing campaigns.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
