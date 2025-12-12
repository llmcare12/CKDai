import { GoogleGenAI, Modality } from "@google/genai";
import { 
  GEMINI_MODEL_FLASH, 
  GEMINI_MODEL_TTS, 
  RAG_KNOWLEDGE_DB, 
  FIXED_QNA_LIST,
  KnowledgeItem 
} from "./constants";
import { MindMapNode } from "../types";

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
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(json)?/, '').replace(/```$/, '');
  }
  return clean.trim();
};

// ==========================================
// RAG 核心工具函式
// ==========================================

// 1. 固定問答精準匹配
function findFixedAnswer(query: string): string | null {
  const target = FIXED_QNA_LIST.find(item => 
    item.question.includes(query) || query.includes(item.question)
  );
  return target ? target.answer : null;
}

// 2. 模糊檢索
function retrieveContext(query: string, topK: number = 3): KnowledgeItem[] {
  const lowerQuery = query.toLowerCase();
  
  // 簡易計分機制
  const scoredData = RAG_KNOWLEDGE_DB.map(item => {
    let score = 0;
    if (item.topic.includes(query)) score += 10;
    if (item.content.includes(query)) score += 5;
    if (item.summary.includes(query)) score += 3;
    const keywordMatch = item.keywords.some(k => lowerQuery.includes(k.toLowerCase()));
    if (keywordMatch) score += 8;

    return { item, score };
  });

  // 過濾掉沒分數的，由高分排到低分，取前 K 筆
  return scoredData
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(d => d.item);
}

// 3. 將檢索到的資料轉為文字 Prompt (移除之前的「一般常識」備註)
function formatContextToPrompt(items: KnowledgeItem[]): string {
  // 這裡不需要處理空陣列，因為會在主程式先攔截
  return items.map((item, idx) => `
  [資料 ${idx + 1}]
  主題：${item.topic}
  摘要：${item.summary}
  內容：${item.content}
  `).join('\n---\n');
}


// ==========================================
// 主要 Service 功能
// ==========================================

// 1. AI 摘要，聊天機器人 (嚴格限制版)
export const generateChatResponse = async (
  userMessage: string, 
  history: { role: string; content: string }[]
): Promise<string> => {
  
  // Step A: 先檢查固定問答
  const fixedAns = findFixedAnswer(userMessage);
  if (fixedAns) {
    return fixedAns;
  }

  // Step B: 執行 RAG 檢索
  const retrievedItems = retrieveContext(userMessage, 4);

  // 【嚴格限制邏輯 1】：如果關鍵字搜尋不到任何結果，直接拒絕，不浪費 API
  if (retrievedItems.length === 0) {
    return "我的資料庫裡沒有資料";
  }

  const contextPrompt = formatContextToPrompt(retrievedItems);
  const ai = getClient();
  
  // Step C: 呼叫 Gemini
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
      // 【嚴格限制邏輯 2】：透過 System Instruction 強制 AI 閉嘴
      systemInstruction: `你是一位嚴格遵守資料邊界的腎臟病衛教助理。
      
      任務：
      僅根據以下的【檢索資料】回答使用者的問題。
      
      【檢索資料】：
      ${contextPrompt}
      
      回答原則 (最高指令)：
      1. **只能** 使用上述提供的資料來回答。
      2. **絕對禁止** 補充資料庫以外的任何知識（即使你知道答案，只要資料庫沒寫，就當作不知道）。
      3. 如果上述資料不足以回答使用者的問題，請直接回答：「我的資料庫裡沒有資料」。
      4. 不要說「根據資料庫...」，直接回答內容即可。
      5. 不要使用 Markdown 粗體。`,
    }
  });

  const text = response.text || "";
  
  // 雙重保險：如果 AI 還是忍不住講了廢話但其實沒內容，可以考慮在這裡做二次檢查
  // 但通常 Prompt 夠強就可以擋住
  return text;
};

// 2. 語音生成 (嚴格限制版)
export const generatePodcastAudio = async (topic: string): Promise<{ audioUrl: string, script: string }> => {
  const ai = getClient();

  // 檢索資料
  const retrievedItems = retrieveContext(topic, 6);

  // 【嚴格限制】：如果沒有素材，無法生成 Podcast
  if (retrievedItems.length === 0) {
    // 這裡拋出錯誤，讓前端去接住並顯示 Alert
    throw new Error("我的資料庫裡沒有關於此主題的資料，無法生成 Podcast。");
  }

  const contextPrompt = formatContextToPrompt(retrievedItems);

  // Step 1: 生成逐字稿
  const scriptResponse = await ai.models.generateContent({
    model: GEMINI_MODEL_FLASH,
    contents: `請根據以下衛教資料，為主題「${topic}」撰寫 Podcast 腳本。
    
    資料來源：
    ${contextPrompt}
    
    嚴格要求：
    1. **內容必須 100% 來自上述資料來源**，絕對不可自行腦補或添加外部資訊。
    2. 如果資料來源的資訊量不足以寫成 500 字腳本，請就現有資料撰寫即可，不要硬湊。
    3. 角色：親切的個管師小榮。
    4. 輸出純文字腳本，無標記。`,
  });

  const scriptText = scriptResponse.text || "無法生成腳本。";

  // Step 2: TTS
  const audioResponse = await ai.models.generateContent({
    model: GEMINI_MODEL_TTS,
    contents: [{ parts: [{ text: scriptText }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Charon' }, 
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

// 3. 心智圖資料生成 (嚴格限制版)
export const generateMindMapData = async (topic: string): Promise<MindMapNode> => {
  const ai = getClient();

  const retrievedItems = retrieveContext(topic, 5);

  // 【嚴格限制】：沒有資料就不做圖
  if (retrievedItems.length === 0) {
    throw new Error("我的資料庫裡沒有關於此主題的資料，無法生成心智圖。");
  }

  const contextPrompt = formatContextToPrompt(retrievedItems);

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL_FLASH,
    contents: `請根據以下資料，製作主題「${topic}」的心智圖 JSON。
    
    資料來源：
    ${contextPrompt}
    
    嚴格要求：
    1. **僅使用** 資料來源內的資訊建立節點。
    2. 若資料不足，請僅列出已知的部分，不要編造。
    3. 回傳標準 JSON 格式。`,
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
    throw new Error("無法解析心智圖資料。");
  }
};

// --- Audio Helper Functions ---
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
    view.setUint16(20, 1, true); 
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
