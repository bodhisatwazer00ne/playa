import { DriveFile } from '../types';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

export async function listFiles(accessToken: string, folderId: string = 'root'): Promise<DriveFile[]> {
  const q = `'${folderId}' in parents and trashed = false`;
  const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,thumbnailLink)&orderBy=folder,name&pageSize=1000`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`[status: ${response.status}] ${error.error?.message || 'Failed to list files'}`);
  }

  const data = await response.json();
  const rawFiles = data.files || [];
  
  // Clean client-side filter to only return folders and audio/video media files
  return rawFiles.filter((f: any) => 
    f.mimeType === 'application/vnd.google-apps.folder' ||
    f.mimeType.startsWith('audio/') ||
    f.mimeType.startsWith('video/') ||
    /\.(mp3|m4a|wav|flac|ogg|aac|mp4|webm|mov|mkv|avi)$/i.test(f.name)
  );
}

export async function getFileMetadata(accessToken: string, fileId: string): Promise<DriveFile> {
  const url = `${DRIVE_API_BASE}/files/${fileId}?fields=id,name,mimeType,size,thumbnailLink`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`[status: ${response.status}] ${error.error?.message || 'Failed to get file metadata'}`);
  }

  return response.json();
}

export function getStreamUrl(fileId: string, accessToken: string): string {
  return `/api/stream/${fileId}?token=${accessToken}`;
}
