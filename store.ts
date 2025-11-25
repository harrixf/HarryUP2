import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TranscriptSegment, EditMode, ProcessingState, Language, StoredSession } from './types';

interface AppState {
  // Preferences & UI
  language: Language;
  setLanguage: (lang: Language) => void;
  isSidebarOpen: boolean;
  setSidebarOpen: (isOpen: boolean) => void;
  
  // Active Session State
  sessionId: string | null;
  fileName: string;
  segments: TranscriptSegment[];
  editMode: EditMode;
  processingState: ProcessingState;
  
  // Session Actions
  setSessionId: (id: string | null) => void;
  setFileName: (name: string) => void;
  setSegments: (segments: TranscriptSegment[]) => void;
  setEditMode: (mode: EditMode) => void;
  setProcessingState: (state: ProcessingState) => void;
  
  // Segment Logic
  updateSegment: (id: string, newText: string) => void;
  updateSpeaker: (id: string, newSpeaker: string) => void;
  deleteSegment: (id: string) => void;
  mergeSegment: (id: string) => void;
  splitSegment: (id: string, cursorPosition: number) => void;
  
  // Persistence (Saved Sessions)
  savedSessions: StoredSession[];
  saveCurrentSession: () => void;
  deleteSession: (id: string) => void;
  loadSession: (session: StoredSession) => void;
  resetSession: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Preferences
      language: 'es',
      setLanguage: (lang) => set({ language: lang }),
      isSidebarOpen: false,
      setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),

      // Active Session
      sessionId: null,
      fileName: "",
      segments: [],
      editMode: EditMode.RAW,
      processingState: { status: 'idle' },

      setSessionId: (id) => set({ sessionId: id }),
      setFileName: (name) => set({ fileName: name }),
      setSegments: (segments) => set({ segments }),
      setEditMode: (mode) => set({ editMode: mode }),
      setProcessingState: (state) => set({ processingState: state }),

      // Segment Logic
      updateSegment: (id, newText) => set((state) => ({
        segments: state.segments.map(s => s.id === id ? { ...s, text: newText } : s)
      })),

      updateSpeaker: (id, newSpeaker) => set((state) => ({
        segments: state.segments.map(s => s.id === id ? { ...s, speaker: newSpeaker } : s)
      })),

      deleteSegment: (id) => set((state) => ({
        segments: state.segments.filter(s => s.id !== id)
      })),

      mergeSegment: (id) => set((state) => {
        const index = state.segments.findIndex(s => s.id === id);
        if (index <= 0) return state;
        
        const prevSegment = state.segments[index - 1];
        const currentSegment = state.segments[index];
        const mergedText = `${prevSegment.text} ${currentSegment.text}`;
        
        const newSegments = [...state.segments];
        newSegments[index - 1] = { ...prevSegment, text: mergedText };
        newSegments.splice(index, 1);
        
        return { segments: newSegments };
      }),

      splitSegment: (id, cursorPosition) => set((state) => {
        const index = state.segments.findIndex(s => s.id === id);
        if (index === -1) return state;

        const originalSegment = state.segments[index];
        const textBefore = originalSegment.text.substring(0, cursorPosition).trim();
        const textAfter = originalSegment.text.substring(cursorPosition).trim();

        const newSegments = [...state.segments];
        // Update text of current segment
        newSegments[index] = { ...originalSegment, text: textBefore };
        // Insert new segment after
        newSegments.splice(index + 1, 0, {
          id: `seg-split-${Date.now()}`,
          speaker: "?",
          startTime: originalSegment.startTime,
          text: textAfter
        });

        return { segments: newSegments };
      }),

      // Persistence
      savedSessions: [],
      
      saveCurrentSession: () => {
        const { sessionId, fileName, segments, language, editMode, savedSessions } = get();
        if (!sessionId || segments.length === 0) return;

        const sessionToSave: StoredSession = {
          id: sessionId,
          name: fileName || `Transcripción ${new Date().toLocaleDateString()}`,
          date: Date.now(),
          segments,
          language,
          editMode
        };

        const updatedSessions = [sessionToSave, ...savedSessions.filter(s => s.id !== sessionId)];
        set({ savedSessions: updatedSessions });
      },

      deleteSession: (id) => {
        const { sessionId } = get();
        set((state) => ({
          savedSessions: state.savedSessions.filter(s => s.id !== id)
        }));
        if (sessionId === id) {
            get().resetSession();
        }
      },

      loadSession: (session) => set({
        sessionId: session.id,
        fileName: session.name,
        segments: session.segments,
        language: session.language,
        editMode: session.editMode,
        processingState: { status: 'completed' },
        isSidebarOpen: false
      }),

      resetSession: () => set({
        sessionId: null,
        fileName: "",
        segments: [],
        editMode: EditMode.RAW,
        processingState: { status: 'idle' }
      })
    }),
    {
      name: 'harryup-storage',
      partialize: (state) => ({ 
        savedSessions: state.savedSessions,
        language: state.language
      }),
    }
  )
);