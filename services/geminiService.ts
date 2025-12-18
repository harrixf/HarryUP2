
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
    throw new Error(language === 'es' 
      ? "El archivo supera los 50MB. Por favor, redúcelo o comprímelo."
      : "Fitxategiak 50MB gainditzen ditu. Mesedez, txikitu edo konprimitu."
    );
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY_MISSING");

  const ai = new GoogleGenAI({ apiKey });
  const audioPart = await fileToGenerativePart(file);
  const model = "gemini-3-flash-preview";
  
  const prompt = language === 'es'
    ? "Realiza la transcripción completa de este archivo (audio o vídeo). Identifica a los diferentes hablantes y marca el tiempo de inicio (MM:SS). Es un contenido largo (hasta 2h), procesa con detalle. Devuelve un array JSON de objetos con speaker, startTime y text."
    : "Egin fitxategi honen transkripzio osoa (audioa edo bideoa) euskaraz. Identifikatu hizlariak eta markatu hasiera-ordua (MM:SS). Eduki luzea da (2h-ra arte), xehetasunez prozesatu. Itzuli JSON array bat speaker, startTime eta text objektuekin.";

  try {
    const response = await generateWithRetry(ai.models, {
      model: model,
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
    if (error.message?.includes("not found")) throw new Error("API_KEY_INVALID");
    throw new Error("Error en la transcripción. El archivo podría ser demasiado complejo.");
  }
};

export const reviewTranscript = async (segments: TranscriptSegment[], language: Language): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY_MISSING");
  
  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-pro-preview";

  const transcriptText = segments.map(s => `[${s.startTime}] ${s.speaker}: ${s.text}`).join('\n');
  const prompt = language === 'es'
    ? "Actúa como corrector editorial. Revisa buscando errores críticos. Devuelve el texto final corregido."
    : "Zuzentzaile editorial gisa jokatu. Berrikusi akats kritikoak bilatuz. Itzuli testu zuzendua.";

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: { parts: [{ text: prompt }, { text: transcriptText }] }
    });
    return response.text || "";
  } catch (error: any) {
    if (error.message?.includes("not found")) throw new Error("API_KEY_INVALID");
    return transcriptText;
  }
};

export const queryTranscript = async (segments: TranscriptSegment[], query: string, language: Language): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY_MISSING");
  
  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview";
  const transcriptText = segments.map(s => `[${s.startTime}] ${s.speaker}: ${s.text}`).join('\n');

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: { parts: [{ text: `CONTEXTO:\n${transcriptText}` }, { text: `PREGUNTA: ${query}` }] },
      config: { systemInstruction: language === 'es' ? "Eres un asistente experto." : "Laguntzaile aditua zara." }
    });
    return response.text || "";
  } catch (error: any) {
    if (error.message?.includes("not found")) throw new Error("API_KEY_INVALID");
    throw error;
  }
};

export const refineTranscript = async (segments: TranscriptSegment[], mode: EditMode, language: Language): Promise<TranscriptSegment[]> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey || mode === EditMode.RAW) return segments;
  
  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview"; 
  const prompt = language === 'es'
    ? (mode === EditMode.CLEANED ? "Limpia muletillas del JSON." : "Redacta en estilo periodístico el JSON.")
    : (mode === EditMode.CLEANED ? "Garbitu betegarriak JSONetik." : "Idatzi estilo profesionalean JSONa.");

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: { parts: [{ text: prompt }, { text: JSON.stringify(segments) }] },
      config: { responseMimeType: "application/json", responseSchema: transcriptSchema }
    });
    const data = JSON.parse(response.text || "[]");
    return data.map((item: any, index: number) => ({ ...item, id: segments[index]?.id || `ref-${index}` }));
  } catch (error) { return segments; }
};

export const correctSegmentText = async (text: string, language: Language): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return text;
  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: (language === 'es' ? "Corrige: " : "Zuzendu: ") + text }] }
    });
    return response.text?.trim() || text;
  } catch { return text; }
};
