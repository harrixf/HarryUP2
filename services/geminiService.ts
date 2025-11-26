import { GoogleGenAI, Type, Schema } from "@google/genai";
import { TranscriptSegment, EditMode, Language } from "../types";

// --- UNIVERSAL API KEY DETECTION ---
const getApiKey = (): string | undefined => {
  let key: string | undefined = undefined;

  try {
    // @ts-ignore
    if (import.meta && import.meta.env) {
      // @ts-ignore
      key = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;
    }
  } catch (e) {}

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
      const isRateLimit = error.message?.includes('429') || error.status === 429 || error.code === 429;
      const isOverloaded = error.message?.includes('503') || error.status === 503;

      if ((isRateLimit || isOverloaded) && i < retries - 1) {
        const waitTime = 3000 * Math.pow(2, i);
        console.warn(`API limit hit (429/503). Retrying in ${waitTime}ms... (Attempt ${i + 1}/${retries})`);
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
}

export const transcribeAudio = async (file: File, language: Language): Promise<TranscriptSegment[]> => {
  if (file.size > 25 * 1024 * 1024) {
    throw new Error(language === 'es' 
      ? "El archivo es demasiado grande para la versión web (>25MB). Por favor, compímelo o usa un clip más corto."
      : "Fitxategia handiegia da (>25MB). Mesedez, konprimitu edo erabili klip laburragoa."
    );
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("CRITICAL: API Key not found.");
    throw new Error("API Key Missing. Check config.");
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    console.log(`Starting transcription... File: ${file.name}`);
    const audioPart = await fileToGenerativePart(file);
    
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
          : "Kazetarientzako transkribatzaile aditua zara. Zure helburua elkarrizketa zehaztasunez jasotzea da, hizlari aldaketak identifikatuz."
      }
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("Empty response from Gemini API. Please try again.");
    
    const data = JSON.parse(jsonText);
    return data.map((item: any, index: number) => ({
      ...item,
      id: `seg-${index}-${Date.now()}`
    }));

  } catch (error: any) {
    console.error("Transcription Error:", error);
    if (error.message?.includes("429")) {
      throw new Error("El sistema está saturado (Error 429). Espera 1 minuto e inténtalo de nuevo.");
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
      prompt = "Elimina muletillas y repeticiones. Mantén significado y tono. Devuelve el mismo JSON.";
    } else if (mode === EditMode.JOURNALISTIC) {
      prompt = "Reescribe con estilo periodístico formal. Corrige gramática, mejora fluidez. Mantén la veracidad. Devuelve el mismo JSON.";
    }
  } else {
    if (mode === EditMode.CLEANED) {
      prompt = "Ezabatu betegarriak eta errepikapenak. Mantendu esanahia. Itzuli JSON bera.";
    } else if (mode === EditMode.JOURNALISTIC) {
      prompt = "Berridatzi kazetaritza-estilo formalean. Zuzendu gramatika. Itzuli JSON bera.";
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

export const correctSegmentText = async (
  text: string,
  language: Language
): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key not found.");

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-2.5-flash";

  let prompt = "";
  if (language === 'es') {
    prompt = "Corrige la ortografía y la gramática del siguiente texto. No cambies el estilo ni el significado, solo corrige errores obvios. Devuelve solo el texto corregido.";
  } else {
    prompt = "Zuzendu ondorengo testua euskaraz. Ortografia eta gramatika akatsak bakarrik zuzendu (Xuxen bezala). Ez aldatu esanahia ezta estiloa ere. Itzuli zuzendutako testua bakarrik.";
  }

  try {
    const response = await generateWithRetry(ai.models, {
      model: model,
      contents: {
        parts: [{ text: prompt }, { text: text }]
      },
      config: {
        responseMimeType: "text/plain", // Plain text response
      }
    });

    return response.text?.trim() || text;
  } catch (error) {
    console.error("Correction failed", error);
    return text; // Return original on failure
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
  const model = "gemini-2.5-flash";

  const transcriptText = segments.map(s => `[${s.startTime}] ${s.speaker}: ${s.text}`).join('\n');
  
  let systemPrompt = "";
  if (language === 'es') {
    systemPrompt = "Eres un asistente útil que responde preguntas basadas en la siguiente transcripción de una entrevista. Responde de manera concisa y precisa usando la información del texto.";
  } else {
    systemPrompt = "Laguntzaile erabilgarria zara, ondorengo elkarrizketaren transkripzioan oinarrituta galderak erantzuten dituena. Erantzun labur eta zehatz testuko informazioa erabiliz.";
  }

  try {
    const response = await generateWithRetry(ai.models, {
      model: model,
      contents: {
        parts: [
          { text: systemPrompt },
          { text: `CONTEXT:\n${transcriptText}` },
          { text: `QUESTION:\n${query}` }
        ]
      },
    });

    return response.text?.trim() || "";
  } catch (error) {
    console.error("Query failed", error);
    throw error;
  }
};