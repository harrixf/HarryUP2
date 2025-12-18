
import React, { useState, useEffect, useRef } from 'react';
import { UploadIcon, UndoIcon, RedoIcon, DownloadIcon, PlusIcon, MenuIcon, XMarkIcon, TrashIcon, SearchIcon, SparklesIcon, MagicIcon } from './components/Icons';
import { AudioPlayer } from './components/AudioPlayer';
import { Editor } from './components/Editor';
import { AIAssistant } from './components/AIAssistant';
import { transcribeAudio, refineTranscript, correctSegmentText, reviewTranscript } from './services/geminiService';
import { TranscriptSegment, EditMode, Language } from './types';
import { useAppStore } from './store';

interface HistoryState { segments: TranscriptSegment[]; mode: EditMode; }

const App: React.FC = () => {
  const { 
    language, setLanguage, setSidebarOpen, sessionId, setSessionId, fileName, setFileName, segments, setSegments, editMode, setEditMode, processingState, setProcessingState, saveCurrentSession, resetSession, updateSegment, updateSpeaker, deleteSegment, mergeSegment, splitSegment 
  } = useAppStore();

  const [file, setFile] = useState<File | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [seekRequest, setSeekRequest] = useState<number | null>(null);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [isAiAssistantOpen, setIsAiAssistantOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [correctingSegmentId, setCorrectingSegmentId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isReviewing, setIsReviewing] = useState(false);
  const [needsApiKey, setNeedsApiKey] = useState(false);

  useEffect(() => {
    const checkKey = async () => {
      if (typeof window !== 'undefined' && (window as any).aistudio) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        if (!hasKey && !process.env.API_KEY) {
          setNeedsApiKey(true);
        }
      }
    };
    checkKey();
  }, []);

  const handleOpenKeySelector = async () => {
    if ((window as any).aistudio) {
      await (window as any).aistudio.openSelectKey();
      setNeedsApiKey(false);
      // Tras seleccionar, procedemos a recargar o reintentar si fuera necesario
    }
  };

  const handleError = (error: any) => {
    if (error.message === 'API_KEY_MISSING' || error.message === 'API_KEY_INVALID') {
      setNeedsApiKey(true);
      setProcessingState({ status: 'error', message: "Se requiere configurar una API Key válida." });
    } else {
      setProcessingState({ status: 'error', message: error.message });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setFileName(selectedFile.name);
      setSessionId(Date.now().toString());
      setProcessingState({ status: 'transcribing', message: language === 'es' ? 'Transcribiendo...' : 'Transkribatzen...' });
      try {
        const transcript = await transcribeAudio(selectedFile, language);
        setSegments(transcript);
        setHistory([{ segments: transcript, mode: EditMode.RAW }]);
        setHistoryIndex(0);
        setProcessingState({ status: 'completed' });
        saveCurrentSession();
      } catch (error: any) {
        handleError(error);
      }
    }
  };

  const handleDownloadWithReview = async (format: 'txt' | 'md') => {
    setShowDownloadMenu(false);
    setIsReviewing(true);
    setProcessingState({ status: 'refining', message: language === 'es' ? 'Revisión final IA...' : 'Azken IA berrikuspena...' });
    try {
      const reviewedText = await reviewTranscript(segments, language);
      const name = `${fileName.split('.')[0]}_revisado.${format}`;
      const blob = new Blob([reviewedText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
    } catch (error) {
      handleError(error);
    } finally {
      setIsReviewing(false);
      setProcessingState({ status: 'completed' });
    }
  };

  const handleDownloadRaw = (format: 'txt' | 'md' | 'json') => {
    setShowDownloadMenu(false);
    let content = format === 'json' ? JSON.stringify(segments, null, 2) : segments.map(s => `[${s.startTime}] ${s.speaker}: ${s.text}`).join('\n\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.split('.')[0]}.${format}`;
    a.click();
  };

  if (needsApiKey) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-paper p-6 text-center">
        <div className="max-w-md w-full bg-white p-10 rounded-2xl shadow-xl border border-indigo-100">
          <div className="text-indigo-600 mb-6 flex justify-center"><SparklesIcon /></div>
          <h1 className="text-2xl font-serif font-bold mb-4">Configuración Requerida</h1>
          <p className="text-gray-600 mb-8">Para usar los modelos avanzados de HarryUP, necesitas conectar tu cuenta de Google Gemini API.</p>
          <button onClick={handleOpenKeySelector} className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg active:scale-95 mb-4">
            Conectar API Key
          </button>
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-xs text-indigo-500 hover:underline">
            ¿Cómo obtener una clave? (Billing Doc)
          </a>
        </div>
      </div>
    );
  }

  if (!sessionId && processingState.status === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-paper p-6">
        <div className="max-w-md w-full bg-white p-10 rounded-2xl shadow-xl border border-gray-100 text-center">
          <div className="flex justify-center mb-6 text-indigo-600"><UploadIcon /></div>
          <h1 className="text-3xl font-serif font-bold mb-4">HarryUP</h1>
          <p className="text-gray-500 mb-8">Audio y Vídeo hasta 50MB / 2h.</p>
          <div className="flex justify-center gap-2 mb-8">
            <button onClick={() => setLanguage('es')} className={`px-3 py-1 rounded ${language === 'es' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>ES</button>
            <button onClick={() => setLanguage('eu')} className={`px-3 py-1 rounded ${language === 'eu' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>EU</button>
          </div>
          <label className="block w-full bg-indigo-600 text-white py-4 rounded-xl font-bold cursor-pointer hover:bg-indigo-700 transition-all shadow-lg active:scale-95">
            {language === 'es' ? 'Empezar ahora' : 'Hasi orain'}
            <input type="file" accept="audio/*,video/*" onChange={handleFileChange} className="hidden" />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-paper flex flex-col overflow-hidden">
      <header className="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-6 z-40 gap-4">
        <div className="flex items-center gap-4 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg"><MenuIcon /></button>
          <h1 className="font-serif font-bold text-gray-800 text-xl hidden sm:block">HarryUP</h1>
        </div>

        <div className="flex-1 max-w-xl relative">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-400"><SearchIcon /></div>
          <input
            type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={language === 'es' ? "Buscar por palabra o hablante..." : "Bilatu hitzez edo hizlariz..."}
            className="w-full pl-10 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-full text-sm focus:bg-white focus:ring-2 focus:ring-indigo-100 transition-all outline-none"
          />
          {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600"><XMarkIcon /></button>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setIsAiAssistantOpen(!isAiAssistantOpen)} className={`p-2 rounded-lg transition-colors ${isAiAssistantOpen ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:bg-gray-100'}`}><SparklesIcon /></button>
          <div className="h-6 w-px bg-gray-200 mx-1"></div>
          <button onClick={() => setShowDownloadMenu(!showDownloadMenu)} className="p-2 bg-indigo-600 text-white rounded-lg shadow-sm hover:bg-indigo-700"><DownloadIcon /></button>
          {showDownloadMenu && (
            <div className="absolute right-6 top-14 bg-white shadow-2xl border border-gray-100 rounded-xl py-2 w-56 animate-[scaleIn_0.1s_ease-out]">
              <div className="px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Revisión IA (Pro)</div>
              <button onClick={() => handleDownloadWithReview('md')} className="w-full text-left px-4 py-2 text-sm hover:bg-indigo-50 text-indigo-600 font-medium">✨ Revisar y bajar .md</button>
              <div className="h-px bg-gray-100 my-1"></div>
              <div className="px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Original</div>
              <button onClick={() => handleDownloadRaw('txt')} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">Texto (.txt)</button>
              <button onClick={() => handleDownloadRaw('json')} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">JSON (.json)</button>
            </div>
          )}
          <button onClick={() => resetSession()} className="p-2 text-gray-400 hover:text-red-500"><PlusIcon /></button>
        </div>
      </header>

      <main className="flex-grow overflow-y-auto relative">
        <Editor 
          segments={segments} searchTerm={searchTerm}
          onSegmentChange={updateSegment} onSpeakerChange={updateSpeaker}
          onSegmentClick={(t) => { const [m,s] = t.split(':').map(Number); setSeekRequest(m*60+s); }}
          onDeleteSegment={deleteSegment} onMergeSegment={mergeSegment} onSplitSegment={splitSegment}
          onCorrectSegment={async (id) => {
             const s = segments.find(seg => seg.id === id);
             if (!s) return;
             setCorrectingSegmentId(id);
             try {
                const txt = await correctSegmentText(s.text, language);
                updateSegment(id, txt);
             } catch (err) { handleError(err); }
             setCorrectingSegmentId(null);
          }}
          currentAudioTime={currentTime} language={language} correctingSegmentId={correctingSegmentId}
          onSegmentBlur={() => {}}
        />
        <AIAssistant isOpen={isAiAssistantOpen} onClose={() => setIsAiAssistantOpen(false)} segments={segments} language={language} />
      </main>

      <AudioPlayer file={file} currentTime={currentTime} onTimeUpdate={setCurrentTime} onLoadedMetadata={() => {}} seekRequest={seekRequest} />
      {isReviewing && <div className="fixed inset-0 bg-white/60 backdrop-blur-sm z-[60] flex items-center justify-center flex-col gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
        <p className="font-serif font-bold text-indigo-900">{processingState.message}</p>
      </div>}
      {processingState.status === 'error' && !needsApiKey && (
        <div className="fixed top-20 right-6 bg-red-50 border border-red-200 p-4 rounded-xl shadow-lg flex items-center gap-3 animate-[slideIn_0.3s_ease-out]">
          <div className="text-red-500"><XMarkIcon /></div>
          <p className="text-sm text-red-700 font-medium">{processingState.message}</p>
          <button onClick={() => setProcessingState({ status: 'completed' })} className="text-red-400 hover:text-red-600"><XMarkIcon /></button>
        </div>
      )}
    </div>
  );
};

export default App;
