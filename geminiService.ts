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

  return scoredData
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(d => d.item);
}

// 3. 將檢索到的資料轉為文字 Prompt
function formatContextToPrompt(items: KnowledgeItem[]): string {
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

// 1. AI 摘要，聊天機器人 (溫暖譬喻版)
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

  // 【嚴格但有禮貌】：如果完全沒資料，回傳客氣的拒絕訊息
  if (retrievedItems.length === 0) {
    return "不好意思，目前的衛教資料庫中沒有提到這部分的資訊。為了您的健康著想，建議您直接諮詢您的主治醫師或護理師，以獲得最準確的建議喔！";
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
      // 【修改重點】：要求譬喻、口語化、去術語化
      systemInstruction: `你是一位親切、溫暖且善於解說的腎臟病衛教助理。
      
      你的任務是根據【檢索資料】來回答使用者的問題。
      
      【檢索資料】：
      ${contextPrompt}
      
      【回答最高指導原則】：
      1. **善用譬喻**：請將生硬的醫學概念轉化為生活中的例子。
         (例如：把「腎絲球過濾率」比喻成「腎臟電池剩下的電力」或「濾水器的濾心效率」)。
      2. **白話親切**：像是在跟鄰居長輩聊天一樣，不要使用艱澀的專業術語。如果資料中有術語，請用白話文解釋它。
      3. **語句通順**：你可以適度補充連接詞或語助詞（如：其實、簡單來說、別擔心），讓對話更自然流暢，不要像機器人唸稿。
      4. **嚴守事實**：你的「譬喻」和「解釋」必須建立在檢索資料的事實基礎上。**絕對不能**無中生有或捏造資料庫裡沒寫的醫學建議。
      5. **無資料處理**：如果檢索到的資料無法回答使用者的問題，請客氣地說：「不好意思，目前的資料庫裡沒有這方面的詳細資訊，建議諮詢醫師。」
      6. **排版**：請使用純文字，不要用 Markdown 粗體。`,
    }
  });

  return response.text || "系統忙碌中，請稍後再試。";
};

// 2. 語音生成 (廣播劇風格版)
export const generatePodcastAudio = async (topic: string): Promise<{ audioUrl: string, script: string }> => {
  const ai = getClient();

  // 檢索資料
  const retrievedItems = retrieveContext(topic, 6);

  if (retrievedItems.length === 0) {
    throw new Error("不好意思，資料庫中沒有關於此主題的資料，無法為您生成廣播內容。");
  }

  const contextPrompt = formatContextToPrompt(retrievedItems);

  // Step 1: 生成逐字稿
  const scriptResponse = await ai.models.generateContent({
    model: GEMINI_MODEL_FLASH,
    contents: `請根據以下衛教資料，為主題「${topic}」撰寫一份「非常白話、好懂」的 Podcast 廣播腳本。
    
    資料來源：
    ${contextPrompt}
    
    【撰寫要求】：
    1. **風格**：像是一位隔壁熱心的朋友「小榮」在聊天。語氣要非常輕鬆、口語化。
    2. **去專業化**：請把所有專業術語都變成生活比喻。
       (例：不要只說「高血磷」，要解釋成「骨頭會發癢、血管會硬掉」；不要說「eGFR」，要說「腎臟的分數」)。
    3. **內容限制**：內容必須 100% 來自上述資料來源，不可自行編造。如果資料不足，就寫短一點沒關係。
    4. **流暢度**：請加入自然的語助詞（像是：大家知道嗎？、其實啊、哎呀），讓聽起來不像在讀稿。
    5. **輸出格式**：純文字腳本，不要包含 [音樂]、(笑聲) 等標記，只包含要唸出來的台詞。`,
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

// 3. 心智圖資料生成 (結構化但白話版)
export const generateMindMapData = async (topic: string): Promise<MindMapNode> => {
  const ai = getClient();

  const retrievedItems = retrieveContext(topic, 5);

  if (retrievedItems.length === 0) {
    throw new Error("不好意思，資料庫中沒有關於此主題的資料，無法為您生成心智圖。");
  }

  const contextPrompt = formatContextToPrompt(retrievedItems);

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL_FLASH,
    contents: `請根據以下資料，製作主題「${topic}」的心智圖 JSON。
    
    資料來源：
    ${contextPrompt}
    
    【要求】：
    1. **節點名稱要白話**：請儘量用淺顯易懂的短詞，不要用太長的學術名詞。
    2. **結構清晰**：僅使用資料來源內的資訊。
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
