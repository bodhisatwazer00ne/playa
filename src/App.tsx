import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, User, GoogleAuthProvider } from 'firebase/auth';
import { LogOut, Music, FolderOpen, PlaySquare, Search, Menu, User as UserIcon, Plus, Trash2, Heart, Play, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, onSnapshot, orderBy, addDoc, updateDoc, doc, arrayUnion, deleteDoc, getDocs, setDoc } from 'firebase/firestore';
import { db, auth, googleProvider } from './lib/firebase';
import { listFiles } from './lib/drive';
import { DriveFile, PlayerState, Playlist, RepeatMode } from './types';
import { MusicPlayer } from './components/MusicPlayer';
import { FolderBrowser } from './components/FolderBrowser';
import { cn } from './lib/utils';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const handleExpiredToken = () => {
    setAccessToken(null);
    localStorage.removeItem('google_access_token');
  };

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [trackMetadata, setTrackMetadata] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState<{ id: string; name: string }[]>([{ id: 'root', name: 'My Drive' }]);
  const [playerState, setPlayerState] = useState<PlayerState>({
    currentFile: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    repeatMode: 'off',
    shuffle: false,
    likedSongIds: [],
    queue: [],
    queueIndex: 0
  });

  const [activeTab, setActiveTab] = useState<'home' | 'browse' | 'playlists' | 'search' | 'vault'>('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    tracks: DriveFile[];
    folders: DriveFile[];
    playlists: Playlist[];
  }>({ tracks: [], folders: [], playlists: [] });
  const [isSearching, setIsSearching] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isShowAllMode, setIsShowAllMode] = useState(false);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'likes'), where('userId', '==', user.uid));
    return onSnapshot(q, (snapshot) => {
      const ids = snapshot.docs.map(doc => doc.data().songId);
      setPlayerState(prev => ({ ...prev, likedSongIds: ids }));
    }, (error) => {
      console.error('Likes snapshot error:', error);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'trackMetadata'), where('userId', '==', user.uid));
    return onSnapshot(q, (snapshot) => {
      const metadata: Record<string, string> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        metadata[data.songId] = data.coverUrl;
      });
      setTrackMetadata(metadata);
    });
  }, [user]);

  const handleUpdateTrackCover = async (songId: string, url: string) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'trackMetadata', songId), {
        userId: user.uid,
        songId,
        coverUrl: url,
        updatedAt: Date.now()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `trackMetadata/${songId}`);
    }
  };

  const handleUpdatePlaylistCover = async (playlistId: string, url: string) => {
    try {
      await updateDoc(doc(db, 'playlists', playlistId), {
        coverUrl: url,
        updatedAt: Date.now()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `playlists/${playlistId}`);
    }
  };

  const handleToggleLike = async () => {
    if (!user || !playerState.currentFile) return;
    const songId = playerState.currentFile.id;
    const isLiked = playerState.likedSongIds.includes(songId);
    
    try {
      if (isLiked) {
        const q = query(collection(db, 'likes'), where('userId', '==', user.uid), where('songId', '==', songId));
        const snapshot = await getDocs(q);
        snapshot.forEach(d => deleteDoc(doc(db, 'likes', d.id)));
      } else {
        await addDoc(collection(db, 'likes'), {
          userId: user.uid,
          songId,
          createdAt: Date.now()
        });
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'likes');
    }
  };

  const handleSearch = async () => {
    if (!accessToken || !searchQuery.trim()) return;
    setIsSearching(true);
    setActiveTab('search');
    
    try {
      // 1. Search local playlists
      const filteredPlaylists = playlists.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase())
      );

      // 2. Search Google Drive for tracks and folders safely using client-side matching
      const q = `name contains '${searchQuery.replace(/'/g, "\\'")}' and trashed = false`;
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,thumbnailLink)&pageSize=200`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(`[status: ${res.status}] ${error.error?.message || 'Search failed'}`);
      }
      
      const data = await res.json();
      
      const driveFiles = data.files || [];
      const tracks = driveFiles.filter((f: any) => 
        f.mimeType.startsWith('audio/') || 
        f.mimeType.startsWith('video/') || 
        /\.(mp3|m4a|wav|flac|ogg|aac|mp4|webm|mov|mkv|avi)$/i.test(f.name)
      );
      const folders = driveFiles.filter((f: any) => f.mimeType === 'application/vnd.google-apps.folder');

      setSearchResults({
        tracks,
        folders,
        playlists: filteredPlaylists
      });
    } catch (e: any) {
      console.error('Search error:', e);
      if (e?.message?.includes('status: 401') || String(e).includes('401')) {
        handleExpiredToken();
        alert('Your Google permissions session has expired. Please authorize again.');
      }
    } finally {
      setIsSearching(false);
    }
  };
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        const storedToken = localStorage.getItem('google_access_token');
        if (storedToken) {
          setAccessToken(storedToken);
          fetchFolder(storedToken, 'root');
        }
      } else {
        setAccessToken(null);
        setFiles([]);
        setPlaylists([]);
        localStorage.removeItem('google_access_token');
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'playlists'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const p = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Playlist));
      setPlaylists(p);
    });
  }, [user]);

  const handleTabChange = (tab: 'home' | 'browse' | 'playlists' | 'search' | 'vault') => {
    setActiveTab(tab);
    setSelectedFolderIds([]);
  };

  const handleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setAccessToken(credential.accessToken);
        localStorage.setItem('google_access_token', credential.accessToken);
        handleTabChange('home');
        fetchFolder(credential.accessToken, 'root');
      }
    } catch (error: any) {
      if (error?.code === 'auth/cancelled-popup-request') {
        console.log('Previous sign in request was cancelled by a new request or the popup was closed.');
      } else {
        console.error('Sign in error:', error);
        alert(`Sign in failed: ${error?.message || 'Unknown error'}`);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleShowAllMusic = async (folderIds?: string[], shouldShuffle: boolean = false, shouldAutoPlay: boolean = false) => {
    if (!accessToken) return;
    setIsLoading(true);
    setIsShowAllMode(true);
    setActiveTab('browse');
    try {
      // Define a comprehensive list of standard audio/video MIME types since 'mimeType contains' is not supported by Drive API v3
      const mediaMimes = [
        "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/aac", "audio/flac", "audio/x-flac", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/webm", "audio/3gpp",
        "video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/x-msvideo", "video/mpeg", "application/ogg", "application/x-ogg"
      ];
      const mimeTypeConditions = mediaMimes.map(type => `mimeType = '${type}'`).join(' or ');
      
      let q = `(${mimeTypeConditions}) and trashed = false`;
      
      // If specific folders are provided, restrict the search to those folders
      if (folderIds && folderIds.length > 0) {
        // Enforce the grouping with internal and external parentheses
        const parentConditions = folderIds.map(id => `'${id}' in parents`).join(' or ');
        q = `(${parentConditions}) and (${mimeTypeConditions}) and trashed = false`;
      }

      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,thumbnailLink,webContentLink)&pageSize=1000`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(`[status: ${res.status}] ${error.error?.message || 'Scan failed'}`);
      }
      
      const data = await res.json();
      
      // Strict client-side filter for media MIME types and valid extensions and de-duplicate by ID
      const rawFiles = data.files || [];
      const mediaFiles: DriveFile[] = [];
      const seenIds = new Set();

      for (const f of rawFiles) {
        const isMedia = f.mimeType.startsWith('audio/') || 
                       f.mimeType.startsWith('video/') ||
                       f.mimeType === 'application/ogg' ||
                       /\.(mp3|m4a|wav|flac|ogg|aac|mp4|webm|mov|mkv|avi)$/i.test(f.name);
         
        if (isMedia && !seenIds.has(f.id)) {
          seenIds.add(f.id);
          mediaFiles.push(f);
        }
      }
      
      let finalFiles = [...mediaFiles];
      if (shouldShuffle) {
        finalFiles = finalFiles.sort(() => Math.random() - 0.5);
      }

      setFiles(finalFiles);
      setSelectedFolderIds([]);
      
      // Set up queue
      if (finalFiles.length > 0) {
        setPlayerState(prev => ({
          ...prev,
          queue: finalFiles,
          queueIndex: 0,
          currentFile: finalFiles[0],
          isPlaying: shouldAutoPlay
        }));
        
        // Only expand if we are actually playing a new shuffle mix
        if (shouldAutoPlay) {
          setIsPlayerExpanded(true);
        }
      }
    } catch (e: any) {
      console.error('Scan failed:', e);
      if (e?.message?.includes('status: 401') || String(e).includes('401')) {
        handleExpiredToken();
        alert('Your Google permissions session has expired. Please authorize again.');
      } else {
        alert('Failed to scan media. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToFolders = () => {
    setIsShowAllMode(false);
    if (accessToken) fetchFolder(accessToken, currentPath[currentPath.length - 1].id);
  };

  const handleSignOut = () => auth.signOut();

  const fetchFolder = async (token: string, folderId: string) => {
    setIsLoading(true);
    try {
      const data = await listFiles(token, folderId);
      setFiles(data);
    } catch (error: any) {
      console.error('Fetch error:', error);
      if (error?.message?.includes('status: 401') || String(error).includes('401')) {
        handleExpiredToken();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleFolderClick = (id: string, name: string) => {
    if (!accessToken) return;
    setSelectedFolderIds([]);
    setCurrentPath(prev => [...prev, { id, name }]);
    fetchFolder(accessToken, id);
  };

  const handleBack = () => {
    if (currentPath.length <= 1 || !accessToken) return;
    setSelectedFolderIds([]);
    const newPath = [...currentPath];
    newPath.pop();
    const lastFolder = newPath[newPath.length - 1];
    setCurrentPath(newPath);
    fetchFolder(accessToken, lastFolder.id);
  };

  const handlePlayFile = (file: DriveFile, customQueue?: DriveFile[]) => {
    const mediaFiles = customQueue || files.filter(f => f.mimeType.startsWith('audio/') || f.mimeType.startsWith('video/'));
    const index = mediaFiles.findIndex(f => f.id === file.id);
    
    setPlayerState(prev => ({
      ...prev,
      currentFile: file,
      isPlaying: true,
      queue: mediaFiles,
      queueIndex: index >= 0 ? index : 0
    }));
    setIsPlayerExpanded(true);
  };

  const handleNext = () => {
    const { queue, queueIndex, shuffle } = playerState;
    if (queue.length === 0) return;
    
    let nextIndex = queueIndex + 1;
    
    if (nextIndex >= queue.length) {
      // Reached the end of the collection
      if (shuffle) {
        // Reshuffle the entire collection for the next pass to keep it fresh
        const shuffledQueue = [...queue].sort(() => Math.random() - 0.5);
        setPlayerState(prev => ({
          ...prev,
          queue: shuffledQueue,
          queueIndex: 0,
          currentFile: shuffledQueue[0],
          isPlaying: true
        }));
        return;
      } else {
        // Serial playback: Loop back to the beginning
        nextIndex = 0;
      }
    }
    
    setPlayerState(prev => ({
      ...prev,
      currentFile: queue[nextIndex],
      queueIndex: nextIndex,
      isPlaying: true
    }));
  };

  const handlePrev = () => {
    const { queue, queueIndex } = playerState;
    if (queue.length === 0) return;
    const prevIndex = (queueIndex - 1 + queue.length) % queue.length;
    setPlayerState(prev => ({
      ...prev,
      currentFile: queue[prevIndex],
      queueIndex: prevIndex,
      isPlaying: true
    }));
  };

  const handleCreatePlaylist = async () => {
    if (!user || !newPlaylistName.trim()) return;
    try {
      await addDoc(collection(db, 'playlists'), {
        userId: user.uid,
        name: newPlaylistName.trim(),
        songIds: [],
        createdAt: Date.now()
      });
      setNewPlaylistName('');
      setShowNewPlaylist(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'playlists');
    }
  };

  const handleAddToPlaylist = async (songId: string, playlistId: string) => {
    try {
      const playlistRef = doc(db, 'playlists', playlistId);
      await updateDoc(playlistRef, {
        songIds: arrayUnion(songId)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `playlists/${playlistId}`);
    }
  };

  const handleDeletePlaylist = async (e: React.MouseEvent, playlistId: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this collection?')) return;
    try {
      await deleteDoc(doc(db, 'playlists', playlistId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `playlists/${playlistId}`);
    }
  };

  const handleToggleRepeat = () => {
    setPlayerState(prev => {
      const modes: RepeatMode[] = ['off', 'all', 'one'];
      const currentIndex = modes.indexOf(prev.repeatMode);
      const nextMode = modes[(currentIndex + 1) % modes.length];
      return { ...prev, repeatMode: nextMode };
    });
  };

  const handleToggleShuffle = () => {
    setPlayerState(prev => {
      const isShuffleTurningOn = !prev.shuffle;
      let newQueue = [...prev.queue];
      let newIndex = prev.queueIndex;

      if (isShuffleTurningOn && newQueue.length > 0) {
        // Shuffle the queue but keep the current song at the top so it doesn't interrupt
        const currentSong = newQueue[prev.queueIndex];
        const otherSongs = newQueue.filter((_, i) => i !== prev.queueIndex);
        const shuffledOthers = otherSongs.sort(() => Math.random() - 0.5);
        newQueue = [currentSong, ...shuffledOthers];
        newIndex = 0;
      }

      return { 
        ...prev, 
        shuffle: isShuffleTurningOn,
        queue: newQueue,
        queueIndex: newIndex
      };
    });
  };

  const handlePlayPlaylist = async (playlist: Playlist) => {
    if (!accessToken || playlist.songIds.length === 0) return;
    
    setIsLoading(true);
    try {
      const { getFileMetadata } = await import('./lib/drive');
      const playlistFiles = await Promise.all(
        playlist.songIds.map(id => getFileMetadata(accessToken, id))
      );
      
      const tracks = playlistFiles.filter(f => f.mimeType.startsWith('audio/') || f.mimeType.startsWith('video/'));
      if (tracks.length > 0) {
        setPlayerState(prev => ({
          ...prev,
          currentFile: tracks[0],
          queue: tracks,
          queueIndex: 0,
          isPlaying: true
        }));
        setIsPlayerExpanded(true);
      }
    } catch (error: any) {
      console.error('Play playlist error:', error);
      if (error?.message?.includes('status: 401') || String(error).includes('401')) {
        handleExpiredToken();
        alert('Your Google permissions session has expired. Please authorize again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-slate-50 relative overflow-hidden">
        {/* Dynamic Background Elements */}
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-20">
          <motion.div 
            animate={{ 
              scale: [1, 1.2, 1],
              rotate: [0, 90, 0],
            }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 bg-blue-100 rounded-full blur-[100px]"
          />
          <motion.div 
            animate={{ 
              scale: [1, 1.1, 1],
              rotate: [0, -90, 0],
            }}
            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-indigo-100 rounded-full blur-[100px]"
          />
        </div>

        <div className="max-w-md w-full text-center space-y-12 relative z-10">
          <div className="flex flex-col items-center">
            {/* Creative Logo */}
            <div className="relative w-32 h-32 mb-8">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 bg-gradient-to-tr from-slate-900 via-slate-800 to-indigo-900 rounded-[2.5rem] shadow-2xl opacity-20 blur-xl"
              />
              <motion.div 
                animate={{ rotate: -360 }}
                transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 border-2 border-slate-900/5 rounded-[2.5rem]"
              />
              <div className="absolute inset-2 bg-white/80 backdrop-blur-md rounded-[2rem] shadow-sm flex items-center justify-center border border-white">
                <motion.div 
                  whileHover={{ scale: 1.1, rotate: 5 }}
                  className="bg-slate-900 w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
                  <Music size={32} className="text-white relative z-10" />
                </motion.div>
              </div>
              
              {/* Orbiting Elements */}
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                className="absolute -inset-4 pointer-events-none"
              >
                <div className="w-2 h-2 bg-indigo-500 rounded-full absolute top-0 left-1/2 -ml-1 border-4 border-white shadow-sm" />
              </motion.div>
            </div>

            <h1 className="text-6xl font-display text-slate-900 uppercase tracking-tighter mb-4">Playa</h1>
            <p className="text-slate-400 font-medium tracking-wide">Your Music, Anywhere!</p>
          </div>

          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSignIn}
            disabled={isSigningIn}
            className={cn(
              "w-full py-5 bg-slate-900 text-white rounded-[2rem] text-[10px] font-bold uppercase tracking-[0.4em] shadow-2xl shadow-slate-900/40 flex items-center justify-center gap-4 group transition-opacity",
              isSigningIn && "opacity-50 cursor-not-allowed"
            )}
          >
            <span className="w-6 h-[1px] bg-white/30 group-hover:w-10 transition-all" />
            {isSigningIn ? 'Connecting...' : 'Connect with Google'}
            <span className="w-6 h-[1px] bg-white/30 group-hover:w-10 transition-all" />
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white text-slate-900 select-none">
      <header className="flex items-center justify-between px-6 py-4 bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
            <Music size={16} className="text-white" />
          </div>
          <h1 className="text-xl font-display tracking-tight text-slate-900 uppercase">Playa</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="w-8 h-8 rounded-full overflow-hidden border border-slate-100">
            {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : <UserIcon size={20} className="text-slate-400" />}
          </div>
          <button onClick={handleSignOut} className="text-slate-400 hover:text-red-500 transition-colors">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex flex-col pb-24 border-t border-slate-50">
        {!accessToken ? (
          <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center p-8 text-center space-y-8 animate-fade-in">
            <div className="relative w-24 h-24 bg-slate-50 border border-slate-100 rounded-[2rem] flex items-center justify-center shadow-sm">
              <FolderOpen size={36} className="text-slate-400" />
            </div>
            <div className="space-y-3 max-w-sm">
              <h3 className="text-xl font-bold text-slate-900 tracking-tight">Authorization Required</h3>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                Your Google Drive access token is inactive or has expired. Please authorize Playa to access your cloud audio and video files.
              </p>
            </div>
            <button 
              onClick={handleSignIn}
              disabled={isSigningIn}
              className="px-8 py-4 bg-slate-900 text-white rounded-[1.5rem] text-[10px] font-bold uppercase tracking-widest shadow-lg hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSigningIn ? 'Authorizing...' : 'Authorize Google Drive'}
            </button>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {activeTab === 'home' && (
              <motion.div 
                key="home"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex-1 overflow-y-auto"
              >
                <div className="max-w-xl mx-auto px-6 py-12 space-y-12">
                  <div className="space-y-4 text-center">
                    <h2 className="text-5xl font-display text-slate-900 uppercase tracking-tight">Overview</h2>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <button 
                      onClick={() => setActiveTab('browse')}
                      className="group flex items-center gap-6 p-8 bg-slate-50 border border-slate-100 rounded-3xl transition-all hover:bg-slate-100/50"
                    >
                      <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm text-slate-400 group-hover:text-slate-900 transition-colors">
                        <FolderOpen size={28} />
                      </div>
                      <div className="flex-1 text-left">
                        <h3 className="text-xl font-bold text-slate-900">Cloud Drive</h3>
                        <p className="text-xs text-slate-400 uppercase tracking-widest font-medium">Browse Files</p>
                      </div>
                    </button>

                    <div className="grid grid-cols-2 gap-4">
                      <button 
                        onClick={() => setActiveTab('vault')}
                        className="group p-6 bg-slate-50 border border-slate-100 rounded-3xl transition-all hover:bg-slate-100/50 text-left"
                      >
                        <Heart size={24} className="text-slate-200 group-hover:text-red-500 transition-colors mb-4" />
                        <h3 className="font-bold text-slate-900">Vault</h3>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest">Liked Songs</p>
                      </button>
                      <button 
                        onClick={() => setActiveTab('playlists')}
                        className="group p-6 bg-slate-50 border border-slate-100 rounded-3xl transition-all hover:bg-slate-100/50 text-left"
                      >
                        <PlaySquare size={24} className="text-slate-200 group-hover:text-accent transition-colors mb-4" />
                        <h3 className="font-bold text-slate-900">Library</h3>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest">Collections</p>
                      </button>
                    </div>

                    <div className="flex flex-col gap-3 mt-4">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleShowAllMusic(undefined, false, false); }}
                        className="group p-6 bg-slate-50 border border-slate-100 rounded-3xl transition-all hover:bg-slate-100/50 text-center"
                      >
                        <div className="flex items-center justify-center gap-4 text-slate-900">
                          <Music size={24} className="text-slate-400 group-hover:text-slate-900 transition-colors" />
                          <span className="text-sm font-bold uppercase tracking-[0.2em]">Scan All Music</span>
                        </div>
                      </button>

                      <button 
                        onClick={(e) => { e.stopPropagation(); handleShowAllMusic(undefined, true, true); }}
                        className="group p-6 bg-slate-900 rounded-3xl transition-all hover:bg-slate-800 text-center shadow-lg shadow-slate-200"
                      >
                        <div className="flex items-center justify-center gap-4 text-white">
                          <Play size={20} className="fill-current" />
                          <span className="text-sm font-bold uppercase tracking-[0.2em]">Shuffle Play All</span>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

          {activeTab === 'browse' && (
            <motion.div 
              key="browse"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="flex-1 overflow-hidden flex flex-col"
            >
              <div className="px-6 pt-6 flex flex-col gap-6 mb-2">
                <button 
                  onClick={() => setActiveTab('home')}
                  className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-900 transition-all self-start"
                >
                  <Menu size={18} className="translate-x-[1px]" />
                </button>
                
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-display text-slate-900 uppercase">
                      {isShowAllMode ? 'All Music' : currentPath[currentPath.length - 1].name}
                    </h2>
                  {!isShowAllMode && (
                    <div className="flex items-center gap-2 mt-1">
                      {currentPath.map((folder, index) => (
                        <React.Fragment key={folder.id}>
                          <button 
                            onClick={() => {
                              if (index === currentPath.length - 1) return;
                              const newPath = currentPath.slice(0, index + 1);
                              setCurrentPath(newPath);
                              if (accessToken) fetchFolder(accessToken, folder.id);
                            }}
                            className="text-[10px] font-medium uppercase tracking-widest text-slate-300 hover:text-slate-900 transition-colors"
                          >
                            {folder.name}
                          </button>
                          {index < currentPath.length - 1 && <span className="text-slate-200 text-[8px]">/</span>}
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                </div>
                </div>

                {isShowAllMode ? (
                  <div className="flex gap-2">
                    <button 
                      onClick={handleBackToFolders}
                      className="bg-slate-50 text-slate-400 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:text-slate-900 transition-all border border-slate-100"
                    >
                      Close
                    </button>
                    <button 
                      onClick={() => handleShowAllMusic(undefined, true, true)}
                      className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Play size={10} className="fill-current" />
                      <span>Shuffle Play All</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {selectedFolderIds.length > 0 && (
                      <button 
                        onClick={() => setSelectedFolderIds([])}
                        className="bg-slate-50 text-slate-400 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:text-slate-900 transition-all border border-slate-100 flex items-center gap-2"
                      >
                        Clear ({selectedFolderIds.length})
                      </button>
                    )}
                    <div className="flex bg-slate-900 rounded-xl shadow-sm text-white overflow-hidden">
                      <button 
                        onClick={() => handleShowAllMusic(selectedFolderIds.length > 0 ? selectedFolderIds : [currentPath[currentPath.length - 1].id], false, false)}
                        className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all border-r border-white/10"
                      >
                        {selectedFolderIds.length > 0 ? `Scan ${selectedFolderIds.length}` : 'Scan All'}
                      </button>
                      <button 
                        onClick={() => handleShowAllMusic(selectedFolderIds.length > 0 ? selectedFolderIds : [currentPath[currentPath.length - 1].id], true, true)}
                        className="px-3 py-2 hover:bg-slate-800 transition-all flex items-center justify-center bg-slate-700"
                        title="Shuffle Play"
                      >
                        <Play size={10} className="fill-current" />
                        <span className="ml-1 text-[8px] font-bold uppercase tracking-tighter">Shuffle Play</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <FolderBrowser 
                files={files}
                isLoading={isLoading}
                onFileClick={handlePlayFile}
                onFolderClick={handleFolderClick}
                onBack={handleBack}
                currentPath={currentPath}
                playlists={playlists}
                onAddToPlaylist={handleAddToPlaylist}
                selectedFolderIds={selectedFolderIds}
                onToggleFolderSelection={(id) => {
                  setSelectedFolderIds(prev => 
                    prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]
                  );
                }}
              />
            </motion.div>
          )}

          {activeTab === 'playlists' && (
            <motion.div 
              key="playlists"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 overflow-y-auto p-6"
            >
              <AnimatePresence mode="wait">
                {!selectedPlaylistId ? (
                  <motion.div 
                    key="list"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="max-w-2xl mx-auto"
                  >
                    <div className="flex items-center justify-between mb-8">
                      <button 
                        onClick={() => setActiveTab('home')}
                        className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-900 transition-all"
                      >
                        <Menu size={18} />
                      </button>
                      <h2 className="text-xl font-display text-slate-900 uppercase">Library</h2>
                      <button 
                        onClick={() => setShowNewPlaylist(true)}
                        className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center transition-all shadow-sm"
                      >
                        <Plus size={20} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {playlists.map(p => (
                        <div key={p.id} className="group relative">
                          <button 
                            onClick={() => setSelectedPlaylistId(p.id)}
                            className="w-full text-left p-4 bg-slate-50 border border-slate-100 rounded-[2rem] hover:bg-slate-100/50 transition-all"
                          >
                            <div className="aspect-[4/3] bg-white rounded-2xl mb-4 flex items-center justify-center shadow-sm overflow-hidden relative">
                              {p.coverUrl ? (
                                <img src={p.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <Music size={32} className="text-slate-100" />
                              )}
                              <div className="absolute inset-x-0 bottom-0 p-3 bg-white/80 backdrop-blur-sm">
                                <p className="text-[8px] text-slate-900 font-bold uppercase tracking-widest">{p.songIds.length} Tracks</p>
                              </div>
                            </div>
                            <h3 className="font-bold text-slate-900 truncate pl-1">{p.name}</h3>
                          </button>
                          <button 
                            onClick={(e) => handleDeletePlaylist(e, p.id)}
                            className="absolute top-8 right-8 p-1.5 bg-white/80 backdrop-blur-md text-slate-200 hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all border border-slate-100 shadow-sm"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      
                      {playlists.length === 0 && (
                        <div className="col-span-2 py-32 flex flex-col items-center text-slate-100">
                          <PlaySquare size={80} strokeWidth={1} className="mb-6 opacity-50" />
                          <p className="font-bold uppercase tracking-widest text-[10px] text-slate-300">No collections</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <PlaylistView 
                    playlist={playlists.find(p => p.id === selectedPlaylistId)!}
                    onBack={() => setSelectedPlaylistId(null)}
                    onPlay={handlePlayPlaylist}
                    accessToken={accessToken!}
                    onUpdateCover={handleUpdatePlaylistCover}
                    trackMetadata={trackMetadata}
                  />
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {activeTab === 'search' && (
            <motion.div 
              key="search"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 overflow-y-auto p-6"
            >
              <div className="max-w-2xl mx-auto space-y-10">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setActiveTab('home')}
                    className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-900 transition-all"
                  >
                    <Menu size={18} />
                  </button>
                  <h2 className="text-4xl font-display text-slate-900 uppercase">Search</h2>
                </div>

                <div className="relative group">
                  <input 
                    type="text"
                    placeholder="Search tracks, folders, or collections..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-5 pl-14 text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-all text-sm font-medium"
                  />
                  <Search size={22} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-slate-900 transition-colors" />
                  <button 
                    onClick={handleSearch}
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-slate-900 text-white px-6 py-2 rounded-xl font-bold uppercase tracking-widest text-[10px] hover:bg-slate-800 transition-all"
                  >
                    Search
                  </button>
                </div>

                <div className="space-y-12">
                  {isSearching ? (
                    <div className="py-20 text-center text-slate-300 text-[10px] font-bold uppercase tracking-widest animate-pulse">Searching the cloud...</div>
                  ) : (
                    <>
                      {/* Playlists Section */}
                      {searchResults.playlists.length > 0 && (
                        <div className="space-y-4">
                          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-300 ml-2">Collections</h3>
                          <div className="grid grid-cols-2 gap-4">
                            {searchResults.playlists.map(p => (
                              <button 
                                key={p.id}
                                onClick={() => {
                                  setSelectedPlaylistId(p.id);
                                  setActiveTab('playlists');
                                }}
                                className="flex items-center gap-4 p-4 bg-slate-50 border border-slate-100 rounded-3xl hover:bg-slate-100/50 transition-all text-left"
                              >
                                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                                  {p.coverUrl ? (
                                    <img src={p.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    <PlaySquare size={20} className="text-slate-200" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <h4 className="font-bold text-slate-900 text-sm truncate">{p.name}</h4>
                                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{p.songIds.length} tracks</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Folders Section */}
                      {searchResults.folders.length > 0 && (
                        <div className="space-y-4">
                          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-300 ml-2">Folders</h3>
                          <div className="grid grid-cols-1 gap-2">
                            {searchResults.folders.map(f => (
                              <button 
                                key={f.id}
                                onClick={() => {
                                  handleFolderClick(f.id, f.name);
                                  setActiveTab('browse');
                                }}
                                className="flex items-center gap-4 p-4 hover:bg-slate-50 rounded-3xl transition-all group text-left"
                              >
                                <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-slate-300 group-hover:text-slate-900 transition-all">
                                  <FolderOpen size={18} />
                                </div>
                                <div className="flex-1">
                                  <h4 className="text-sm font-bold text-slate-900">{f.name}</h4>
                                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Directory</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Tracks Section */}
                      {searchResults.tracks.length > 0 && (
                        <div className="space-y-4">
                          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-300 ml-2">Tracks</h3>
                          <div className="space-y-1">
                            {searchResults.tracks.map((file) => (
                              <button 
                                key={file.id}
                                onClick={() => handlePlayFile(file, searchResults.tracks)}
                                className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 rounded-3xl transition-all group text-left"
                              >
                                <div className="w-12 h-12 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-200 group-hover:text-slate-900 overflow-hidden shrink-0 shadow-sm transition-all">
                                  {(trackMetadata[file.id] || file.thumbnailLink) ? (
                                    <img src={trackMetadata[file.id] || file.thumbnailLink} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    <Music size={20} />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h4 className="text-sm font-bold text-slate-900 truncate">{file.name.replace(/\.[^/.]+$/, "")}</h4>
                                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-0.5">Cloud Media</p>
                                </div>
                                <Play size={14} className="text-slate-100 group-hover:text-slate-900 transition-colors" fill="currentColor" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {!isSearching && searchQuery && 
                       searchResults.tracks.length === 0 && 
                       searchResults.folders.length === 0 && 
                       searchResults.playlists.length === 0 && (
                        <div className="py-20 text-center text-slate-100 text-[10px] font-bold uppercase tracking-widest uppercase">No matches found in your cloud</div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'vault' && (
            <VaultView 
              accessToken={accessToken!}
              likedSongIds={playerState.likedSongIds}
              onPlayFile={handlePlayFile}
              onNavigateHome={() => handleTabChange('home')}
              trackMetadata={trackMetadata}
            />
          )}
        </AnimatePresence>
        )}
      </main>

      {/* New Playlist Modal */}
      <AnimatePresence>
        {showNewPlaylist && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-sm bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-2xl"
            >
              <h2 className="text-2xl font-display uppercase tracking-tight text-slate-900 mb-6">New Collection</h2>
              <input 
                autoFocus
                type="text"
                placeholder="Playlist name..."
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreatePlaylist()}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-all mb-6"
              />
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowNewPlaylist(false)}
                  className="flex-1 py-4 bg-slate-50 rounded-2xl text-slate-400 font-bold uppercase tracking-widest text-xs hover:text-slate-900 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleCreatePlaylist}
                  className="flex-1 py-4 bg-slate-900 rounded-2xl text-white font-bold uppercase tracking-widest text-xs hover:bg-slate-800 shadow-lg shadow-slate-900/10 transition-all font-bold"
                >
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav className={cn(
        "fixed bottom-24 left-1/2 -translate-x-1/2 flex items-center bg-white/90 backdrop-blur-xl border border-slate-100 rounded-[2.2rem] px-8 py-3.5 shadow-2xl gap-8 sm:gap-11 z-40 max-w-[90vw] transition-all duration-300",
        isPlayerExpanded ? "opacity-0 pointer-events-none translate-y-10" : "opacity-100"
      )}>
        <button 
          onClick={() => handleTabChange('home')}
          className={cn("transition-all duration-300", activeTab === 'home' ? "text-slate-900 scale-110" : "text-slate-400 hover:text-slate-600")}
        >
          <Menu size={22} />
        </button>
        <button 
          onClick={() => handleTabChange('browse')}
          className={cn("transition-all duration-300", activeTab === 'browse' ? "text-slate-900 scale-110" : "text-slate-400 hover:text-slate-600")}
        >
          <FolderOpen size={22} />
        </button>
        
        <button 
          onClick={() => handleTabChange('search')}
          className="w-11 h-11 bg-slate-900 rounded-2xl flex items-center justify-center shadow-lg active:scale-95 transition-all rotate-45 mx-2 group"
        >
          <Search size={20} className={cn("text-white -rotate-45 transition-transform", activeTab === 'search' && "scale-110")} />
        </button>

        <button 
          onClick={() => handleTabChange('playlists')}
          className={cn("transition-all duration-300", activeTab === 'playlists' ? "text-slate-900 scale-110" : "text-slate-400 hover:text-slate-600")}
        >
          <PlaySquare size={22} />
        </button>
        <button 
          onClick={() => handleTabChange('vault')}
          className={cn("transition-all duration-300", activeTab === 'vault' ? "text-slate-900 scale-110" : "text-slate-400 hover:text-slate-600")}
        >
          <Heart size={22} />
        </button>
      </nav>

      {playerState.currentFile && (
        <MusicPlayer 
          currentFile={playerState.currentFile}
          isPlaying={playerState.isPlaying}
          onTogglePlay={() => setPlayerState(prev => ({ ...prev, isPlaying: !prev.isPlaying }))}
          onNext={handleNext}
          onPrev={handlePrev}
          accessToken={accessToken}
          queue={playerState.queue}
          repeatMode={playerState.repeatMode}
          onToggleRepeat={handleToggleRepeat}
          shuffle={playerState.shuffle}
          onToggleShuffle={handleToggleShuffle}
          volume={playerState.volume}
          onVolumeChange={(val) => setPlayerState(prev => ({ ...prev, volume: val }))}
          isLiked={playerState.likedSongIds.includes(playerState.currentFile.id)}
          onToggleLike={handleToggleLike}
          playlists={playlists}
          onAddToPlaylist={handleAddToPlaylist}
          onCreatePlaylist={() => setShowNewPlaylist(true)}
          isExpanded={isPlayerExpanded}
          onToggleExpand={setIsPlayerExpanded}
          trackMetadata={trackMetadata}
          onUpdateTrackCover={handleUpdateTrackCover}
        />
      )}
    </div>
  );
}

function PlaylistView({ 
  playlist, 
  onBack, 
  onPlay, 
  accessToken,
  onUpdateCover,
  trackMetadata
}: { 
  playlist: Playlist, 
  onBack: () => void, 
  onPlay: (p: Playlist) => void, 
  accessToken: string,
  onUpdateCover: (id: string, url: string) => void,
  trackMetadata: Record<string, string>
}) {
  const [tracks, setTracks] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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
        onUpdateCover(playlist.id, base64);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const fetchTracks = async () => {
      try {
        const { getFileMetadata } = await import('./lib/drive');
        // Fetch each track individually so one failure doesn't break the whole list
        const results = await Promise.allSettled(playlist.songIds.map(id => getFileMetadata(accessToken, id)));
        const data = results
          .filter((res): res is PromiseFulfilledResult<DriveFile> => res.status === 'fulfilled')
          .map(res => res.value);
        setTracks(data);
      } catch (e) {
        console.error('Failed to fetch playlist tracks:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchTracks();
  }, [playlist, accessToken]);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="max-w-2xl mx-auto space-y-12"
    >
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-3 text-slate-300 hover:text-slate-900 transition-colors text-[10px] font-bold uppercase tracking-widest">
          <Menu size={16} className="rotate-90" /> Library
        </button>
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="p-3 bg-slate-50 hover:bg-slate-100 rounded-xl transition-all text-slate-400"
          title="Upload Cover"
        >
          <ImageIcon size={18} />
          <input 
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={handleFileChange}
          />
        </button>
      </div>

      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-10">
        <div className="w-48 h-48 bg-slate-50 border border-slate-100 rounded-[3rem] flex items-center justify-center shadow-sm overflow-hidden">
          {playlist.coverUrl ? (
            <img src={playlist.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <Music size={64} className="text-slate-100" />
          )}
        </div>
        <div className="space-y-4 text-center sm:text-left">
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-slate-300">Playlist</p>
          <h1 className="text-5xl font-display uppercase tracking-tight text-slate-900">{playlist.name}</h1>
          <div className="flex items-center justify-center sm:justify-start gap-4 pt-2">
            <button 
              onClick={() => onPlay(playlist)}
              className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-slate-800 transition-all shadow-xl"
            >
              Play All
            </button>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{tracks.length} tracks</p>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        {loading ? (
          <div className="py-20 text-center text-slate-100 text-[10px] font-bold uppercase tracking-widest">Loading Library...</div>
        ) : tracks.map((track, i) => {
          const customCover = trackMetadata[track.id] || track.thumbnailLink;
          return (
            <div 
              key={track.id} 
              className="flex items-center gap-4 p-4 hover:bg-slate-50 rounded-3xl transition-all group cursor-pointer"
              onClick={() => onPlay({ ...playlist, songIds: [track.id, ...playlist.songIds.filter(id => id !== track.id)] })}
            >
              <span className="w-5 text-[10px] font-bold text-slate-200">{String(i + 1).padStart(2, '0')}</span>
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                {customCover ? (
                  <img src={customCover} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <Music size={16} className="text-slate-100" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-slate-900 truncate tracking-tight">{track.name.replace(/\.[^/.]+$/, "")}</h4>
                <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">Cloud Media</p>
              </div>
              <Play size={14} className="text-slate-100 group-hover:text-slate-900 transition-colors" fill="currentColor" />
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function VaultView({ accessToken, likedSongIds, onPlayFile, onNavigateHome, trackMetadata }: { accessToken: string, likedSongIds: string[], onPlayFile: (f: DriveFile, q: DriveFile[]) => void, onNavigateHome: () => void, trackMetadata: Record<string, string> }) {
  const [tracks, setTracks] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    const fetchLikes = async () => {
      setLoading(true);
      try {
        const { getFileMetadata } = await import('./lib/drive');
        // Use allSettled to handle missing or inaccessible files gracefully
        const results = await Promise.allSettled(likedSongIds.map(id => getFileMetadata(accessToken, id)));
        const data = results
          .filter((res): res is PromiseFulfilledResult<DriveFile> => res.status === 'fulfilled')
          .map(res => res.value);
        setTracks(data);
      } catch (e) {
        console.error('Failed to fetch vault tracks:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchLikes();
  }, [likedSongIds, accessToken]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 overflow-y-auto p-6"
    >
      <div className="max-w-2xl mx-auto space-y-12">
        <div className="flex flex-col sm:flex-row items-center sm:items-end gap-10">
          <div className="w-40 h-40 bg-red-50 border border-red-100 rounded-[3rem] flex items-center justify-center shadow-sm relative">
            <button 
              onClick={onNavigateHome}
              className="absolute -top-4 -left-4 w-10 h-10 bg-white border border-slate-100 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-900 transition-all shadow-md"
            >
              <Menu size={18} />
            </button>
            <Heart size={48} className="text-red-400" fill="currentColor" />
          </div>
          <div className="space-y-4 text-center sm:text-left">
            <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-red-300">Vault</p>
            <h1 className="text-6xl font-display uppercase tracking-tight text-slate-900">Loved</h1>
            <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">{tracks.length} safe tracks</p>
          </div>
        </div>

        <div className="space-y-1">
          {loading ? (
            <div className="py-20 text-center text-slate-100 text-[10px] font-bold uppercase tracking-widest">Opening vault...</div>
          ) : tracks.length > 0 ? (
            tracks.map((track) => {
              const customCover = trackMetadata[track.id] || track.thumbnailLink;
              return (
                <button 
                  key={track.id}
                  onClick={() => onPlayFile(track, tracks)}
                  className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 rounded-3xl transition-all group text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-200 group-hover:text-red-500 overflow-hidden shrink-0 shadow-sm">
                    {customCover ? (
                      <img src={customCover} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <Heart size={20} fill="currentColor" fillOpacity={0.1} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-bold text-slate-900 truncate tracking-tight">{track.name.replace(/\.[^/.]+$/, "")}</h4>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">Original Audio</p>
                  </div>
                  <Play size={14} className="text-slate-100 group-hover:text-slate-900 transition-colors" fill="currentColor" />
                </button>
              );
            })
          ) : (
            <div className="py-32 flex flex-col items-center text-slate-100">
              <Heart size={64} strokeWidth={1} className="mb-4 opacity-50" />
              <p className="font-bold uppercase tracking-widest text-[10px] text-slate-300">Vault is empty</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
