
import React, { useEffect, useState, useMemo } from 'react';
import { TranscriptSegment, Language } from '../types';
import { TrashIcon, MergeUpIcon, SpellcheckIcon, SearchIcon, XMarkIcon } from './Icons';

interface EditorProps {
  segments: TranscriptSegment[];
  onSegmentChange: (id: string, newText: string) => void;
  onSpeakerChange: (id: string, newSpeaker: string) => void;
  onSegmentClick: (startTimeString: string) => void;
  onSegmentBlur: () => void;
  onDeleteSegment: (id: string) => void;
  onMergeSegment: (id: string) => void;
  onSplitSegment: (id: string, cursorPosition: number) => void;
  onCorrectSegment: (id: string) => void;
  currentAudioTime: number;
  language: Language;
  correctingSegmentId: string | null;
  searchTerm: string;
}

const parseTimeString = (timeStr: string): number => {
  const parts = timeStr.split(':').map(Number);
  return parts.length === 2 ? parts[0] * 60 + parts[1] : 0;
};

const getSpeakerColor = (name: string) => {
  const colors = ['text-indigo-600', 'text-emerald-600', 'text-amber-600', 'text-rose-600', 'text-cyan-600', 'text-fuchsia-600', 'text-blue-600', 'text-violet-600'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

export const Editor: React.FC<EditorProps> = ({ 
  segments, onSegmentChange, onSpeakerChange, onSegmentClick, onSegmentBlur, onDeleteSegment, onMergeSegment, onSplitSegment, onCorrectSegment, currentAudioTime, language, correctingSegmentId, searchTerm
}) => {
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(-1);

  const filteredSegments = useMemo(() => {
    if (!searchTerm.trim()) return segments;
    const lowerSearch = searchTerm.toLowerCase();
    return segments.filter(s => 
      s.text.toLowerCase().includes(lowerSearch) || 
      s.speaker.toLowerCase().includes(lowerSearch)
    );
  }, [segments, searchTerm]);

  useEffect(() => {
    const index = segments.findIndex((segment, i) => {
      const start = parseTimeString(segment.startTime);
      const nextSegment = segments[i + 1];
      const end = nextSegment ? parseTimeString(nextSegment.startTime) : start + 30;
      return currentAudioTime >= start && currentAudioTime < end;
    });
    if (index !== -1 && index !== activeSegmentIndex) setActiveSegmentIndex(index);
  }, [currentAudioTime, segments, activeSegmentIndex]);

  useEffect(() => {
    if (activeSegmentIndex !== -1 && !searchTerm) {
      const el = document.getElementById(`segment-${activeSegmentIndex}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeSegmentIndex, searchTerm]);

  const highlightText = (text: string) => {
    if (!searchTerm.trim()) return text;
    const parts = text.split(new RegExp(`(${searchTerm})`, 'gi'));
    return parts.map((part, i) => 
      part.toLowerCase() === searchTerm.toLowerCase() 
        ? <mark key={i} className="bg-yellow-200 text-ink rounded-sm px-0.5">{part}</mark> 
        : part
    );
  };

  return (
    <div className="max-w-3xl mx-auto pb-40 pt-8 px-4 sm:px-6">
      <datalist id="known-speakers">
        {Array.from(new Set(segments.map(s => s.speaker))).map(s => <option key={s} value={s} />)}
      </datalist>

      {filteredSegments.length === 0 && searchTerm && (
        <div className="text-center py-20 text-gray-400">
          <p>{language === 'es' ? 'No se encontraron resultados para su búsqueda.' : 'Ez da emaitzarik aurkitu zure bilaketarako.'}</p>
        </div>
      )}

      <div className="space-y-6">
        {filteredSegments.map((segment) => {
          const originalIndex = segments.findIndex(s => s.id === segment.id);
          const isActive = originalIndex === activeSegmentIndex;
          const speakerColor = getSpeakerColor(segment.speaker);
          const isCorrecting = correctingSegmentId === segment.id;

          return (
            <div key={segment.id} id={`segment-${originalIndex}`} className={`group relative p-4 rounded-lg transition-all duration-300 border-l-4 ${isActive ? 'bg-indigo-50 border-indigo-500 shadow-sm' : 'bg-white border-transparent hover:bg-gray-50'}`}>
              <div className="flex items-center justify-between mb-2 gap-4">
                <input
                  type="text" list="known-speakers" value={segment.speaker}
                  onChange={(e) => onSpeakerChange(segment.id, e.target.value)}
                  className={`text-xs font-bold tracking-wider uppercase bg-transparent border-none p-0 focus:ring-0 cursor-pointer w-full ${speakerColor}`}
                />
                <div className="flex items-center gap-2">
                  <div className={`flex items-center gap-1 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <button onClick={() => onCorrectSegment(segment.id)} disabled={isCorrecting} className="p-1 rounded text-gray-400 hover:text-indigo-600"><SpellcheckIcon /></button>
                    <button onClick={() => onMergeSegment(segment.id)} className="p-1 text-gray-400 hover:text-indigo-600"><MergeUpIcon /></button>
                    <button onClick={() => onDeleteSegment(segment.id)} className="p-1 text-gray-400 hover:text-red-600"><TrashIcon /></button>
                  </div>
                  <button onClick={() => onSegmentClick(segment.startTime)} className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-1 rounded">{segment.startTime}</button>
                </div>
              </div>
              <textarea
                className={`w-full resize-none bg-transparent border-none focus:ring-0 p-0 font-serif text-lg leading-relaxed outline-none transition-colors ${isActive ? 'text-gray-900' : 'text-gray-700'}`}
                rows={Math.ceil(segment.text.length / 60) || 1}
                value={segment.text}
                onChange={(e) => onSegmentChange(segment.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && e.currentTarget.selectionStart === 0) onMergeSegment(segment.id);
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSplitSegment(segment.id, e.currentTarget.selectionStart); }
                }}
                onFocus={() => onSegmentClick(segment.startTime)}
                readOnly={isCorrecting}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
