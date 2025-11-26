import React, { useEffect, useState, useMemo } from 'react';
import { TranscriptSegment, Language } from '../types';
import { TrashIcon, MergeUpIcon, SpellcheckIcon } from './Icons';

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
}

const parseTimeString = (timeStr: string): number => {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
};

// Generate distinct colors based on speaker name
const getSpeakerColor = (name: string) => {
  const colors = [
    'text-indigo-600',
    'text-emerald-600',
    'text-amber-600',
    'text-rose-600',
    'text-cyan-600',
    'text-fuchsia-600',
    'text-blue-600',
    'text-violet-600',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

export const Editor: React.FC<EditorProps> = ({ 
  segments, 
  onSegmentChange, 
  onSpeakerChange,
  onSegmentClick, 
  onSegmentBlur,
  onDeleteSegment,
  onMergeSegment,
  onSplitSegment,
  onCorrectSegment,
  currentAudioTime,
  language,
  correctingSegmentId
}) => {
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(-1);

  // Extract unique speakers for the dropdown/datalist
  const uniqueSpeakers = useMemo(() => {
    const speakers = new Set(segments.map(s => s.speaker));
    return Array.from(speakers).filter(Boolean);
  }, [segments]);

  // Detect active segment based on time
  useEffect(() => {
    const index = segments.findIndex((segment, i) => {
      const start = parseTimeString(segment.startTime);
      const nextSegment = segments[i + 1];
      const end = nextSegment ? parseTimeString(nextSegment.startTime) : start + 30;
      return currentAudioTime >= start && currentAudioTime < end;
    });

    if (index !== -1 && index !== activeSegmentIndex) {
      setActiveSegmentIndex(index);
    }
  }, [currentAudioTime, segments, activeSegmentIndex]);

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeSegmentIndex !== -1) {
      const el = document.getElementById(`segment-${activeSegmentIndex}`);
      if (el) {
        el.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        });
      }
    }
  }, [activeSegmentIndex]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, id: string, index: number) => {
    // Merge on Backspace at start of text
    if (e.key === 'Backspace') {
      const target = e.currentTarget;
      if (target.selectionStart === 0 && target.selectionEnd === 0) {
        if (target.value.length === 0) {
           // If empty, just delete
           e.preventDefault();
           onDeleteSegment(id);
        } else if (index > 0) {
           // If not empty but at start, merge with previous
           e.preventDefault();
           onMergeSegment(id);
        }
      }
    }

    // Split on Enter
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const target = e.currentTarget;
      const cursorPosition = target.selectionStart;
      onSplitSegment(id, cursorPosition);
    }
  };

  return (
    <div className="max-w-3xl mx-auto pb-40 pt-8 px-4 sm:px-6">
      {/* Global Datalist for Speakers */}
      <datalist id="known-speakers">
        {uniqueSpeakers.map((speaker) => (
          <option key={speaker} value={speaker} />
        ))}
      </datalist>

      <div className="space-y-6">
        {segments.map((segment, index) => {
          const isActive = index === activeSegmentIndex;
          const speakerColor = getSpeakerColor(segment.speaker);
          const isCorrecting = correctingSegmentId === segment.id;

          return (
            <div 
              key={segment.id} 
              id={`segment-${index}`}
              className={`group relative p-4 rounded-lg transition-all duration-300 border-l-4 scroll-mt-32 scroll-mb-32 ${isActive ? 'bg-indigo-50 border-indigo-500 shadow-sm' : 'bg-white border-transparent hover:bg-gray-50'}`}
            >
              <div className="flex items-center justify-between mb-2 gap-4 relative">
                <div className="relative w-full">
                  <input
                    type="text"
                    list="known-speakers"
                    value={segment.speaker}
                    onChange={(e) => onSpeakerChange(segment.id, e.target.value)}
                    onBlur={onSegmentBlur}
                    className={`text-xs font-bold tracking-wider uppercase bg-transparent border-none p-0 focus:ring-0 cursor-pointer hover:opacity-80 w-full transition-colors ${speakerColor}`}
                    placeholder="Nombre del hablante"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  {/* Action Buttons - Visible on Hover or Active */}
                  <div className={`flex items-center gap-1 transition-opacity duration-200 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    {/* Correction Button */}
                    <button
                      onClick={() => onCorrectSegment(segment.id)}
                      disabled={isCorrecting}
                      className={`p-1 rounded transition-colors ${isCorrecting ? 'text-indigo-400' : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
                      title={language === 'eu' ? "Zuzendu (Xuxen/AI)" : "Corregir ortografía"}
                    >
                      {isCorrecting ? (
                        <div className="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
                      ) : (
                        <SpellcheckIcon />
                      )}
                    </button>

                    {index > 0 && (
                      <button
                        onClick={() => onMergeSegment(segment.id)}
                        className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                        title="Fusionar con el anterior"
                      >
                        <MergeUpIcon />
                      </button>
                    )}
                    <button
                      onClick={() => onDeleteSegment(segment.id)}
                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Eliminar segmento"
                    >
                      <TrashIcon />
                    </button>
                  </div>

                  <button 
                    onClick={() => onSegmentClick(segment.startTime)}
                    className="shrink-0 text-xs font-mono text-gray-400 hover:text-indigo-600 transition-colors cursor-pointer bg-gray-100 px-2 py-1 rounded select-none"
                  >
                    {segment.startTime}
                  </button>
                </div>
              </div>
              
              <textarea
                className={`w-full resize-none bg-transparent border-none focus:ring-0 p-0 font-serif text-lg leading-relaxed outline-none transition-colors ${isActive ? 'text-gray-900' : 'text-gray-700'} ${isCorrecting ? 'opacity-50 blur-[1px]' : ''}`}
                rows={Math.ceil(segment.text.length / 60) || 1}
                value={segment.text}
                onChange={(e) => onSegmentChange(segment.id, e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, segment.id, index)}
                onFocus={() => onSegmentClick(segment.startTime)}
                onBlur={onSegmentBlur}
                readOnly={isCorrecting}
                style={{ minHeight: '1.5em' }}
                lang={language}
                spellCheck={true}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};