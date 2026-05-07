import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API Proxy for Google Drive Streaming
  app.get('/api/stream/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const { token } = req.query;
    const authHeader = req.headers.authorization || (token ? `Bearer ${token}` : null);
    const rangeHeader = req.headers.range;

    if (!authHeader) {
      return res.status(401).send('No Authorization header');
    }

    try {
      const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&acknowledgeAbuse=true`;
      
      const headers: Record<string, string> = {
        'Authorization': authHeader as string,
      };
      
      if (rangeHeader) {
        headers['Range'] = rangeHeader;
      }

      console.log(`[Stream] Requesting file ${fileId}, Range: ${rangeHeader || 'none'}`);

      const response = await fetch(driveUrl, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Stream] Drive API Error (${response.status}):`, errorText);
        return res.status(response.status).send(errorText);
      }

      // Improved Content-Type detection
      const contentDisposition = response.headers.get('Content-Disposition');
      const fileNameMatch = contentDisposition?.match(/filename="?([^"]+)"?/);
      const fileName = fileNameMatch ? fileNameMatch[1] : '';
      
      let contentType = response.headers.get('Content-Type') || 'audio/mpeg';
      
      if (contentType === 'application/octet-stream' || contentType === 'text/plain') {
        const lowerName = fileName.toLowerCase();
        if (lowerName.endsWith('.mp3')) contentType = 'audio/mpeg';
        else if (lowerName.endsWith('.wav')) contentType = 'audio/wav';
        else if (lowerName.endsWith('.ogg')) contentType = 'audio/ogg';
        else if (lowerName.endsWith('.m4a')) contentType = 'audio/mp4';
        else if (lowerName.endsWith('.flac')) contentType = 'audio/flac';
        else if (lowerName.endsWith('.aac')) contentType = 'audio/aac';
        else if (lowerName.endsWith('.mp4')) contentType = 'video/mp4';
        else if (lowerName.endsWith('.webm')) contentType = 'video/webm';
        else if (lowerName.endsWith('.mov')) contentType = 'video/quicktime';
        else if (lowerName.endsWith('.mkv')) contentType = 'video/x-matroska';
        else if (lowerName.endsWith('.avi')) contentType = 'video/x-msvideo';
      }

      // Forward critical headers from Drive to Client for better media handling
      const headersToForward = [
        'content-length',
        'content-range',
        'accept-ranges',
        'etag',
        'last-modified'
      ];

      headersToForward.forEach(h => {
        const value = response.headers.get(h);
        if (value) res.setHeader(h, value);
      });

      // Override some headers to optimize browser buffering
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');

      res.status(response.status);

      if (response.body) {
        // @ts-ignore - Readable.fromWeb works with ReadableStream
        Readable.fromWeb(response.body).pipe(res);
      } else {
        res.end();
      }

    } catch (error) {
      console.error('Proxy Error:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
