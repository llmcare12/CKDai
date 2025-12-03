import React, { useState, useRef, useEffect } from 'react';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Message, MindMapNode, QnAItem } from './types';
import { generateChatResponse, generatePodcastAudio, generateMindMapData } from './services/geminiService';
import MindMapGraph from './components/MindMapGraph';
import { APP_NAME, FIXED_QNA_LIST } from './constants';

// --- Shared Components ---
const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className, children, ...props }) => (
  <button 
    className={`px-6 py-2.5 rounded-full font-bold transition-all duration-200 active:scale-95 shadow-sm hover:shadow-md ${className}`} 
    {...props} 
  >
    {children}
  </button>
);

const Card: React.FC<{ children: React.ReactNode, className?: string }> = ({ children, className }) => (
  <div className={`bg-white rounded-3xl shadow-lg p-8 border border-gray-100 ${className}`}>
    {children}
  </div>
);

const Spinner = () => (
  <div className="flex justify-center items-center space-x-2 p-4 text-blue-600">
    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current"></div>
    <span className="font-medium">AI 正在處理中...</span>
  </div>
);

// --- Pages ---

const Home = () => (
  <div className="max-w-5xl mx-auto py-12 px-4 text-center space-y-16 animate-fade-in">
    <div className="space-y-6">
      <h1 className="text-4xl md:text-6xl font-black text-gray-900 tracking-tight leading-tight">
        <span className="text-blue-600">腎臟護理指引</span> 智慧學習系統
      </h1>
      <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
        腎臟科臨床護理教育中，指引與衛教文件內容繁雜且專業性高。
        本平台利用 <span className="text-blue-600 font-bold">AI 大型語言模型</span> 與多媒體生成技術，
        將複雜的衛教文件轉換為易懂的互動素材。
      </p>
      <div className="flex justify-center gap-4 pt-4">
        <Link to="/summary">
          <Button className="bg-blue-600 text-white hover:bg-blue-700 text-lg px-8 py-3">開始 AI 對話</Button>
        </Link>
      </div>
    </div>

    <div className="grid md:grid-cols-3 gap-8">
      <Link to="/summary" className="group">
        <div className="bg-white p-8 rounded-3xl shadow-md border border-gray-100 hover:shadow-xl transition-all duration-300 h-full hover:-translate-y-1">
          <div className="text-5xl mb-6 group-hover:scale-110 transition-transform duration-300">🤖</div>
          <h3 className="text-2xl font-bold text-gray-800 mb-3">AI 重點摘要</h3>
          <p className="text-gray-600">透過對話，即時獲得淺顯易懂的衛教解答。</p>
        </div>
      </Link>
      <Link to="/podcast" className="group">
        <div className="bg-white p-8 rounded-3xl shadow-md border border-gray-100 hover:shadow-xl transition-all duration-300 h-full hover:-translate-y-1">
          <div className="text-5xl mb-6 group-hover:scale-110 transition-transform duration-300">🎙️</div>
          <h3 className="text-2xl font-bold text-gray-800 mb-3">衛教 Podcast</h3>
          <p className="text-gray-600">輸入主題，生成專屬語音導覽，用聽的學習。</p>
        </div>
      </Link>
      <Link to="/mindmap" className="group">
        <div className="bg-white p-8 rounded-3xl shadow-md border border-gray-100 hover:shadow-xl transition-all duration-300 h-full hover:-translate-y-1">
          <div className="text-5xl mb-6 group-hover:scale-110 transition-transform duration-300">🧠</div>
          <h3 className="text-2xl font-bold text-gray-800 mb-3">知識心智圖</h3>
          <p className="text-gray-600">視覺化知識結構，快速掌握複雜概念。</p>
        </div>
      </Link>
    </div>
  </div>
);

const AiSummary = () => {
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', role: 'model', content: '您好！我是您的腎臟病衛教助理。您可以問我關於「飲食原則」、「症狀」、「分期」等問題，我會根據衛教手冊為您解答。' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const reply = await generateChatResponse(userMsg.content, messages);
      setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'model', content: reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'model', content: '抱歉，發生錯誤，請稍後再試。' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-140px)] flex flex-col animate-fade-in">
      <div className="bg-white rounded-t-3xl shadow-lg border-b border-gray-100 p-6 flex items-center space-x-3">
        <span className="text-3xl">💬</span>
        <div>
          <h2 className="text-xl font-bold text-gray-900">AI 衛教諮詢</h2>
          <p className="text-sm text-gray-500">內容源自腎臟病衛教手冊</p>
        </div>
      </div>
      
      <div className="flex-1 bg-gray-50 overflow-y-auto p-6 space-y-6">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-5 rounded-2xl shadow-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === 'user' 
                ? 'bg-blue-600 text-white rounded-br-none' 
                : 'bg-white text-gray-800 border border-gray-200 rounded-bl-none'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white p-4 rounded-2xl rounded-bl-none border border-gray-200 flex space-x-2 items-center shadow-sm">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="bg-white p-4 rounded-b-3xl shadow-lg border-t border-gray-100">
        <form onSubmit={handleSubmit} className="flex gap-4">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="請輸入您的問題，例如：低蛋白飲食要注意什麼？"
            className="flex-1 px-6 py-4 bg-white border border-gray-200 text-gray-700 shadow-sm rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          <Button type="submit" disabled={loading} className="bg-blue-600 text-white hover:bg-blue-700 aspect-square rounded-full flex items-center justify-center p-0 w-14 h-14">
            <span className="text-xl">➤</span>
          </Button>
        </form>
      </div>
    </div>
  );
};

const Podcast = () => {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{audioUrl: string, script: string} | null>(null);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setData(null);
    try {
      const result = await generatePodcastAudio(topic);
      setData(result);
    } catch (e) {
      console.error(e);
      alert("生成失敗，請確認 API Key");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-in">
      <Card className="text-center space-y-6">
        <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto text-4xl">🎧</div>
        <h2 className="text-2xl font-bold text-gray-900">AI 衛教 Podcast 製作</h2>
        <p className="text-gray-600">輸入您想了解的主題，AI 將為您生成專屬的語音解說。</p>
        
        <div className="flex gap-3 max-w-xl mx-auto">
          <input 
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="例如：慢性腎臟病飲食原則"
            className="flex-1 px-5 py-3 bg-white border border-gray-200 text-gray-700 shadow-sm rounded-xl focus:ring-2 focus:ring-purple-500 focus:outline-none placeholder-gray-400"
          />
          <Button onClick={handleGenerate} disabled={loading} className="bg-purple-600 text-white hover:bg-purple-700 whitespace-nowrap">
            製作節目
          </Button>
        </div>
        {loading && <div className="text-purple-600 animate-pulse">正在撰寫腳本並錄製語音中 (請稍後)...</div>}
      </Card>

      {data && (
        <div className="animate-fade-in space-y-6">
          <Card className="bg-gradient-to-br from-purple-50 to-white border-purple-100">
            <h3 className="text-lg font-bold text-purple-900 mb-4 flex items-center gap-2">
              <span>▶️</span> 現正播放：{topic}
            </h3>
            <audio controls src={data.audioUrl} className="w-full" />
            <div className="mt-4 text-right">
              <a href={data.audioUrl} download={`KidneyCare_${topic}.wav`} className="text-sm text-purple-600 hover:underline font-medium">
                下載音訊檔案
              </a>
            </div>
          </Card>
          
          <Card>
            <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">節目腳本</h3>
            <div className="prose max-w-none text-gray-700 whitespace-pre-wrap leading-relaxed text-sm">
              {data.script}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

const MindMap = () => {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MindMapNode | null>(null);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setData(null);
    try {
      const result = await generateMindMapData(topic);
      setData(result);
    } catch (e) {
      console.error(e);
      alert("生成失敗，請重試");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <Card className="flex flex-col md:flex-row items-center gap-6">
        <div className="flex-1 w-full">
          <h2 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
            <span className="text-3xl">🧠</span> 知識心智圖
          </h2>
          <p className="text-gray-500 mb-4">輸入關鍵字，AI 為您整理結構化的知識圖表。</p>
          <div className="flex gap-3">
            <input 
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="例如：含鉀食物有哪些？"
              className="flex-1 px-5 py-3 bg-white border border-gray-200 text-gray-700 shadow-sm rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-400"
            />
            <Button onClick={handleGenerate} disabled={loading} className="bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap">
              生成圖表
            </Button>
          </div>
        </div>
      </Card>

      {loading && <Spinner />}
      
      {data && (
        <div className="animate-fade-in">
          <MindMapGraph data={data} />
        </div>
      )}
    </div>
  );
};

const QnA = () => {
  // 直接使用靜態資料，不需要 useEffect 或 loading
  const items = FIXED_QNA_LIST;

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-in">
      <div className="text-center space-y-4">
        <h2 className="text-3xl font-bold text-gray-900">常見問題集 Q&A</h2>
        <p className="text-gray-500">彙整病患最常詢問的 15 個關鍵問題 (源自衛教手冊)</p>
      </div>

      <div className="space-y-6">
        {items.map((item, idx) => (
          <div key={idx} className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow duration-300">
            <div className="bg-blue-50/50 px-8 py-5 border-b border-blue-100">
              <h3 className="text-lg font-bold text-blue-900 flex gap-3">
                <span className="bg-blue-600 text-white text-sm px-2.5 py-0.5 rounded-lg h-fit mt-0.5">Q{idx + 1}</span>
                {item.question}
              </h3>
            </div>
            <div className="px-8 py-6 bg-white text-gray-700 leading-relaxed">
              {item.answer}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Layout ---

const Navbar = () => {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  const links = [
    { path: '/', label: '首頁', icon: '🏠' },
    { path: '/summary', label: 'AI 摘要', icon: '🤖' },
    { path: '/podcast', label: 'Podcast', icon: '🎧' },
    { path: '/mindmap', label: '心智圖', icon: '🧠' },
    { path: '/qna', label: 'Q&A', icon: '❓' },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link 
          to="/" 
          className="flex items-center gap-2 group"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-md group-hover:rotate-6 transition-transform">K</div>
          <span className="text-xl font-bold text-gray-800 tracking-tight">{APP_NAME}</span>
        </Link>
        
        {/* Desktop Menu */}
        <div className="hidden md:flex space-x-1">
          {links.map(link => {
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 flex items-center gap-1.5 ${
                  isActive 
                    ? 'bg-blue-50 text-blue-700' 
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span>{link.icon}</span>
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Mobile Menu Button */}
        <button 
            className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
            {isMobileMenuOpen ? (
                <span className="text-2xl leading-none">✕</span> 
            ) : (
                <span className="text-2xl leading-none">☰</span>
            )}
        </button>
      </div>

      {/* Mobile Menu Dropdown */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-white border-b border-gray-100 px-4 py-4 space-y-2 shadow-lg animate-fade-in absolute w-full left-0">
             {links.map(link => {
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`block px-4 py-3 rounded-xl text-base font-medium transition-all duration-200 flex items-center gap-3 ${
                  isActive 
                    ? 'bg-blue-50 text-blue-700' 
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span className="text-xl">{link.icon}</span>
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
};

const App = () => {
  return (
    <HashRouter>
      <div className="min-h-screen bg-[#f8fafc] font-sans text-gray-900">
        <Navbar />
        <main className="p-4 md:p-6">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/summary" element={<AiSummary />} />
            <Route path="/podcast" element={<Podcast />} />
            <Route path="/mindmap" element={<MindMap />} />
            <Route path="/qna" element={<QnA />} />
          </Routes>
        </main>
        <footer className="py-8 text-center text-gray-400 text-sm px-4">
          <p>© {new Date().getFullYear()} KidneyCare AI. 腎臟護理指引智慧學習系統</p>
        </footer>
      </div>
    </HashRouter>
  );
};

export default App;
