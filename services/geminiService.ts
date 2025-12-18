
import { GoogleGenAI, Type } from "@google/genai";
import { TranscriptSegment, EditMode, Language } from "../types";

const getApiKey = (): string | undefined => {
  return process.env.API_KEY;
};

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

// Removed explicit Schema type to adhere to guidelines and avoid deprecated types
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
  // Aumentado a 50MB para soportar archivos de vídeo o audios largos
  if (file.size > 50 * 1024 * 1024) {
    throw new Error(language === 'es' 
      ? "El archivo supera los 50MB. Por favor, redúcelo o comprímelo."
      : "Fitxategiak 50MB gainditzen ditu. Mesedez, txikitu edo konprimitu."
    );
  }

  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key Missing");

  const ai = new GoogleGenAI({ apiKey });
  const audioPart = await fileToGenerativePart(file);
  
  // Usamos Gemini 3 Flash para máxima velocidad y soporte de archivos largos
  const model = "gemini-3-flash-preview";
  
  let prompt = "";
  if (language === 'es') {
    prompt = "Realiza la transcripción completa de este archivo (audio o vídeo). Identifica a los diferentes hablantes (Speaker 1, Speaker 2...) y marca el tiempo de inicio de cada intervención. Es una entrevista larga, asegúrate de procesar todo el contenido hasta el final. Devuelve un array JSON de objetos con: speaker, startTime (MM:SS) y text.";
  } else {
    prompt = "Egin fitxategi honen transkripzio osoa (audioa edo bideoa) euskaraz. Identifikatu hizlariak (Speaker 1, Speaker 2...) eta markatu hasiera-ordua. Elkarrizketa luzea da, ziurtatu amaierara arte prozesatzen duzula. Itzuli JSON array bat objektu hauekin: speaker, startTime (MM:SS) eta text.";
  }

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
    throw new Error("Error en la transcripción: El archivo es demasiado largo o el servicio está saturado.");
  }
};

export const refineTranscript = async (segments: TranscriptSegment[], mode: EditMode, language: Language): Promise<TranscriptSegment[]> => {
  const apiKey = getApiKey();
  if (!apiKey || mode === EditMode.RAW) return segments;

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview"; 
  
  let prompt = "";
  if (language === 'es') {
    prompt = mode === EditMode.CLEANED 
      ? "Limpia las muletillas y repeticiones del siguiente JSON de transcripción." 
      : "Transforma el siguiente JSON de transcripción a un estilo periodístico fluido y profesional.";
  } else {
    prompt = mode === EditMode.CLEANED 
      ? "Garbitu betegarriak eta errepikapenak ondorengo JSON transkripziotik." 
      : "Berridatzi ondorengo JSON transkripzioa kazetaritza-estilo profesional batean.";
  }

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: { parts: [{ text: prompt }, { text: JSON.stringify(segments) }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: transcriptSchema,
      }
    });

    const data = JSON.parse(response.text || "[]");
    return data.map((item: any, index: number) => ({
      ...item,
      id: segments[index]?.id || `ref-${index}`
    }));
  } catch (error) {
    return segments;
  }
};

export const correctSegmentText = async (text: string, language: Language): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) return text;
  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview";

  const prompt = language === 'es' 
    ? "Corrige ortografía y gramática sin cambiar el sentido: " 
    : "Zuzendu ortografia eta gramatika esanahia aldatu gabe: ";

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: { parts: [{ text: prompt + text }] }
    });
    return response.text?.trim() || text;
  } catch {
    return text;
  }
};

// Fix: Added missing queryTranscript function to support AIAssistant chat queries
export const queryTranscript = async (segments: TranscriptSegment[], query: string, language: Language): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key Missing");

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview";

  const systemInstruction = language === 'es'
    ? "Eres un asistente editorial experto. Tu tarea es responder preguntas sobre el contenido de la transcripción proporcionada. Sé preciso, profesional y directo."
    : "Laguntzaile editorial aditua zara. Zure lana emandako transkripzioari buruzko galderei erantzutea da. Izan zehatza, profesionala eta zuzena.";

  const transcriptText = segments.map(s => `[${s.startTime}] ${s.speaker}: ${s.text}`).join('\n');

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          { text: `CONTEXTO (TRANSCRIPCIÓN):\n${transcriptText}` },
          { text: `PREGUNTA DEL USUARIO: ${query}` }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
      }
    });

    return response.text || (language === 'es' ? "Lo siento, no he podido procesar esa consulta." : "Barkatu, ezin izan dut kontsulta hori prozesatu.");
  } catch (error) {
    console.error("Query transcript error:", error);
    throw error;
  }
};
