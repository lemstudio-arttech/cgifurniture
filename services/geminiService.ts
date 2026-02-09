
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { RenderParameters, ProductImage, StagingParameters, CameraAngle } from "../types";

export class GeminiService {
  private readonly MODEL_NAME = 'gemini-2.5-flash-image';
  private readonly MAX_RETRIES = 3;
  private readonly INITIAL_RETRY_DELAY = 2000;

  private getApiKey(): string {
    const key = process.env.API_KEY;
    if (!key) {
      throw new Error("API_KEY_MISSING: Chưa tìm thấy API_KEY. Hãy cấu hình trong mục Settings > Secrets and variables > Actions trên GitHub.");
    }
    return key;
  }

  private async processImage(url: string, maxWidth = 1024): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = (maxWidth / width) * height;
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject("Could not get canvas context");
        ctx.drawImage(img, 0, 0, width, height);
        const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        resolve(base64);
      };
      img.onerror = () => reject("Không thể tải hình ảnh. Vui lòng kiểm tra lại file.");
      img.src = url;
    });
  }

  private async callWithRetry(fn: () => Promise<GenerateContentResponse>): Promise<GenerateContentResponse> {
    let lastError: any;
    for (let i = 0; i <= this.MAX_RETRIES; i++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        if (error?.status === 429 && i < this.MAX_RETRIES) {
          const delay = this.INITIAL_RETRY_DELAY * Math.pow(2, i);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        if (error?.status === 401) {
          throw new Error("API_KEY_INVALID: API Key không hợp lệ trong GitHub Secrets.");
        }
        throw error;
      }
    }
    throw lastError;
  }

  public async renderProduct(
    product: ProductImage,
    params: RenderParameters,
    referenceImage?: string
  ): Promise<string | undefined> {
    const ai = new GoogleGenAI({ apiKey: this.getApiKey() });
    const productBase64 = await this.processImage(product.originalUrl);
    
    const systemPrompt = `
      Professional CGI Product Rendering.
      Product: ${product.viewType} view.
      Environment: ${params.roomType}.
      Style: ${params.designStyle}.
      Lighting: ${params.lightingEnv}, ${params.lightingDirection} direction.
      Mood: ${params.mood}.
      Task: Place the product naturally in the scene with realistic shadows and materials.
      ${referenceImage ? "CRITICAL: Emulate the EXACT visual style from the provided MOOD BOARD image." : ""}
    `.trim();

    let parts: any[] = [
      { inlineData: { mimeType: 'image/jpeg', data: productBase64 } }
    ];

    if (referenceImage) {
      const refBase64 = await this.processImage(referenceImage);
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: refBase64 } });
    }

    parts.push({ text: systemPrompt });

    try {
      const result = await this.callWithRetry(() => 
        ai.models.generateContent({
          model: this.MODEL_NAME,
          contents: { parts },
        })
      );
      for (const part of result.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) return `data:image/jpeg;base64,${part.inlineData.data}`;
      }
    } catch (error) { throw error; }
    return undefined;
  }

  public async stageRoom(
    products: ProductImage[],
    params: StagingParameters,
    angle: CameraAngle,
    referenceImage?: string,
    masterShotUrl?: string
  ): Promise<string | undefined> {
    const ai = new GoogleGenAI({ apiKey: this.getApiKey() });
    const productParts = await Promise.all(products.map(async (p) => {
      const base64 = await this.processImage(p.originalUrl, 800);
      return { inlineData: { mimeType: 'image/jpeg', data: base64 } };
    }));

    const isSubShot = !!masterShotUrl;
    
    const angleDescription = {
      [CameraAngle.WIDE]: "Panoramic wide shot.",
      [CameraAngle.MEDIUM]: "Medium range shot.",
      [CameraAngle.CLOSEUP]: "Macro-style detail shot.",
      [CameraAngle.TOP_DOWN]: "BIRD'S EYE VIEW.",
      [CameraAngle.SIDE_PERSPECTIVE]: "Diagonal 45-degree view.",
      [CameraAngle.DETAIL_MACRO]: "Extreme close-up."
    }[angle] || angle;

    const systemPrompt = `
      Professional Interior CGI Staging.
      ${isSubShot ? "SPATIAL CHANGE: MOVE CAMERA. Keep same room but different angle." : "ESTABLISH MASTER SHOT."}
      Atmosphere: ${params.mood}. Style: ${params.designStyle}. Lighting: ${params.lightingEnv}.
      Current Camera Angle: ${angleDescription}.
    `.trim();

    let parts: any[] = [];
    
    if (isSubShot && masterShotUrl) {
      const masterBase64 = await this.processImage(masterShotUrl);
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: masterBase64 } });
    } else if (referenceImage) {
      const refBase64 = await this.processImage(referenceImage);
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: refBase64 } });
    }

    parts.push(...productParts);
    parts.push({ text: systemPrompt });

    try {
      const result = await this.callWithRetry(() => 
        ai.models.generateContent({
          model: this.MODEL_NAME,
          contents: { parts },
        })
      );
      for (const part of result.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) return `data:image/jpeg;base64,${part.inlineData.data}`;
      }
    } catch (error) { throw error; }
    return undefined;
  }

  public async editImage(imageUrl: string, prompt: string): Promise<string | undefined> {
    const ai = new GoogleGenAI({ apiKey: this.getApiKey() });
    const base64 = await this.processImage(imageUrl);
    try {
      const result = await this.callWithRetry(() => 
        ai.models.generateContent({
          model: this.MODEL_NAME,
          contents: {
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: base64 } },
              { text: `Refine this image: ${prompt}.` }
            ],
          },
        })
      );
      for (const part of result.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) return `data:image/jpeg;base64,${part.inlineData.data}`;
      }
    } catch (error) { throw error; }
    return undefined;
  }
}
