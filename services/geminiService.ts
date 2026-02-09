import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { RenderParameters, ProductImage, StagingParameters, CameraAngle } from "../types";

export class GeminiService {
  private readonly MODEL_NAME = 'gemini-3-pro-image-preview';
  private readonly MAX_RETRIES = 2;
  private readonly INITIAL_RETRY_DELAY = 3000;

  private getApiKey(): string {
    const key = process.env.API_KEY;
    if (!key || key === "undefined") {
      throw new Error("API_KEY_MISSING");
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
      img.onerror = () => reject("Không thể xử lý hình ảnh.");
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
        // Nếu lỗi quota hoặc 429, đợi và thử lại (trừ khi là limit 0 hẳn)
        if (error?.status === 429 && i < this.MAX_RETRIES) {
          const delay = this.INITIAL_RETRY_DELAY * Math.pow(2, i);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
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
      Professional CGI Furniture Rendering.
      Task: Create a high-end catalog image.
      Product View: ${product.viewType}.
      Environment: ${params.roomType}.
      Design Style: ${params.designStyle}.
      Lighting: ${params.lightingEnv}, ${params.lightingDirection} source.
      Mood: ${params.mood}.
      Instructions: Place the product in the center of the scene. Ensure physics-accurate shadows, realistic texture mapping, and professional photographic composition.
      ${referenceImage ? "CRITICAL: Emulate the lighting, color grading, and material quality from the provided MOOD BOARD image exactly." : ""}
    `.trim();

    const parts: any[] = [
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
          config: {
            imageConfig: {
              aspectRatio: "1:1",
              imageSize: "1K"
            }
          }
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

    const systemPrompt = `
      Full Scene Professional Interior CGI.
      Atmosphere: ${params.mood}. Style: ${params.designStyle}. Lighting: ${params.lightingEnv}.
      Camera Perspective: ${angle}.
      Goal: Arrange all provided furniture items into a cohesive, aesthetically perfect interior design. 
      Maintain consistent materials and lighting across the entire collection.
    `.trim();

    const parts: any[] = [];
    if (masterShotUrl) {
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
          config: {
            imageConfig: {
              aspectRatio: angle === CameraAngle.WIDE ? "16:9" : "4:3",
              imageSize: "1K"
            }
          }
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
              { text: `Apply professional CGI edit: ${prompt}. Maintain original objects and style.` }
            ],
          },
          config: {
            imageConfig: { imageSize: "1K" }
          }
        })
      );
      for (const part of result.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) return `data:image/jpeg;base64,${part.inlineData.data}`;
      }
    } catch (error) { throw error; }
    return undefined;
  }
}