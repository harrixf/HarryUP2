

import { GoogleGenAI, Type, Schema } from "@google/genai";
import { TranscriptSegment, EditMode, Language } from "../types";

// --- UNIVERSAL API KEY DETECTION ---
const getApiKey = (): string | undefined => {
  let key: string | undefined = undefined;

  // 1. Try Vite / Modern Browsers (import.meta.env)
  try {
    // @ts-ignore
    if (import.meta && import.meta.env) {
      // @ts-ignore
      key = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;
    }
  } catch (e) {}

  // 2. Try Process Env (Next.js, CRA, Google AI Studio Injection, Node)
  if (!key && typeof process !== 'undefined' && process.env) {
    key = process.env.NEXT_PUBLIC_GEMINI_API_KEY || 
          process.env.REACT_APP_GEMINI_API_KEY || 
          process.env.GEMINI_API_KEY || 
          process.env.API_KEY;
  }

  return key;
};

// Helper to convert file to base64
const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (!result) {
          reject(new Error("Failed to read file"));
          return;
      }
      // Remove data URL prefix if present
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

const transcriptSchema: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      speaker: { type: Type.STRING, description: "Name or label of the speaker (e.g., Speaker 1)" },
      startTime: { type: Type.STRING, description: "Start time of the segment in MM:SS format" },
      text: { type: Type.STRING, description: "The transcribed text" },
    },
    required: ["speaker", "startTime", "text"],
  },
};

// --- RETRY LOGIC ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function generateWithRetry(
  modelInstance: any, 
  params: any, 
  retries = 3
): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      return await modelInstance.generateContent(params);
    } catch (error: any) {
      // Check for 429 (Quota Exceeded/Rate Limit) or 503 (Service Unavailable)
      const isRateLimit = error.message?.includes('429') || error.status === 429 || error.code === 429;
      const isOverloaded = error.message?.includes('503') || error.status === 503;

      if ((isRateLimit || isOverloaded) && i < retries - 1) {
        const waitTime = 3000 * Math.pow(2, i); // Exponential backoff: 3s, 6s, 12s
        console.warn(`API limit hit (429/503). Retrying in ${waitTime}ms... (Attempt ${i + 1}/${retries})`);
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
}

// --- SAFETY SETTINGS ---
// Crucial to prevent "Empty response" when the model falsely flags content
const safetySettings = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
];

export const transcribeAudio = async (file: File, language: Language): Promise<TranscriptSegment[]> => {
  // 1. Check File Size (Client-side safety)
  if (file.size > 25 * 1024 * 1024) {
    throw new Error(language === 'es' 
      ? "El archivo es demasiado grande para la versión web (>25MB). Por favor, compímelo o usa un clip más corto."
      : "Fitxategia handiegia da (>25MB). Mesedez, konprimitu edo erabili klip laburragoa."
    );
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("CRITICAL: API Key not found in any environment variable.");
    throw new Error("API Key Missing. Please check your configuration.");
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    console.log(`Starting transcription... File: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    const audioPart = await fileToGenerativePart(file);
    
    // Use stable model
    const model = "gemini-2.5-flash";
    
    let prompt = "";
    if (language === 'es') {
      prompt = "Transcripción detallada del audio en castellano. Realiza una diarización precisa identificando a los hablantes con etiquetas distintas y secuenciales como 'Speaker 1', 'Speaker 2', etc. Genera una lista JSON con el hablante, el tiempo de inicio (MM:SS) y el texto literal.";
    } else {
      prompt = "Egin audioaren transkripzio zehatza euskaraz. Identifikatu hizlariak etiketa ezberdin eta sekuentzialekin ('Speaker 1', 'Speaker 2', etab). Sortu JSON zerrenda bat hizlaria, hasiera-ordua (MM:SS) eta testu literalarekin.";
    }

    const response = await generateWithRetry(ai.models, {
      model: model,
      contents: {
        parts: [audioPart, { text: prompt }]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: transcriptSchema,
        systemInstruction: language === 'es' 
          ? "Eres un transcriptor experto para periodistas. Tu objetivo es capturar el diálogo con precisión, identificando cambios de hablante."
          : "Kazetarientzako transkribatzaile aditua zara. Zure helburua elkarrizketa zehaztasunez jasotzea da, hizlari aldaketak identifikatuz.",
        safetySettings: safetySettings,
      }
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("Empty response from Gemini API. The model might have blocked the content.");
    
    const data = JSON.parse(jsonText);
    
    return data.map((item: any, index: number) => ({
      ...item,
      id: `seg-${index}-${Date.now()}`
    }));

  } catch (error: any) {
    console.error("Transcription Error Details:", error);
    if (error.message?.includes("429") || error.status === 429) {
      throw new Error("El sistema está saturado (Error 429). Hemos reintentado varias veces pero la cuota sigue excedida. Por favor, espera 1 minuto.");
    }
    if (error.message?.includes("400")) {
      throw new Error("Error de formato (400). El audio podría no ser compatible o estar corrupto.");
    }
    throw error;
  }
};

export const refineTranscript = async (
  segments: TranscriptSegment[], 
  mode: EditMode,
  language: Language
): Promise<TranscriptSegment[]> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key not found.");

  if (mode === EditMode.RAW) return segments;

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-2.5-flash"; 
  
  let prompt = "";
  
  if (language === 'es') {
    if (mode === EditMode.CLEANED) {
      prompt = "Elimina las muletillas, repeticiones innecesarias, titubeos ('eh', 'mmm') y falsos comienzos del siguiente texto. Mantén el significado exacto y el tono, pero hazlo más legible. Devuelve el mismo formato JSON.";
    } else if (mode === EditMode.JOURNALISTIC) {
      prompt = "Reescribe el texto con un estilo periodístico formal. Corrige la gramática, mejora la fluidez y utiliza un vocabulario más preciso y profesional, manteniendo la veracidad de las declaraciones. Devuelve el mismo formato JSON.";
    }
  } else {
    if (mode === EditMode.CLEANED) {
      prompt = "Ezabatu betegarriak, alferrikako errepikapenak eta zalantza-hotsak ('em', 'ba') hurrengo testutik. Mantendu esanahia eta tonua, baina egin irakurgarriagoa. Itzuli JSON formatu bera.";
    } else if (mode === EditMode.JOURNALISTIC) {
      prompt = "Berridatzi testua kazetaritza-estilo formalarekin. Zuzendu gramatika, hobetu jariotasuna eta erabili hiztegi zehatzagoa eta profesionalagoa, adierazpenen egiazkotasuna mantenduz. Itzuli JSON formatu bera.";
    }
  }

  const contentText = JSON.stringify(segments.map(({ id, ...rest }) => rest));

  try {
    const response = await generateWithRetry(ai.models, {
      model: model,
      contents: {
        parts: [{ text: prompt }, { text: contentText }]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: transcriptSchema,
        safetySettings: safetySettings,
      }
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("No response from Gemini");

    const data = JSON.parse(jsonText);
     
     return data.map((item: any, index: number) => ({
        ...item,
        id: segments[index]?.id || `seg-refined-${index}-${Date.now()}`
      }));

  } catch (error) {
    console.error("Refinement failed", error);
    throw error;
  }
};

export const queryTranscript = async (
  segments: TranscriptSegment[],
  query: string,
  language: Language
): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key not found.");

  const ai = new GoogleGenAI({ apiKey });
  
  // Format transcript for context
  const context = segments
    .map(s => `[${s.startTime}] ${s.speaker}: ${s.text}`)
    .join('\n');

  const prompt = `Contexto de la entrevista:\n${context}\n\nPregunta del usuario:\n${query}`;
  
  const systemInstruction = language === 'es' 
    ? "Eres un asistente experto en analizar entrevistas. Responde a la pregunta basándote ÚNICAMENTE en la transcripción proporcionada. Si la respuesta no está en el texto, indícalo. Sé conciso."
    : "Elkarrizketak aztertzen aditua den laguntzailea zara. Erantzun galderari emandako transkripzioan oinarrituta BAKARRIK. Erantzuna testuan ez badago, adierazi. Izan laburra.";

  try {
    const response = await generateWithRetry(ai.models, {
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        safetySettings: safetySettings,
      }
    });

    return response.text || "";
  } catch (error) {
    console.error("Query failed", error);
    throw error;
  }
};
