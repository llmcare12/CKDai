import { GoogleGenAI, Modality, Type } from "@google/genai";
import { GEMINI_MODEL_FLASH, GEMINI_MODEL_TTS, KIDNEY_KNOWLEDGE_BASE } from "./constants";
import { MindMapNode, QnAItem } from "../types";

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY environment variable is not set");
  }
  return new GoogleGenAI({ apiKey });
};

// Helper to clean JSON string from Markdown code blocks
const cleanJson = (text: string): string => {
  let clean = text.trim();
  // Remove ```json ... ``` or ``` ... ```
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(json)?/, '').replace(/```$/, '');
  }
  return clean.trim();
};

// 1. AI摘要，聊天機器人
export const generateChatResponse = async (
  userMessage: string, 
  history: { role: string; content: string }[]
): Promise<string> => {
  const ai = getClient();
  
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL_FLASH,
    contents: [
      ...history.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.content }]
      })),
      { role: 'user', parts: [{ text: userMessage }] }
    ],
    config: {
      systemInstruction: `你是一位專業、親切的腎臟病衛教 AI 助理。
      
      任務：
      根據以下的【衛教資料庫】內容回答使用者的問題。
      
      【衛教資料庫】：
      ${KIDNEY_KNOWLEDGE_BASE}
      
      回答原則：
      1. 嚴格根據資料庫內容回答，不要自行編造醫學建議。
      2. 用語淺顯易懂，避免過多艱深術語，適合病患與護理人員閱讀。
      3. 若資料庫中沒有答案，請婉轉告知「目前資料庫中無相關資訊，建議諮詢醫師」。
      4. 語氣要溫暖、具備同理心。
      5. 使用繁體中文。
      6. **絕對不要使用 Markdown 的粗體語法 (如 **文字**)，請使用純文字排版，保持版面乾淨。**`,
    }
  });

  return response.text || "抱歉，我現在無法回答，請稍後再試。";
};

// 2. 語音生成
export const generatePodcastAudio = async (topic: string): Promise<{ audioUrl: string, script: string }> => {
  const ai = getClient();

  // Step 1: 生成逐字稿
  const scriptResponse = await ai.models.generateContent({
    model: GEMINI_MODEL_FLASH,
    contents: `請根據以下衛教資料，為主題「${topic}」撰寫一份 Podcast 廣播腳本。
    
    資料來源：
    ${KIDNEY_KNOWLEDGE_BASE}
    
    要求：
    1. 長度約 500 字 (口語朗讀約 2-3 分鐘)。
    2. 角色：一位親切、活潑的女性主持人，名子叫小莉，像是在跟好朋友聊天一樣，不要太嚴肅。
    3. 語氣：非常口語化、輕鬆、溫暖、有互動感。多用「大家知道嗎？」、「其實呀...」、「別擔心...」、「簡單來說」這類語助詞。
    4. 結構：
       - 開場：熱情打招呼，帶出今天的主題。
       - 內容：用講故事或聊天的口吻介紹衛教知識，舉例要生活化 (僅限資料庫內容)。
       - 結尾：溫馨提醒，鼓勵病友加油。
    5. 輸出格式：純文字腳本，不要包含 [音樂]、(笑聲)、[主持人] 等非口語標記，只包含要唸出來的台詞。
    6. 使用繁體中文。`,
  });

  const scriptText = scriptResponse.text || "無法生成腳本，請稍後再試。";

  // Step 2: 用TTS轉語音
  const audioResponse = await ai.models.generateContent({
    model: GEMINI_MODEL_TTS,
    contents: [{ parts: [{ text: scriptText }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' }, // Kore is typically female-sounding
        },
      },
    },
  });

  const base64Audio = audioResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  
  if (!base64Audio) {
    throw new Error("Failed to generate audio");
  }

  const audioBuffer = decode(base64Audio);
  const wavBytes = createWavFile(audioBuffer, 24000, 1); 
  const blob = new Blob([wavBytes], { type: 'audio/wav' });
  const audioUrl = URL.createObjectURL(blob);

  return { audioUrl, script: scriptText };
};

// 3. 心智圖資料生成
export const generateMindMapData = async (topic: string): Promise<MindMapNode> => {
  const ai = getClient();


  const response = await ai.models.generateContent({
    model: GEMINI_MODEL_FLASH,
    contents: `請根據以下衛教資料，針對主題「${topic}」製作一個心智圖結構。
    
    資料來源：
    ${KIDNEY_KNOWLEDGE_BASE}
    
    要求：
    1. 僅使用資料庫內的資訊。
    2. 請回傳一個標準的 JSON 物件。
    3. 根節點 (Root) 是主題名稱。
    4. 每個節點結構必須包含 'name' (字串) 和 'children' (陣列)。
    5. 如果該節點沒有子節點，'children' 可以是空陣列或不包含此欄位。
    6. 層次分明，請盡量詳細，至少 3 層結構。
    7. 不要包含任何 Markdown 標記 (如 \`\`\`json)，只回傳純 JSON 字串。`,
    config: {
      responseMimeType: "application/json"
    }
  });

  const jsonStr = response.text;
  if (!jsonStr) throw new Error("No data returned");
  
  try {
    const cleanStr = cleanJson(jsonStr);
    return JSON.parse(cleanStr) as MindMapNode;
  } catch (e) {
    console.error("JSON Parse Error:", e, jsonStr);
    throw new Error("無法解析心智圖資料，請重試。");
  }
};

// 4. Q&A Generation
export const generateQnAList = async (): Promise<QnAItem[]> => {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL_FLASH,
    contents: `請分析以下衛教資料，列出 10 個腎臟病患者最常感到困惑或最常問的問題，並提供解答。
    
    資料來源：
    ${KIDNEY_KNOWLEDGE_BASE}
    
    要求：
    1. 問題要切中痛點 (例如：洗腎會不會死？可以吃香蕉嗎？)。
    2. 解答要根據資料庫，淺顯易懂，具安撫性。
    3. 回傳 JSON 格式 (Array of objects)。
    4. 不要使用 Markdown 粗體語法 (**)。
    5. 使用繁體中文生成`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            answer: { type: Type.STRING }
          }
        }
      }
    }
  });

  const jsonStr = response.text;
  if (!jsonStr) return [];
  return JSON.parse(jsonStr) as QnAItem[];
};

// --- Audio Helper Functions (Raw PCM to WAV) ---
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function createWavFile(samples: Uint8Array, sampleRate: number, numChannels: number): Uint8Array {
    const buffer = new ArrayBuffer(44 + samples.length);
    const view = new DataView(buffer);
    const dataSize = samples.length;
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    const wavBytes = new Uint8Array(buffer);
    wavBytes.set(samples, 44);
    return wavBytes;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
