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

// ==========================================
// 使用者健康檔案介面 (全方位判斷依據)
// ==========================================
export interface UserProfile {
  name?: string;         // 暱稱
  eGFR?: number;         // 腎絲球過濾率 (判斷分期核心)
  stage?: string;        // CKD 分期 (如 "3b", "5", "HD", "PD")
  hasDiabetes?: boolean; // 糖尿病 (影響視網膜、神經、血糖控制建議)
  hasHypertension?: boolean; // 高血壓 (影響運動、水分、藥物建議)
  isDialysis?: boolean;  // 是否已洗腎 (關鍵分水嶺：飲食與限水規則完全不同)
}

// ==========================================
// RAG 核心工具函式
// ==========================================

function findFixedAnswer(query: string): string | null {
  const target = FIXED_QNA_LIST.find(item => 
    item.question.includes(query) || query.includes(item.question)
  );
  return target ? target.answer : null;
}

function retrieveContext(query: string, topK: number = 3): KnowledgeItem[] {
  const lowerQuery = query.toLowerCase();
  
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

function formatContextToPrompt(items: KnowledgeItem[]): string {
  return items.map((item, idx) => `
  [衛教資料 ${idx + 1}]
  主題：${item.topic}
  摘要：${item.summary}
  內容：${item.content}
  `).join('\n---\n');
}

// ==========================================
// 主要 Service 功能
// ==========================================

// 1. AI 全方位衛教機器人
export const generateChatResponse = async (
  userMessage: string, 
  history: { role: string; content: string }[],
  userProfile?: UserProfile // 接收使用者全身數據
): Promise<string> => {
  
  // Step A: 檢查固定問答 (秒回)
  const fixedAns = findFixedAnswer(userMessage);
  if (fixedAns) {
    return fixedAns;
  }

  // Step B: RAG 檢索 (移除原本強制加 "飲食" 的邏輯，改為廣泛搜尋)
  // 我們讓搜尋引擎根據問題自然去匹配 (包含症狀、藥物、護理知識)
  const retrievedItems = retrieveContext(userMessage, 5); 

  // 若完全無資料，才回傳預設訊息
  if (retrievedItems.length === 0) {
    return "不好意思，目前的衛教資料庫中沒有提到這部分的詳細資訊。腎臟病的狀況比較複雜，為了您的安全，建議您將這個問題記錄下來，下次門診時諮詢您的主治醫師或個管師喔！";
  }

  const contextPrompt = formatContextToPrompt(retrievedItems);
  
  // 建立使用者狀況 Prompt
  let userProfilePrompt = "使用者目前未提供詳細身體數值，請給予通用的衛教建議。";
  if (userProfile) {
    userProfilePrompt = `
    【使用者健康檔案 (請據此調整回答策略)】：
    - 暱稱：${userProfile.name || "病友"}
    - 腎功能 (eGFR)：${userProfile.eGFR ? userProfile.eGFR : "未知"}
    - CKD 分期：${userProfile.stage ? `第 ${userProfile.stage} 期` : "未知"}
    - 透析狀況：${userProfile.isDialysis ? "已開始透析 (洗腎)" : "未透析"}
    - 共病症：${userProfile.hasDiabetes ? "有糖尿病" : ""} ${userProfile.hasHypertension ? "有高血壓" : ""}
    `;
  }

  const ai = getClient();
  
  // Step C: 呼叫 Gemini (全方位衛教版 Prompt)
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
      systemInstruction: `你是一位專業、溫暖且全方位的腎臟病衛教個管師「小榮」。
      你的職責不只是飲食建議，還包含症狀解讀、藥物安全、併發症預防及心理支持。
      
      請結合【檢索衛教資料】與【使用者健康檔案】，提供最貼切的個人化建議。

      ${userProfilePrompt}
      
      【檢索到的衛教資料庫】：
      ${contextPrompt}
      
      【回答最高指導原則】：
      1. **全人照護觀點**：
         - **判斷分期**：回答任何問題前，先看使用者的分期。
           (例：第 1-2 期重點在控制三高；第 3b-5 期重點在預防併發症與飲食限制；透析患者重點在瘻管照護與營養補充)。
         - **共病考量**：若使用者有糖尿病，解釋症狀時（如泡泡尿、視力模糊）要考慮高血糖的影響。若有高血壓，給予生活建議時要強調血壓控制。
      
      2. **生活化譬喻 (Metaphor)**：
         - 請將醫學原理轉化為生活常識。
         - 例：「腎臟像人體的淨水場」、「高血壓像水管壓力太大」、「尿毒素像家裡沒倒的垃圾」。
      
      3. **同理心與溫暖**：
         - 腎臟病友常感到焦慮，請用鼓勵的語氣：「其實只要控制好，生活還是可以很精彩的」、「別擔心，我們一起來看看怎麼做」。
      
      4. **嚴守資料邊界**：
         - 你的建議必須基於【檢索衛教資料】。
         - 若使用者問及資料庫未記載的特定藥物或療法，請誠實告知並建議就醫，不可自行腦補。
      
      5. **多面向解析**：
         - 如果使用者問「我最近頭暈」，不要只回答一種可能。請根據資料庫檢查是否與「貧血」、「低血壓 (透析後)」、「高血壓」或「藥物副作用」有關，並提示使用者注意哪些警訊。

      6. **排版**：請使用純文字，保持版面乾淨，不要用 Markdown 粗體。`,
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
