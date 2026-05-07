import React, { useState } from 'react';
import { Folder, FileAudio, FileVideo, ChevronRight, Play, MoreVertical, Plus, Music } from 'lucide-react';
import { DriveFile, Playlist } from '../types';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface FolderBrowserProps {
  files: DriveFile[];
  onFileClick: (file: DriveFile) => void;
  onFolderClick: (folderId: string, folderName: string) => void;
  onBack: () => void;
  currentPath: { id: string; name: string }[];
  isLoading: boolean;
  playlists: Playlist[];
  onAddToPlaylist: (songId: string, playlistId: string) => void;
  selectedFolderIds?: string[];
  onToggleFolderSelection?: (folderId: string) => void;
}

export function FolderBrowser({ 
  files, 
  onFileClick, 
  onFolderClick, 
  onBack, 
  currentPath,
  isLoading,
  playlists,
  onAddToPlaylist,
  selectedFolderIds = [],
  onToggleFolderSelection
}: FolderBrowserProps) {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const toggleMenu = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setActiveMenuId(activeMenuId === id ? null : id);
  };

  const handleFolderAction = (e: React.MouseEvent, file: DriveFile) => {
    e.stopPropagation();
    if (onToggleFolderSelection) {
      onToggleFolderSelection(file.id);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-20 gap-4">
            <div className="w-8 h-8 border-2 border-slate-100 border-t-slate-900 rounded-full animate-spin" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Searching...</p>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-slate-100">
            <Folder size={64} strokeWidth={1} className="mb-4" />
            <p className="font-bold uppercase tracking-widest text-[10px] text-slate-200">No files found</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 pb-32">
            {files.map((file) => {
              const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
              const isAudio = file.mimeType.startsWith('audio/') || /\.(mp3|m4a|wav|flac|ogg|aac|m4p)$/i.test(file.name);
              const isVideo = file.mimeType.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi)$/i.test(file.name);
              const isSelected = selectedFolderIds.includes(file.id);
              
              if (!isFolder && !isAudio && !isVideo) return null;

              return (
                <div key={file.id} className="relative">
                  <div
                    onClick={() => isFolder ? onFolderClick(file.id, file.name) : onFileClick(file)}
                    className={cn(
                      "w-full flex items-center gap-4 p-4 hover:bg-slate-50/50 rounded-3xl transition-all text-left group active:scale-[0.98] cursor-pointer border border-transparent",
                      isSelected && "bg-slate-50 border-slate-100"
                    )}
                  >
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all duration-300 shadow-sm",
                      isFolder 
                        ? (isSelected ? "bg-indigo-600 text-white" : "bg-slate-900 text-white") 
                        : "bg-white text-slate-300 border border-slate-100 group-hover:text-slate-900"
                    )}>
                      {isFolder ? (
                        <Folder size={22} fill="currentColor" fillOpacity={1} />
                      ) : isVideo ? (
                        <FileVideo size={22} />
                      ) : (
                        <FileAudio size={22} />
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-slate-900 truncate text-sm leading-tight">{file.name.replace(/\.[^/.]+$/, "")}</h3>
                      <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-0.5">
                        {isFolder ? 'Folder' : isVideo ? 'Video' : 'Audio'}
                      </p>
                    </div>

                    {isFolder ? (
                      <button 
                        onClick={(e) => handleFolderAction(e, file)}
                        className={cn(
                          "w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all",
                          isSelected 
                            ? "bg-indigo-600 border-indigo-600 text-white" 
                            : "border-slate-100 text-transparent hover:border-slate-300"
                        )}
                      >
                        <div className="w-2 h-2 bg-white rounded-full" />
                      </button>
                    ) : (
                      <button 
                        onClick={(e) => toggleMenu(e, file.id)}
                        className="p-2 text-slate-200 hover:text-slate-900 transition-colors"
                      >
                        <Plus size={20} />
                      </button>
                    )}
                  </div>

                  <AnimatePresence>
                    {activeMenuId === file.id && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-100 rounded-[2rem] p-3 shadow-3xl z-20"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 p-2 mb-2 border-b border-slate-50 text-center">Add to Library</p>
                        <div className="max-h-48 overflow-y-auto space-y-1 no-scrollbar">
                          {playlists.map(p => (
                            <button 
                              key={p.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                onAddToPlaylist(file.id, p.id);
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-4 py-3 hover:bg-slate-50 rounded-xl transition-all text-xs font-bold text-slate-600 flex items-center justify-between group"
                            >
                              <span className="truncate">{p.name}</span>
                              <Plus size={14} className="opacity-0 group-hover:opacity-100" />
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
