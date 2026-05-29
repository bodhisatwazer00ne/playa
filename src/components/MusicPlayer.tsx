import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, ListMusic, ChevronDown, Music, Repeat, Repeat1, Shuffle, Heart, Plus, RotateCcw, RotateCw, Image as ImageIcon, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DriveFile, RepeatMode, Playlist } from '../types';
import { cn, formatTime } from '../lib/utils';
import { getStreamUrl } from '../lib/drive';

interface MusicPlayerProps {
  currentFile: DriveFile | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  accessToken: string | null;
  queue: DriveFile[];
  repeatMode: RepeatMode;
  onToggleRepeat: () => void;
  shuffle: boolean;
  onToggleShuffle: () => void;
  volume: number;
  onVolumeChange: (val: number) => void;
  isLiked: boolean;
  onToggleLike: () => void;
  playlists: Playlist[];
  onAddToPlaylist: (songId: string, playlistId: string) => void;
  onCreatePlaylist: () => void;
  isExpanded: boolean;
  onToggleExpand: (val: boolean) => void;
  trackMetadata: Record<string, string>;
  onUpdateTrackCover: (songId: string, url: string) => void;
}

export function MusicPlayer({ 
  currentFile, 
  isPlaying, 
  onTogglePlay, 
  onNext, 
  onPrev,
  accessToken,
  queue,
  repeatMode,
  onToggleRepeat,
  shuffle,
  onToggleShuffle,
  volume,
  onVolumeChange,
  isLiked,
  onToggleLike,
  playlists,
  onAddToPlaylist,
  onCreatePlaylist,
  isExpanded,
  onToggleExpand,
  trackMetadata,
  onUpdateTrackCover
}: MusicPlayerProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showVolume, setShowVolume] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [showCoverInput, setShowCoverInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 400;
        const MAX_HEIGHT = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        const base64 = canvas.toDataURL('image/jpeg', 0.7);
        onUpdateTrackCover(currentFile.id, base64);
        setShowCoverInput(false);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const currentCover = trackMetadata[currentFile?.id || ''] || currentFile?.thumbnailLink;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !accessToken) return;

    const handlePlay = async () => {
      try {
        if (isPlaying) {
          await audio.play();
        } else {
          audio.pause();
        }
      } catch (error: any) {
        // Catch AbortError which happens when play() is interrupted by pause() or a src change
        if (error.name !== 'AbortError') {
          console.error("Playback error:", error);
        }
      }
    };

    handlePlay();
  }, [isPlaying, currentFile, accessToken]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const seekRelative = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(duration, audioRef.current.currentTime + seconds));
    }
  };

  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);

  if (!currentFile) return null;

  return (
    <div className={cn(
      "fixed bottom-0 left-0 right-0 z-50 transition-all duration-500 ease-in-out",
      isExpanded ? "h-full bg-white pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]" : "h-[calc(5rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-white/90 backdrop-blur-xl border-t border-slate-100"
    )}>
      <audio
        ref={audioRef}
        src={accessToken ? getStreamUrl(currentFile.id, accessToken) : undefined}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onError={(e) => {
          const audio = e.currentTarget;
          console.error("Audio element error details:", {
            error: audio.error,
            errorCode: audio.error?.code,
            errorMessage: audio.error?.message,
            networkState: audio.networkState,
            readyState: audio.readyState,
            currentSrc: audio.currentSrc
          });
        }}
        onEnded={repeatMode === 'one' ? () => { 
          if (audioRef.current) {
            audioRef.current.currentTime = 0; 
            audioRef.current.play().catch(err => {
              if (err.name !== 'AbortError') console.error(err);
            });
          }
        } : onNext}
        crossOrigin="anonymous"
        preload="auto"
      />

      <AnimatePresence>
        {!isExpanded ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="flex flex-col h-full cursor-pointer"
            onClick={() => onToggleExpand(true)}
          >
            {/* Progress bar atop mini player */}
            <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-slate-50">
              <div 
                className="h-full bg-slate-900 transition-all duration-100" 
                style={{ width: `${(currentTime / duration) * 100}%` }} 
              />
            </div>

            <div className="flex items-center justify-between px-6 h-full">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center overflow-hidden flex-shrink-0 border border-slate-100 shadow-sm relative group">
                  {currentCover ? (
                    <img src={currentCover} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <Music className="w-6 h-6 text-slate-300" />
                  )}
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold truncate text-slate-900 text-sm leading-tight">{currentFile.name.replace(/\.[^/.]+$/, "")}</h4>
                  <p className="text-[10px] text-slate-400 font-medium tracking-widest uppercase mt-0.5">Cloud Media</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button 
                  onClick={(e) => { e.stopPropagation(); onTogglePlay(); }}
                  className="w-11 h-11 flex items-center justify-center bg-slate-900 text-white rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-all"
                >
                  {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} className="ml-0.5" fill="currentColor" />}
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); onNext(); }}
                  className="p-2 text-slate-300 hover:text-slate-900 transition-colors"
                >
                  <SkipForward size={22} />
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col h-full max-w-xl mx-auto w-full relative"
            >
              <div className="absolute inset-0 pb-8 pt-6 sm:pb-12 sm:pt-8 px-6 sm:px-8 flex flex-col no-scrollbar justify-between">
                <header className="flex items-center justify-between mb-4 sm:mb-8 shrink-0">
                  <button 
                    onClick={() => onToggleExpand(false)}
                    className="p-3 bg-slate-50 hover:bg-slate-100 rounded-2xl transition-all"
                  >
                    <ChevronDown size={24} className="text-slate-400" />
                  </button>
                  <div className="text-center">
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-300">Listening To</p>
                  </div>
                  <div className="relative flex items-center gap-2">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "p-3 bg-slate-50 hover:bg-slate-100 rounded-2xl transition-all text-slate-400"
                      )}
                      title="Update Cover Art"
                    >
                      <ImageIcon size={24} />
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept="image/*" 
                        onChange={handleFileChange}
                      />
                    </button>

                    <button 
                      onClick={() => setShowPlaylistMenu(!showPlaylistMenu)}
                      className={cn(
                        "p-3 bg-slate-50 hover:bg-slate-100 rounded-2xl transition-all",
                        showPlaylistMenu && "text-accent"
                      )}
                    >
                      <Plus size={24} className={cn(!showPlaylistMenu && "text-slate-400")} />
                    </button>

                    <AnimatePresence>
                      {showPlaylistMenu && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: 10 }}
                          className="absolute right-0 top-full mt-3 w-56 bg-white border border-slate-100 rounded-[2rem] p-3 shadow-3xl z-20 backdrop-blur-2xl"
                        >
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 p-2 mb-2 border-b border-slate-50 text-center">Add to Collection</p>
                          <div className="max-h-48 overflow-y-auto space-y-1 no-scrollbar mb-2">
                            {playlists.map(p => (
                              <button 
                                key={p.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAddToPlaylist(currentFile.id, p.id);
                                  setShowPlaylistMenu(false);
                                }}
                                className="w-full text-left px-4 py-3 hover:bg-slate-50 rounded-xl transition-all text-xs font-bold text-slate-600 flex items-center justify-between group"
                              >
                                <span className="truncate">{p.name}</span>
                                <Plus size={14} className="opacity-0 group-hover:opacity-100" />
                              </button>
                            ))}
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              onCreatePlaylist();
                              setShowPlaylistMenu(false);
                            }}
                            className="w-full text-center py-3 bg-slate-900 text-white rounded-xl transition-all text-[10px] font-bold uppercase tracking-widest mt-2"
                          >
                            New Playlist
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </header>

                <div className="flex-1 flex flex-col items-center justify-center gap-4 sm:gap-8 pt-2 overflow-y-auto no-scrollbar">
                  <div className="w-48 h-48 sm:w-80 sm:h-80 rounded-[2.5rem] sm:rounded-[3.5rem] bg-slate-50 border border-slate-100 shadow-sm flex items-center justify-center overflow-hidden relative group shrink-0">
                    {currentCover ? (
                      <img 
                        src={currentCover.replace('=s220', '=s800')} 
                        alt="" 
                        className={cn("w-full h-full object-cover transition-transform duration-700", isPlaying ? "scale-105" : "scale-100")} 
                        referrerPolicy="no-referrer" 
                      />
                    ) : (
                      <Music className="w-16 h-16 sm:w-24 sm:h-24 text-slate-100" />
                    )}
                  </div>
                  
                  <div className="w-full text-center space-y-1 relative shrink-0">
                    <h2 className="text-xl sm:text-3xl font-display text-slate-900 leading-tight capitalize max-w-[90%] mx-auto font-bold truncate">{currentFile.name.replace(/\.[^/.]+$/, "")}</h2>
                    <p className="text-slate-300 font-bold uppercase tracking-[0.2em] text-[8px] sm:text-[10px]">Cloud Media Port</p>
                  </div>

                  <div className="w-full space-y-4 sm:space-y-8 mt-2 sm:mt-4 shrink-0">
                    {/* Controls Row */}
                    <div className="flex items-center justify-center gap-3 sm:gap-4 w-full">
                      <button 
                        onClick={() => seekRelative(-10)}
                        className="text-slate-400 hover:text-slate-900 transition-colors p-2"
                      >
                        <RotateCcw size={18} className="sm:size-[22px]" />
                      </button>

                      <button 
                        onClick={onToggleShuffle}
                        className={cn(
                          "transition-all p-2 rounded-full",
                          shuffle ? "text-accent bg-accent/5" : "text-slate-400 hover:text-slate-600"
                        )}
                      >
                        <Shuffle size={18} className="sm:size-[20px]" />
                      </button>

                      <button 
                        onClick={onPrev} 
                        className="text-slate-600 hover:text-slate-900 transition-all p-2"
                      >
                        <SkipBack size={24} className="sm:size-[28px]" fill="currentColor" fillOpacity={0.1} />
                      </button>

                      <button 
                        onClick={onTogglePlay}
                        className="w-14 h-14 sm:w-20 sm:h-20 flex items-center justify-center bg-slate-900 text-white rounded-full hover:scale-105 active:scale-95 transition-all shadow-xl shrink-0"
                      >
                        {isPlaying ? <Pause size={24} className="sm:size-[36px]" fill="currentColor" /> : <Play size={24} className="sm:size-[36px] ml-1" fill="currentColor" />}
                      </button>

                      <button 
                        onClick={onNext} 
                        className="text-slate-600 hover:text-slate-900 transition-all p-2"
                      >
                        <SkipForward size={24} className="sm:size-[28px]" fill="currentColor" fillOpacity={0.1} />
                      </button>

                      <button 
                        onClick={onToggleRepeat}
                        className={cn(
                          "transition-all p-2 rounded-full",
                          repeatMode !== 'off' ? "text-accent bg-accent/5" : "text-slate-400 hover:text-slate-600"
                        )}
                      >
                        {repeatMode === 'one' ? <Repeat1 size={18} className="sm:size-[20px]" /> : <Repeat size={18} className="sm:size-[20px]" />}
                      </button>

                      <button 
                        onClick={() => seekRelative(10)}
                        className="text-slate-400 hover:text-slate-900 transition-colors p-2"
                      >
                        <RotateCw size={18} className="sm:size-[22px]" />
                      </button>
                    </div>

                    {/* Progress Slider */}
                    <div className="w-full space-y-2">
                      <div className="relative group/seeker px-2">
                        <input 
                          type="range"
                          min="0"
                          max={duration || 0}
                          step="0.1"
                          value={currentTime}
                          onChange={handleSeek}
                          className="w-full h-1 bg-slate-100 rounded-full appearance-none cursor-pointer accent-slate-900"
                        />
                      </div>
                      <div className="flex justify-between text-[8px] sm:text-[10px] text-slate-400 font-bold uppercase tracking-widest px-3">
                        <span>{formatTime(Math.floor(currentTime))}</span>
                        <span>{formatTime(Math.floor(duration))}</span>
                      </div>
                    </div>

                    {/* Volume Slider - Smaller and Below */}
                    <div className="w-full flex items-center justify-center gap-3 sm:gap-4 px-6 sm:px-12">
                      <Volume2 size={12} className="text-slate-400 sm:size-[14px]" />
                      <div className="flex-1 max-w-[150px] sm:max-w-[200px]">
                        <input 
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={volume}
                          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                          className="w-full h-1 bg-slate-100 rounded-full appearance-none cursor-pointer accent-slate-900"
                        />
                      </div>
                      <button 
                        onClick={onToggleLike}
                        className={cn(
                          "transition-all ml-2 sm:ml-4",
                          isLiked ? "text-red-500 scale-110" : "text-slate-300 hover:text-slate-500"
                        )}
                      >
                        <Heart size={18} className="sm:size-[20px]" fill={isLiked ? "currentColor" : "none"} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
