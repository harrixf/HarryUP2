
import { GoogleGenAI, Type } from "@google/genai";
import { TranscriptSegment, EditMode, Language } from "../types";

const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (!result) {
          reject(new Error("Error al leer el archivo"));
          return;
      }
      const base64String = result.includes(',') ? result.split(',')[1] : result;
      resolve({
        inlineData: {
          data: base64String,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const transcriptSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      speaker: { type: Type.STRING, description: "Identificador del hablante" },
      startTime: { type: Type.STRING, description: "Tiempo de inicio en formato MM:SS" },
      text: { type: Type.STRING, description: "Texto transcrito" },
    },
    required: ["speaker", "startTime", "text"],
  },
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function generateWithRetry(modelInstance: any, params: any, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      return await modelInstance.generateContent(params);
    } catch (error: any) {
      const isRateLimit = error.message?.includes('429') || error.status === 429;
      if (isRateLimit && i < retries - 1) {
        await delay(5000 * Math.pow(2, i));
        continue;
      }
      throw error;
    }
  }
}

export const transcribeAudio = async (file: File, language: Language): Promise<TranscriptSegment[]> => {
  if (file.size > 50 * 1024 * 1024) {
    throw new Error(language === 'es' ? "El archivo supera los 50MB." : "Fitxategiak 50MB gainditzen ditu.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const audioPart = await fileToGenerativePart(file);
  
  const prompt = language === 'es'
    ? "Realiza la transcripción completa de este archivo. Identifica hablantes y marca el tiempo (MM:SS). Devuelve un array JSON con speaker, startTime y text."
    : "Egin fitxategi honen transkripzio osoa euskaraz. Identifikatu hizlariak eta markatu hasiera-ordua (MM:SS). Itzuli JSON array bat speaker, startTime eta text objektuekin.";

  try {
    const response = await generateWithRetry(ai.models, {
      model: "gemini-3-flash-preview",
      contents: { parts: [audioPart, { text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: transcriptSchema,
        systemInstruction: "Eres un transcriptor periodístico de élite. Tu precisión es absoluta."
      }
    });

    const data = JSON.parse(response.text || "[]");
    return data.map((item: any, index: number) => ({
      ...item,
      id: `seg-${index}-${Date.now()}`
    }));
  } catch (error: any) {
    console.error("Transcription error:", error);
    throw new Error("Error en la transcripción. Verifica el archivo o la clave de API.");
  }
};

export const reviewTranscript = async (segments: TranscriptSegment[], language: Language): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const transcriptText = segments.map(s => `[${s.startTime}] ${s.speaker}: ${s.text}`).join('\n');
  const prompt = language === 'es'
    ? "Corrige errores críticos en esta transcripción. Devuelve solo el texto corregido."
    : "Zuzendu akats kritikoak transkripzio honetan. Itzuli testu zuzendua soilik.";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: { parts: [{ text: prompt }, { text: transcriptText }] }
    });
    return response.text || "";
  } catch (error: any) {
    return transcriptText;
  }
};

export const queryTranscript = async (segments: TranscriptSegment[], query: string, language: Language): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const transcriptText = segments.map(s => `[${s.startTime}] ${s.speaker}: ${s.text}`).join('\n');

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: `CONTEXTO:\n${transcriptText}` }, { text: `PREGUNTA: ${query}` }] },
      config: { systemInstruction: language === 'es' ? "Eres un asistente experto." : "Laguntzaile aditua zara." }
    });
    return response.text || "";
  } catch (error: any) {
    throw error;
  }
};

export const correctSegmentText = async (text: string, language: Language): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: (language === 'es' ? "Corrige gramática: " : "Zuzendu gramatika: ") + text }] }
    });
    return response.text?.trim() || text;
  } catch { return text; }
};
