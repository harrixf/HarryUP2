import React, { useRef, useEffect, useState } from 'react';
import { PlayIcon, PauseIcon, Rewind15Icon, Forward15Icon } from './Icons';

interface AudioPlayerProps {
  file: File | null;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  onLoadedMetadata: (duration: number) => void;
  seekRequest: number | null; // Timestamp to jump to
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ 
  file, 
  currentTime, 
  onTimeUpdate, 
  onLoadedMetadata,
  seekRequest
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);

  const playbackRates = [1, 1.5, 2, 2.5, 3];

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  useEffect(() => {
    if (seekRequest !== null && audioRef.current) {
      audioRef.current.currentTime = seekRequest;
      if (!isPlaying) {
          audioRef.current.play();
          setIsPlaying(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest]);

  // Sync playback rate when it changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      onTimeUpdate(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      onLoadedMetadata(audioRef.current.duration);
    }
  };

  const skip = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.min(Math.max(audioRef.current.currentTime + seconds, 0), duration);
    }
  };

  const togglePlaybackRate = () => {
    const nextIndex = (playbackRates.indexOf(playbackRate) + 1) % playbackRates.length;
    setPlaybackRate(playbackRates[nextIndex]);
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (!file || !audioUrl) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] p-4 z-50">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />
      
      <div className="max-w-4xl mx-auto flex items-center gap-4">
        
        {/* Controls Group */}
        <div className="flex items-center gap-2">
          <button 
            onClick={() => skip(-15)}
            className="p-2 text-gray-500 hover:text-indigo-600 transition-colors"
            title="Retroceder 15s"
          >
            <Rewind15Icon />
          </button>

          <button 
            onClick={togglePlay}
            className="p-3 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-md"
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>

          <button 
            onClick={() => skip(15)}
            className="p-2 text-gray-500 hover:text-indigo-600 transition-colors"
            title="Adelantar 15s"
          >
            <Forward15Icon />
          </button>
        </div>

        {/* Time Display */}
        <div className="text-sm font-medium text-gray-500 w-12 tabular-nums">
          {formatTime(currentTime)}
        </div>

        {/* Scrubber */}
        <div className="flex-1 relative h-2 bg-gray-200 rounded-full cursor-pointer group"
           onClick={(e) => {
             const rect = e.currentTarget.getBoundingClientRect();
             const x = e.clientX - rect.left;
             const percentage = x / rect.width;
             if (audioRef.current) {
               const newTime = percentage * duration;
               audioRef.current.currentTime = newTime;
               onTimeUpdate(newTime);
             }
           }}
        >
          <div 
            className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full pointer-events-none transition-all duration-100"
            style={{ width: `${(currentTime / duration) * 100}%` }}
          />
          <div 
             className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-indigo-600 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
             style={{ left: `${(currentTime / duration) * 100}%` }}
          />
        </div>

        {/* Duration */}
        <div className="text-sm font-medium text-gray-500 w-12 text-right tabular-nums">
          {formatTime(duration)}
        </div>

        {/* Speed Toggle */}
        <button 
          onClick={togglePlaybackRate}
          className="w-12 px-2 py-1 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-200 transition-colors"
          title="Velocidad de reproducción"
        >
          {playbackRate}x
        </button>
      </div>
    </div>
  );
};