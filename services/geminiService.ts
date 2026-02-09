
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { RenderParameters, ProductImage, StagingParameters, CameraAngle } from "../types";

export class GeminiService {
  private readonly MODEL_NAME = 'gemini-2.5-flash-image';
  private readonly MAX_RETRIES = 3;
  private readonly INITIAL_RETRY_DELAY = 2000;

  private getApiKey(): string {
    const key = process.env.API_KEY;
    if (!key) {
      throw new Error("API_KEY_MISSING: Biến API_KEY chưa được thiết lập trong môi trường (Netlify Environment Variables).");
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
      img.onerror = () => reject("Không thể tải hình ảnh để xử lý. Vui lòng kiểm tra định dạng file.");
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
        // 429: Too Many Requests (Rate limit)
        if (error?.status === 429 && i < this.MAX_RETRIES) {
          const delay = this.INITIAL_RETRY_DELAY * Math.pow(2, i);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        // 401: Unauthorized (Invalid Key)
        if (error?.status === 401) {
          throw new Error("API_KEY_INVALID: API Key không hợp lệ hoặc đã hết hạn.");
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
      ${referenceImage ? "CRITICAL: Emulate the EXACT visual style, color grading, and material finishes from the provided MOOD BOARD image." : ""}
    `.trim();

    let parts: any[] = [
      { inlineData: { mimeType: 'image/jpeg', data: productBase64 } }
    ];

    if (referenceImage) {
      const refBase64 = await this.processImage(referenceImage);
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: refBase64 } });
      parts.push({ text: "REFER TO THIS MOOD BOARD FOR VISUAL STYLE." });
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
      [CameraAngle.WIDE]: "Panoramic wide shot showing the full architectural context.",
      [CameraAngle.MEDIUM]: "Medium range shot, focusing on the main group of objects.",
      [CameraAngle.CLOSEUP]: "Macro-style detail shot. Zoom in very close to show texture and materials of the products.",
      [CameraAngle.TOP_DOWN]: "BIRD'S EYE VIEW. Camera is on the ceiling looking directly down at the floor layout.",
      [CameraAngle.SIDE_PERSPECTIVE]: "Diagonal 45-degree corner view of the scene.",
      [CameraAngle.DETAIL_MACRO]: "Extreme close-up on surface finishes, seams, and wood grain."
    }[angle] || angle;

    const systemPrompt = `
      Professional Interior CGI Staging Visualization.
      
      ${isSubShot ? `
        CRITICAL TASK: CAMERA RELOCATION (SPATIAL CHANGE)
        1. YOU MUST MOVE THE CAMERA to a totally different position for this ${angle}.
        2. DO NOT DUPLICATE the framing of the Master Shot. This image MUST be a ${angleDescription}.
        3. SPATIAL CONSISTENCY: Keep the room structure (walls, floor, ceiling), windows, lighting, and ALL furniture positions exactly as seen in the MASTER SHOT.
        4. CLONE the materials and lighting atmosphere from the Master Shot, but RENDER it from the NEW camera position.
      ` : `
        TASK: ESTABLISH MASTER LAYOUT (REFERENCE SHOT)
        1. Create the definitive architectural staging for this ${params.roomType}.
        2. Set the ground truth for floor materials, wall colors, furniture positions, and the ${params.lightingEnv} lighting.
        3. ${referenceImage ? "EMULATE THE VISUAL STYLE AND ATMOSPHERE OF THE MOOD BOARD." : ""}
        4. This is the WIDE MASTER SHOT that all subsequent shots will follow.
      `}
      
      Atmosphere: ${params.mood}. Style: ${params.designStyle}. Lighting: ${params.lightingEnv}.
      Current Camera Angle: ${angleDescription}.
    `.trim();

    let parts: any[] = [];
    
    if (isSubShot && masterShotUrl) {
      const masterBase64 = await this.processImage(masterShotUrl);
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: masterBase64 } });
      parts.push({ text: "THIS IS THE MASTER SHOT ENVIRONMENT REFERENCE. CLONE THIS ROOM EXACTLY." });
    } else if (referenceImage) {
      const refBase64 = await this.processImage(referenceImage);
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: refBase64 } });
      parts.push({ text: "THIS IS THE MOOD BOARD REFERENCE. EMULATE THIS STYLE." });
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
              { text: `Refine this image: ${prompt}. Maintain original composition.` }
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
