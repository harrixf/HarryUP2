
import React, { useState, useEffect, useRef } from 'react';
import { UploadIcon, MagicIcon, CheckIcon, UndoIcon, RedoIcon, DownloadIcon, PlusIcon, MenuIcon, XMarkIcon, ClockIcon, AlertIcon, TrashIcon } from './components/Icons';
import { AudioPlayer } from './components/AudioPlayer';
import { Editor } from './components/Editor';
import { transcribeAudio, refineTranscript, correctSegmentText } from './services/geminiService';
import { TranscriptSegment, EditMode, ProcessingState, Language, StoredSession } from './types';
import { useAppStore } from './store';

interface HistoryState {
  segments: TranscriptSegment[];
  mode: EditMode;
}

type SaveStatus = 'saved' | 'saving' | 'error' | 'idle';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ isOpen, title, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 transform scale-100 animate-[scaleIn_0.2s_ease-out] border border-gray-100">
        <h3 className="text-lg font-serif font-bold text-gray-900 mb-3">{title}</h3>
        <p className="text-gray-600 mb-8 leading-relaxed text-sm">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2.5 rounded-lg text-gray-600 hover:bg-gray-100 font-medium transition-colors text-sm">Cancelar</button>
          <button onClick={onConfirm} className="px-5 py-2.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-medium shadow-md transition-all hover:shadow-lg text-sm active:scale-95">Confirmar</button>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const { 
    language, setLanguage, 
    isSidebarOpen, setSidebarOpen,
    sessionId, setSessionId,
    fileName, setFileName,
    segments, setSegments,
    editMode, setEditMode,
    processingState, setProcessingState,
    savedSessions, saveCurrentSession, deleteSession, loadSession, resetSession,
    updateSegment, updateSpeaker, deleteSegment, mergeSegment, splitSegment
  } = useAppStore();

  const [file, setFile] = useState<File | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [seekRequest, setSeekRequest] = useState<number | null>(null);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [includeTimecodes, setIncludeTimecodes] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [correctingSegmentId, setCorrectingSegmentId] = useState<string | null>(null);
  const [dialog, setDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isDirtyRef = useRef(false);

  useEffect(() => {
    if (segments.length > 0 && sessionId) {
      isDirtyRef.current = true;
      setSaveStatus('idle');
    }
  }, [segments, sessionId]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (sessionId && isDirtyRef.current && segments.length > 0) {
        setSaveStatus('saving');
        saveCurrentSession();
        setTimeout(() => {
            isDirtyRef.current = false;
            setSaveStatus('saved');
        }, 500);
      }
    }, 30000);
    return () => clearInterval(intervalId);
  }, [sessionId, segments, saveCurrentSession]);

  const addToHistory = (newSegments: TranscriptSegment[], mode: EditMode) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ segments: JSON.parse(JSON.stringify(newSegments)), mode });
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const state = history[historyIndex - 1];
      setSegments(state.segments);
      setEditMode(state.mode);
      setHistoryIndex(historyIndex - 1);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const state = history[historyIndex + 1];
      setSegments(state.segments);
      setEditMode(state.mode);
      setHistoryIndex(historyIndex + 1);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setFileName(selectedFile.name);

      if (sessionId && segments.length > 0) {
        setProcessingState({ status: 'completed' });
        return;
      }

      setSessionId(Date.now().toString());
      setProcessingState({ status: 'uploading', message: 'Procesando archivo...' });
      
      try {
        setProcessingState({ status: 'transcribing', message: language === 'es' ? 'Transcribiendo audio/vídeo (hasta 2h)...' : 'Audioa/Bideoa transkribatzen (2h-ra arte)...' });
        const transcript = await transcribeAudio(selectedFile, language);
        setSegments(transcript);
        setHistory([{ segments: transcript, mode: EditMode.RAW }]);
        setHistoryIndex(0);
        setProcessingState({ status: 'completed' });
        saveCurrentSession();
      } catch (error: any) {
        setProcessingState({ status: 'error', message: error.message });
      }
    }
  };

  const handleCorrectSegment = async (id: string) => {
    const segment = segments.find(s => s.id === id);
    if (!segment) return;
    setCorrectingSegmentId(id);
    try {
      const correctedText = await correctSegmentText(segment.text, language);
      updateSegment(id, correctedText);
      addToHistory(useAppStore.getState().segments, editMode);
    } finally {
      setCorrectingSegmentId(null);
    }
  };

  const handleRefine = async (mode: EditMode) => {
    if (mode === editMode || segments.length === 0) return;
    setProcessingState({ status: 'refining', message: language === 'es' ? 'Refinando texto con IA...' : 'Testua IArekin hobetzen...' });
    try {
      const newSegments = await refineTranscript(segments, mode, language);
      setSegments(newSegments);
      setEditMode(mode);
      addToHistory(newSegments, mode);
      setProcessingState({ status: 'completed' });
    } catch (error: any) {
      setProcessingState({ status: 'error', message: "Error al refinar" });
    }
  };

  const handleDownload = (format: 'txt' | 'json' | 'md') => {
    let content = '';
    const name = `${fileName.split('.')[0] || 'transcripcion'}.${format}`;
    if (format === 'json') content = JSON.stringify(segments, null, 2);
    else {
      content = segments.map(s => `${includeTimecodes ? `[${s.startTime}] ` : ''}${s.speaker}: ${s.text}`).join('\n\n');
    }
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  };

  const renderLanding = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-gray-50 to-indigo-50/50 p-6">
      <div className="w-full max-w-5xl mx-auto flex flex-col md:flex-row gap-8 items-center">
        <div className="bg-white p-8 md:p-12 rounded-2xl shadow-xl text-center w-full md:w-1/2 border border-indigo-50">
          <div className="flex justify-center mb-6 text-indigo-600"><UploadIcon /></div>
          <h1 className="text-3xl font-serif font-bold text-gray-900 mb-4">HarryUP</h1>
          <p className="text-gray-600 mb-6 text-lg">
            {language === 'es' ? 'Soporte para MP4 y Audio de hasta 2 horas (máx. 50MB). Transcripción con diarización automática.' : 'MP4 eta audioa 2 ordura arte (gehienez 50MB). Transkripzioa eta hizlarien identifikazio automatikoa.'}
          </p>
          <div className="mb-8 flex justify-center gap-2">
            <button onClick={() => setLanguage('es')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${language === 'es' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'}`}>ES</button>
            <button onClick={() => setLanguage('eu')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${language === 'eu' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'}`}>EU</button>
          </div>
          <label className="relative cursor-pointer group block w-full">
            <div className="bg-indigo-600 text-white px-8 py-4 rounded-full font-medium text-lg shadow-lg group-hover:bg-indigo-700 transition-all transform group-hover:scale-105 active:scale-95 w-full">
               {language === 'es' ? 'Subir Audio o Vídeo' : 'Igo Audioa edo Bideoa'}
            </div>
            <input type="file" accept="audio/*,video/mp4,video/quicktime,video/x-m4v" onChange={handleFileChange} className="hidden" />
          </label>
        </div>
        {savedSessions.length > 0 && (
          <div className="w-full md:w-1/2 bg-white/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-200">
            <h2 className="text-xl font-bold text-gray-800 mb-4 font-serif flex items-center gap-2"><ClockIcon />{language === 'es' ? 'Recientes' : 'Azkenak'}</h2>
            <div className="space-y-3">
              {savedSessions.slice(0, 5).map(s => (
                <div key={s.id} onClick={() => loadSession(s)} className="bg-white p-4 rounded-xl border border-gray-200 hover:border-indigo-300 transition-all cursor-pointer flex justify-between items-center group">
                  <span className="font-medium text-gray-700 truncate max-w-[200px]">{s.name}</span>
                  <button onClick={(e) => {e.stopPropagation(); deleteSession(s.id);}} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><TrashIcon /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const isProcessing = ['uploading', 'transcribing', 'refining'].includes(processingState.status);

  return (
    <div className="h-screen bg-paper flex flex-col overflow-hidden">
      <ConfirmDialog isOpen={dialog.isOpen} title={dialog.title} message={dialog.message} onConfirm={dialog.onConfirm} onCancel={() => setDialog({ ...dialog, isOpen: false })} />
      
      {!sessionId && processingState.status === 'idle' ? renderLanding() : (
        <>
          <header className="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-6 z-40">
            <div className="flex items-center gap-4">
              <button onClick={() => setSidebarOpen(true)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><MenuIcon /></button>
              <h1 className="font-serif font-bold text-gray-800 text-xl">HarryUP</h1>
              {isProcessing && <span className="text-xs bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full animate-pulse">{processingState.message}</span>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleUndo} disabled={historyIndex <= 0} className="p-2 text-gray-400 disabled:opacity-30"><UndoIcon /></button>
              <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className="p-2 text-gray-400 disabled:opacity-30"><RedoIcon /></button>
              <button onClick={() => handleRefine(EditMode.CLEANED)} className={`px-4 py-2 rounded-lg text-sm font-medium ${editMode === EditMode.CLEANED ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Limpiar</button>
              <button onClick={() => handleRefine(EditMode.JOURNALISTIC)} className={`px-4 py-2 rounded-lg text-sm font-medium ${editMode === EditMode.JOURNALISTIC ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Periodístico</button>
              <button onClick={() => setShowDownloadMenu(!showDownloadMenu)} className="p-2 bg-gray-100 rounded-lg"><DownloadIcon /></button>
              {showDownloadMenu && (
                <div className="absolute right-6 top-14 bg-white shadow-xl border border-gray-100 rounded-xl py-2 w-40">
                   <button onClick={() => handleDownload('txt')} className="w-full text-left px-4 py-2 hover:bg-gray-50">Texto (.txt)</button>
                   <button onClick={() => handleDownload('md')} className="w-full text-left px-4 py-2 hover:bg-gray-50">Markdown (.md)</button>
                </div>
              )}
              <button onClick={() => resetSession()} className="p-2 text-red-500 ml-2"><PlusIcon /></button>
            </div>
          </header>

          <main className="flex-grow overflow-y-auto">
            {processingState.status === 'error' ? (
              <div className="p-20 text-center text-red-600 font-medium">{processingState.message}</div>
            ) : (
              <Editor 
                segments={segments} 
                onSegmentChange={updateSegment} 
                onSpeakerChange={updateSpeaker} 
                onSegmentClick={(time) => {
                  const [m, s] = time.split(':').map(Number);
                  setSeekRequest(m * 60 + s);
                }}
                onSegmentBlur={() => {}} 
                onDeleteSegment={deleteSegment} 
                onMergeSegment={mergeSegment}
                onSplitSegment={splitSegment}
                onCorrectSegment={handleCorrectSegment}
                currentAudioTime={currentTime} 
                language={language}
                correctingSegmentId={correctingSegmentId}
              />
            )}
          </main>

          <AudioPlayer file={file} currentTime={currentTime} onTimeUpdate={setCurrentTime} onLoadedMetadata={() => {}} seekRequest={seekRequest} />
        </>
      )}
    </div>
  );
};

export default App;
