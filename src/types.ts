export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  webkitRelativePath?: string;
}

export interface Playlist {
  id: string;
  userId: string;
  name: string;
  description?: string;
  coverUrl?: string;
  songIds: string[];
  createdAt: number;
}

export interface TrackMetadata {
  userId: string;
  songId: string;
  coverUrl: string;
  updatedAt: number;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  currentFile: DriveFile | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  likedSongIds: string[];
  queue: DriveFile[];
  queueIndex: number;
}
