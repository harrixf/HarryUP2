import React, { useState, useEffect, useRef } from 'react';
import { UploadIcon, MagicIcon, CheckIcon, UndoIcon, RedoIcon, DownloadIcon, PlusIcon, MenuIcon, XMarkIcon, ClockIcon, AlertIcon, TrashIcon } from './components/Icons';
import { AudioPlayer } from './components/AudioPlayer';
import { Editor } from './components/Editor';
import { transcribeAudio, refineTranscript } from './services/geminiService';
import { TranscriptSegment, EditMode, ProcessingState, Language, StoredSession } from './types';

interface HistoryState {
  segments: TranscriptSegment[];
  mode: EditMode;
}

type SaveStatus = 'saved' | 'saving' | 'error' | 'idle';

// --- CUSTOM MODAL COMPONENT ---
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
          <button 
            onClick={onCancel}
            className="px-4 py-2.5 rounded-lg text-gray-600 hover:bg-gray-100 font-medium transition-colors text-sm"
          >
            Cancelar
          </button>
          <button 
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-medium shadow-md transition-all hover:shadow-lg text-sm active:scale-95"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  // Core State
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>(""); 
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [processingState, setProcessingState] = useState<ProcessingState>({ status: 'idle' });
  const [currentTime, setCurrentTime] = useState(0);
  const [seekRequest, setSeekRequest] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<EditMode>(EditMode.RAW);
  const [language, setLanguage] = useState<Language>('es');
  
  // UI State
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [includeTimecodes, setIncludeTimecodes] = useState(true); // Option to include timestamps in download
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [savedSessions, setSavedSessions] = useState<StoredSession[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  
  // Dialog State
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  
  // History State
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // --- PERSISTENCE REFS & LOGIC ---
  const segmentsRef = useRef(segments);
  const editModeRef = useRef(editMode);
  const fileNameRef = useRef(fileName);
  const savedSessionsRef = useRef(savedSessions);
  const languageRef = useRef(language);
  const isDirtyRef = useRef(false);

  useEffect(() => {
    segmentsRef.current = segments;
    editModeRef.current = editMode;
    fileNameRef.current = fileName;
    savedSessionsRef.current = savedSessions;
    languageRef.current = language;
  }, [segments, editMode, fileName, savedSessions, language]);

  useEffect(() => {
    if (segments.length > 0 && sessionId) {
      isDirtyRef.current = true;
      setSaveStatus('idle');
    }
  }, [segments, editMode, fileName, sessionId]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('chronicle_sessions');
      if (stored) {
        const sessions: StoredSession[] = JSON.parse(stored);
        setSavedSessions(sessions.sort((a, b) => b.date - a.date));
      }
    } catch (e) {
      console.error("Failed to load sessions", e);
    }
  }, []);

  useEffect(() => {
    const saveSession = () => {
      if (!sessionId || !isDirtyRef.current || segmentsRef.current.length === 0) return;
      setSaveStatus('saving');
      const sessionToSave: StoredSession = {
        id: sessionId,
        name: fileNameRef.current || `Transcripción ${new Date().toLocaleDateString()}`,
        date: Date.now(),
        segments: segmentsRef.current,
        language: languageRef.current,
        editMode: editModeRef.current
      };
      const currentSaved = savedSessionsRef.current;
      const updated = [sessionToSave, ...currentSaved.filter(s => s.id !== sessionId)];
      try {
        localStorage.setItem('chronicle_sessions', JSON.stringify(updated));
        setSavedSessions(updated);
        isDirtyRef.current = false;
        setSaveStatus('saved');
      } catch (e) {
        console.error("Storage failed", e);
        setSaveStatus('error');
      }
    };
    const intervalId = setInterval(saveSession, 30000);
    const handleBeforeUnload = () => saveSession();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      saveSession();
    };
  }, [sessionId]);

  // --- CONFIRMATION ACTIONS ---

  const requestLoadSession = (session: StoredSession) => {
    const doLoad = () => {
      setSessionId(session.id);
      setFileName(session.name);
      setSegments(session.segments);
      setLanguage(session.language);
      setEditMode(session.editMode);
      setFile(null);
      setHistory([{ segments: session.segments, mode: session.editMode }]);
      setHistoryIndex(0);
      setProcessingState({ status: 'completed' });
      setIsSidebarOpen(false);
      isDirtyRef.current = false;
      setSaveStatus('saved');
      setDialog(prev => ({ ...prev, isOpen: false }));
    };

    if (sessionId && isDirtyRef.current) {
      setDialog({
        isOpen: true,
        title: language === 'es' ? '¿Cambiar de transcripción?' : 'Aldatu transkripzioa?',
        message: language === 'es' 
          ? 'Hay cambios sin guardar. Si cambias ahora, se guardará el trabajo actual automáticamente. ¿Continuar?' 
          : 'Gorde gabeko aldaketak daude. Orain aldatzen baduzu, uneko lana automatikoki gordeko da. Jarraitu?',
        onConfirm: doLoad
      });
    } else {
      doLoad();
    }
  };

  const requestDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDialog({
      isOpen: true,
      title: language === 'es' ? '¿Eliminar transcripción?' : 'Ezabatu transkripzioa?',
      message: language === 'es' 
        ? 'Esta acción borrará la transcripción permanentemente. No se puede deshacer.' 
        : 'Ekintza honek transkripzioa behin betiko ezabatuko du. Ezin da desegin.',
      onConfirm: () => {
        const updated = savedSessions.filter(s => s.id !== id);
        setSavedSessions(updated);
        localStorage.setItem('chronicle_sessions', JSON.stringify(updated));
        if (sessionId === id) resetApp();
        setDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const requestResetApp = () => {
    setDialog({
      isOpen: true,
      title: language === 'es' ? '¿Nueva transcripción?' : 'Transkripzio berria?',
      message: language === 'es' 
        ? 'Se cerrará la sesión actual. ¿Deseas comenzar un proyecto nuevo?' 
        : 'Uneko saioa itxiko da. Proiektu berri bat hasi nahi duzu?',
      onConfirm: () => {
        resetApp();
        setDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const resetApp = () => {
    setFile(null);
    setFileName("");
    setSessionId(null);
    setProcessingState({ status: 'idle' }); 
    setSegments([]); 
    setHistory([]);
    setHistoryIndex(-1);
    isDirtyRef.current = false;
    setSaveStatus('idle');
  };

  // --- HANDLERS ---

  const addToHistory = (newSegments: TranscriptSegment[], mode: EditMode) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({
      segments: JSON.parse(JSON.stringify(newSegments)),
      mode
    });
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const state = history[newIndex];
      setSegments(state.segments);
      setEditMode(state.mode);
      setHistoryIndex(newIndex);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const state = history[newIndex];
      setSegments(state.segments);
      setEditMode(state.mode);
      setHistoryIndex(newIndex);
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

      const newSessionId = Date.now().toString();
      setSessionId(newSessionId);
      setProcessingState({ status: 'uploading', message: 'Cargando audio...' });
      
      try {
        setProcessingState({ status: 'transcribing', message: language === 'es' ? 'Transcribiendo y diarizando (esto puede tardar)...' : 'Transkribatzen eta hizlariak identifikatzen...' });
        const transcript = await transcribeAudio(selectedFile, language);
        setSegments(transcript);
        setHistory([{ segments: transcript, mode: EditMode.RAW }]);
        setHistoryIndex(0);
        setProcessingState({ status: 'completed' });
        isDirtyRef.current = true;
      } catch (error: any) {
        setProcessingState({ status: 'error', message: error.message || (language === 'es' ? 'Error en la transcripción.' : 'Errorea transkripzioan.') });
        console.error(error);
      }
    }
  };

  const handleSegmentChange = (id: string, newText: string) => {
    setSegments(prev => prev.map(seg => seg.id === id ? { ...seg, text: newText } : seg));
  };

  const handleSpeakerChange = (id: string, newSpeaker: string) => {
    setSegments(prev => prev.map(seg => seg.id === id ? { ...seg, speaker: newSpeaker } : seg));
  };

  const handleDeleteSegment = (id: string) => {
    const newSegments = segments.filter(seg => seg.id !== id);
    setSegments(newSegments);
    addToHistory(newSegments, editMode);
  };

  const handleMergeSegment = (id: string) => {
    const index = segments.findIndex(s => s.id === id);
    if (index <= 0) return; 
    const prevSegment = segments[index - 1];
    const currentSegment = segments[index];
    const mergedText = `${prevSegment.text} ${currentSegment.text}`;
    const newSegments = [...segments];
    newSegments[index - 1] = { ...prevSegment, text: mergedText };
    newSegments.splice(index, 1);
    setSegments(newSegments);
    addToHistory(newSegments, editMode);
  };

  const handleSplitSegment = (id: string, cursorPosition: number) => {
    const index = segments.findIndex(s => s.id === id);
    if (index === -1) return;

    const originalSegment = segments[index];
    const textBefore = originalSegment.text.substring(0, cursorPosition).trim();
    const textAfter = originalSegment.text.substring(cursorPosition).trim();

    // Allow split even if textAfter is empty (user wants new paragraph at end)
    
    const newSegments = [...segments];
    
    // Update current segment
    newSegments[index] = {
      ...originalSegment,
      text: textBefore
    };

    // Insert new segment
    newSegments.splice(index + 1, 0, {
      id: `seg-split-${Date.now()}`,
      speaker: "?", // Placeholder
      startTime: originalSegment.startTime, // Keep approximate time
      text: textAfter
    });

    setSegments(newSegments);
    addToHistory(newSegments, editMode);
  };

  const handleSegmentBlur = () => {
    const currentHistoryItem = history[historyIndex];
    if (currentHistoryItem && JSON.stringify(segments) !== JSON.stringify(currentHistoryItem.segments)) {
      addToHistory(segments, editMode);
    }
  };

  const handleSegmentClick = (startTimeString: string) => {
    const parts = startTimeString.split(':').map(Number);
    if (parts.length === 2) {
      const seconds = parts[0] * 60 + parts[1];
      setSeekRequest(seconds);
    }
  };

  const handleRefine = async (mode: EditMode) => {
    if (mode === editMode) return;
    let message = '';
    if (language === 'es') {
      message = mode === EditMode.CLEANED ? 'Eliminando muletillas...' : 'Convirtiendo a estilo periodístico...';
    } else {
      message = mode === EditMode.CLEANED ? 'Betegarriak ezabatzen...' : 'Kazetaritza estilora bihurtzen...';
    }
    setProcessingState({ status: 'refining', message });
    try {
      const newSegments = await refineTranscript(segments, mode, language);
      setSegments(newSegments);
      setEditMode(mode);
      addToHistory(newSegments, mode);
      setProcessingState({ status: 'completed' });
    } catch (error: any) {
      setProcessingState({ status: 'error', message: error.message || 'Error al refinar el texto.' });
    }
  };

  const handleDownload = (format: 'txt' | 'json' | 'md') => {
    let content = '';
    const filename = `${fileName.split('.')[0] || 'transcripcion'}-${editMode.toLowerCase()}.${format}`;
    let type = 'text/plain';

    if (format === 'json') {
      content = JSON.stringify(segments, null, 2);
      type = 'application/json';
    } else if (format === 'txt') {
      content = segments.map(s => {
        const timeStr = includeTimecodes ? `[${s.startTime}] ` : '';
        return `${timeStr}${s.speaker}: ${s.text}`;
      }).join('\n\n');
    } else if (format === 'md') {
      content = segments.map(s => {
        const timeStr = includeTimecodes ? `(${s.startTime})` : '';
        return `**${s.speaker}** ${timeStr}\n\n${s.text}`;
      }).join('\n\n');
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setShowDownloadMenu(false);
  };

  const renderLanding = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-gray-50 to-indigo-50/50 p-6">
      <div className="w-full max-w-5xl mx-auto flex flex-col md:flex-row gap-8 items-start">
        <div className="bg-white p-8 md:p-12 rounded-2xl shadow-xl text-center w-full md:w-1/2 border border-indigo-50 flex flex-col items-center">
          <div className="flex justify-center mb-6 text-indigo-600"><UploadIcon /></div>
          <h1 className="text-3xl font-serif font-bold text-gray-900 mb-4">Chronicle AI</h1>
          <p className="text-gray-600 mb-6 text-lg">
            {language === 'es' ? 'Sube tu entrevista. Obtén una transcripción diarizada, edita mientras escuchas y transforma el estilo al instante.' : 'Igo zure elkarrizketa. Lortu transkripzio diarizatua, editatu entzuten duzun bitartean eta eraldatu estiloa berehala.'}
          </p>
          <div className="mb-8 flex justify-center">
            <div className="inline-flex bg-gray-100 p-1 rounded-lg">
              <button onClick={() => setLanguage('es')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${language === 'es' ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}>Castellano</button>
              <button onClick={() => setLanguage('eu')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${language === 'eu' ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}>Euskera</button>
            </div>
          </div>
          <label className="relative cursor-pointer group block w-full">
            <div className="bg-indigo-600 text-white px-8 py-4 rounded-full font-medium text-lg shadow-lg group-hover:bg-indigo-700 transition-all transform group-hover:scale-105 active:scale-95 w-full">
               {language === 'es' ? 'Seleccionar Audio' : 'Hautatu Audioa'}
            </div>
            <input type="file" accept="audio/*" onChange={handleFileChange} className="hidden" />
          </label>
          <p className="mt-4 text-xs text-gray-400">Soporta MP3, WAV, AAC</p>
        </div>
        {savedSessions.length > 0 && (
          <div className="w-full md:w-1/2 bg-white/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-200 self-stretch flex flex-col max-h-[600px]">
            <h2 className="text-xl font-bold text-gray-800 mb-4 font-serif flex items-center gap-2">
              <ClockIcon />{language === 'es' ? 'Recientes' : 'Azkenak'}
            </h2>
            <div className="flex-grow overflow-y-auto space-y-3 pr-2">
              {savedSessions.map(session => (
                <div key={session.id} onClick={() => requestLoadSession(session)} className="bg-white p-4 rounded-xl border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer group flex justify-between items-center relative">
                  <div className="pr-10">
                    <h3 className="font-medium text-gray-900 truncate max-w-[200px]">{session.name}</h3>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                       <span>{new Date(session.date).toLocaleDateString()}</span><span>•</span><span className="uppercase">{session.language}</span><span className="text-indigo-400 bg-indigo-50 px-1.5 rounded">{session.segments.length} segs</span>
                    </div>
                  </div>
                  <button onClick={(e) => requestDeleteSession(e, session.id)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-red-500 hover:bg-red-50 p-3 rounded-full transition-all opacity-0 group-hover:opacity-100 z-10" title="Eliminar"><TrashIcon /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const isProcessing = ['uploading', 'transcribing', 'refining'].includes(processingState.status);
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  let progressPercentage = 0;
  if (processingState.status === 'uploading') progressPercentage = 15;
  else if (processingState.status === 'transcribing') progressPercentage = 45;
  else if (processingState.status === 'refining') progressPercentage = 80;
  else if (processingState.status === 'completed') progressPercentage = 100;

  return (
    <div className="h-screen bg-paper flex flex-col overflow-hidden">
      <ConfirmDialog 
        isOpen={dialog.isOpen} 
        title={dialog.title} 
        message={dialog.message} 
        onConfirm={dialog.onConfirm} 
        onCancel={() => setDialog(prev => ({ ...prev, isOpen: false }))} 
      />

      {(!file && !sessionId && processingState.status === 'idle') ? renderLanding() : (
        <>
          {isSidebarOpen && (
            <div className="fixed inset-0 z-50 flex">
              <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setIsSidebarOpen(false)}></div>
              <div className="relative bg-white w-80 shadow-2xl h-full flex flex-col animate-[slideIn_0.3s_ease-out]">
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                  <h2 className="font-serif font-bold text-gray-800">Transcripciones</h2>
                  <button onClick={() => setIsSidebarOpen(false)} className="p-2 text-gray-500 hover:bg-gray-200 rounded-full"><XMarkIcon /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {savedSessions.map(session => (
                    <div key={session.id} onClick={() => requestLoadSession(session)} className={`p-3 rounded-lg border cursor-pointer transition-all ${sessionId === session.id ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200' : 'bg-white border-gray-200 hover:border-indigo-300'}`}>
                      <div className="font-medium text-gray-900 text-sm truncate">{session.name}</div>
                      <div className="text-xs text-gray-500 mt-1 flex justify-between"><span>{new Date(session.date).toLocaleDateString()}</span><span className="uppercase bg-gray-100 px-1 rounded">{session.language}</span></div>
                    </div>
                  ))}
                  {savedSessions.length === 0 && <div className="text-center text-gray-400 text-sm py-8">No hay sesiones guardadas.</div>}
                </div>
              </div>
            </div>
          )}

          <header className="absolute top-0 left-0 right-0 bg-white/90 backdrop-blur-md border-b border-gray-200 z-40 shadow-sm h-16">
            <div className="px-4 sm:px-6 h-full flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-indigo-600 transition-colors"><MenuIcon /></button>
                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-serif font-bold">C</div>
                <span className="font-serif font-bold text-gray-800 text-lg hidden sm:block">Chronicle</span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs font-medium rounded uppercase ml-2">{language}</span>
                {isProcessing ? (
                  <span className="flex items-center gap-2 text-xs bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full font-medium animate-pulse border border-indigo-100"><span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>{processingState.message}</span>
                ) : (
                  <span className={`text-xs font-medium transition-colors ml-2 ${saveStatus === 'saved' ? 'text-green-600' : saveStatus === 'saving' ? 'text-amber-500' : saveStatus === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
                      {saveStatus === 'saved' && 'Guardado'}
                      {saveStatus === 'saving' && 'Guardando...'}
                      {saveStatus === 'error' && 'Error guardando'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 sm:gap-4">
                <div className="hidden sm:flex items-center gap-1 border-r border-gray-200 pr-4 mr-1">
                  <button onClick={handleUndo} disabled={!canUndo || isProcessing} className={`p-2 rounded-md transition-colors ${canUndo && !isProcessing ? 'text-gray-600 hover:bg-gray-100 hover:text-indigo-600' : 'text-gray-300 cursor-not-allowed'}`} title="Deshacer"><UndoIcon /></button>
                  <button onClick={handleRedo} disabled={!canRedo || isProcessing} className={`p-2 rounded-md transition-colors ${canRedo && !isProcessing ? 'text-gray-600 hover:bg-gray-100 hover:text-indigo-600' : 'text-gray-300 cursor-not-allowed'}`} title="Rehacer"><RedoIcon /></button>
                </div>
                <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg transition-opacity duration-200">
                  <button onClick={() => handleRefine(EditMode.RAW)} disabled={isProcessing} className={`px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition-all ${editMode === EditMode.RAW ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'} ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}><span className="hidden sm:inline">Original</span><span className="sm:hidden">Orig.</span></button>
                  <button onClick={() => handleRefine(EditMode.CLEANED)} disabled={isProcessing || editMode === EditMode.CLEANED} className={`flex px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition-all items-center gap-2 ${editMode === EditMode.CLEANED ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-700'} ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}>{editMode === EditMode.CLEANED && <CheckIcon />}<span className="hidden sm:inline">{language === 'es' ? 'Sin muletillas' : 'Garbia'}</span><span className="sm:hidden">Limpio</span></button>
                  <button onClick={() => handleRefine(EditMode.JOURNALISTIC)} disabled={isProcessing || editMode === EditMode.JOURNALISTIC} className={`flex px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition-all items-center gap-2 ${editMode === EditMode.JOURNALISTIC ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-700'} ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}><MagicIcon /><span className="hidden sm:inline">{language === 'es' ? 'Periodístico' : 'Kazetaritza'}</span><span className="sm:hidden">Period.</span></button>
                </div>
                <div className="relative">
                  <button onClick={() => setShowDownloadMenu(!showDownloadMenu)} disabled={isProcessing} className={`p-2 rounded-md transition-colors text-gray-600 hover:bg-gray-100 hover:text-indigo-600 ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`} title="Descargar"><DownloadIcon /></button>
                  {showDownloadMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowDownloadMenu(false)} />
                      <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50 py-1">
                        <div className="px-4 py-2 text-xs text-gray-400 uppercase font-bold tracking-wider border-b border-gray-100">Exportar como</div>
                        <label className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer border-b border-gray-100">
                          <input 
                            type="checkbox" 
                            checked={includeTimecodes} 
                            onChange={(e) => setIncludeTimecodes(e.target.checked)}
                            className="mr-2 rounded text-indigo-600 focus:ring-indigo-500"
                          />
                          Incluir Timecodes
                        </label>
                        <button onClick={() => handleDownload('txt')} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Texto plano (.txt)</button>
                        <button onClick={() => handleDownload('md')} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Markdown (.md)</button>
                        <button onClick={() => handleDownload('json')} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">JSON (.json)</button>
                      </div>
                    </>
                  )}
                </div>
                <button onClick={requestResetApp} disabled={isProcessing} className={`p-2 rounded-md transition-colors text-gray-500 hover:bg-red-50 hover:text-red-600 ml-2 ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`} title={language === 'es' ? 'Nuevo Proyecto' : 'Proiektu Berria'}><PlusIcon /></button>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 w-full h-1 bg-gray-100 overflow-hidden">
              <div className={`h-full bg-indigo-600 transition-all duration-700 ease-out ${isProcessing ? 'opacity-100' : 'opacity-0'}`} style={{ width: `${isProcessing ? progressPercentage : 0}%` }}>
                {isProcessing && (<div className="absolute inset-0 bg-white/30 w-full -translate-x-full animate-[shimmer_2s_infinite]" style={{ backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)' }}></div>)}
              </div>
            </div>
          </header>

          <main className="flex-grow overflow-y-auto pt-16 scroll-smooth" id="main-scroll-container">
            {!file && sessionId && segments.length > 0 && (
              <div className="bg-orange-50 border-b border-orange-200 p-3 flex flex-col sm:flex-row items-center justify-center gap-3 text-sm text-orange-800 sticky top-0 z-30 shadow-sm">
                <div className="flex items-center gap-2"><AlertIcon /><span className="font-medium">{language === 'es' ? `Audio no disponible (${fileName}).` : `Audioa ez dago eskuragarri (${fileName}).`}</span><span className="hidden sm:inline text-orange-600">{language === 'es' ? `Por seguridad, el audio no se guarda. Selecciónalo de nuevo para escuchar.` : `Segurtasunagatik, audioa ez da gordetzen. Hautatu berriro entzuteko.`}</span></div>
                <label className="cursor-pointer bg-white border border-orange-300 text-orange-700 px-4 py-1.5 rounded shadow-sm hover:bg-orange-50 transition-all font-bold text-xs uppercase tracking-wide active:scale-95">{language === 'es' ? 'Reconectar Audio Original' : 'Konektatu Jatorrizko Audioa'}<input type="file" accept="audio/*" onChange={handleFileChange} className="hidden" /></label>
              </div>
            )}

            {processingState.status === 'error' ? (
              <div className="flex flex-col items-center justify-center py-20 px-4 text-center h-full">
                <div className="bg-red-50 text-red-600 p-4 rounded-full mb-4"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg></div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Ocurrió un error</h2>
                <p className="text-gray-600 max-w-md">{processingState.message}</p>
              </div>
            ) : (processingState.status === 'transcribing' || processingState.status === 'uploading') ? (
              <div className="flex flex-col items-center justify-center h-full">
                <div className="relative"><div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-100 border-t-indigo-600"></div></div>
                <h3 className="mt-6 text-lg font-medium text-gray-900">{processingState.message}</h3>
                <p className="text-gray-400 mt-2 text-sm">Esto puede tardar unos segundos...</p>
              </div>
            ) : (
              <div className={`transition-opacity duration-500 ${processingState.status === 'refining' ? 'opacity-50 pointer-events-none grayscale-[0.3]' : 'opacity-100'}`}>
                <Editor 
                  segments={segments} 
                  onSegmentChange={handleSegmentChange} 
                  onSpeakerChange={handleSpeakerChange} 
                  onSegmentClick={handleSegmentClick} 
                  onSegmentBlur={handleSegmentBlur} 
                  onDeleteSegment={handleDeleteSegment} 
                  onMergeSegment={handleMergeSegment}
                  onSplitSegment={handleSplitSegment}
                  currentAudioTime={currentTime} 
                />
              </div>
            )}
          </main>

          <div className={!file || processingState.status === 'transcribing' || processingState.status === 'uploading' ? 'opacity-0 pointer-events-none' : 'opacity-100 transition-opacity duration-500'}>
            <AudioPlayer file={file} currentTime={currentTime} onTimeUpdate={setCurrentTime} onLoadedMetadata={() => {}} seekRequest={seekRequest} />
          </div>
        </>
      )}
      
      <style>{`
        @keyframes shimmer { 100% { transform: translateX(100%); } }
        @keyframes slideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
};

export default App;