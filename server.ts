import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import rateLimit from 'express-rate-limit';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  keepAliveMsecs: 30000,
});

// General rate limiter for all API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// Stricter limiter for sensitive routes (auth, streaming)
// User requested: max 5 attempts on auth routes per 15 minutes
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Security limit reached. Please wait 15 minutes before retrying.' }
});

function pipeDriveStream(
  urlStr: string,
  requestHeaders: Record<string, string>,
  clientRes: any,
  redirectCount = 0
): void {
  if (redirectCount > 5) {
    if (!clientRes.headersSent) {
      clientRes.status(502).send('Too many redirects');
    }
    return;
  }

  const parsedUrl = new URL(urlStr);
  const options = {
    method: 'GET',
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    headers: {
      ...requestHeaders,
      'Host': parsedUrl.hostname,
    },
    agent: keepAliveAgent
  };

  const req = https.request(options, (resFromDrive) => {
    const statusCode = resFromDrive.statusCode || 200;

    // Follow redirect
    if (statusCode >= 300 && statusCode < 400 && resFromDrive.headers.location) {
      const nextHeaders = { ...requestHeaders };
      const nextUrl = new URL(resFromDrive.headers.location);
      
      // If jumping to a different host (like *.googleusercontent.com),
      // we must drop the Authorization header to avoid signature/security errors.
      if (nextUrl.hostname !== parsedUrl.hostname) {
        delete nextHeaders['authorization'];
        delete nextHeaders['Authorization'];
      }
      
      return pipeDriveStream(resFromDrive.headers.location, nextHeaders, clientRes, redirectCount + 1);
    }

    if (statusCode >= 400) {
      let errData = '';
      resFromDrive.on('data', (chunk) => { errData += chunk; });
      resFromDrive.on('end', () => {
        console.error(`[Stream] Drive API responded with error ${statusCode}: ${errData}`);
        if (!clientRes.headersSent) {
          clientRes.status(statusCode).send(errData);
        }
      });
      return;
    }

    // Capture response filename or content type
    let contentType = resFromDrive.headers['content-type'] || 'audio/mpeg';
    const contentDisposition = resFromDrive.headers['content-disposition'] || '';
    const fileNameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
    const fileName = fileNameMatch ? fileNameMatch[1] : '';

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

    // Set client headers
    const headersToForward = [
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified'
    ];

    headersToForward.forEach(h => {
      const val = resFromDrive.headers[h];
      if (val !== undefined) {
        clientRes.setHeader(h, val);
      }
    });

    clientRes.setHeader('Cache-Control', 'private, max-age=3600');
    clientRes.setHeader('Content-Type', contentType);
    clientRes.setHeader('Accept-Ranges', 'bytes');
    clientRes.setHeader('Access-Control-Allow-Origin', '*');
    clientRes.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    clientRes.setHeader('Access-Control-Allow-Headers', '*');

    clientRes.writeHead(statusCode);
    resFromDrive.pipe(clientRes);
  });

  req.on('error', (err) => {
    console.error('[Stream] Request connection failed:', err);
    if (!clientRes.headersSent) {
      clientRes.status(500).send('Proxy Connection Failed');
    }
  });

  req.end();
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Security: Sanitize inputs and reject oversized payloads
  app.use(express.json({ limit: '10kb' })); // Reject JSON > 10kb
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));

  // Apply general limiter to non-streaming API routes to prevent rate-limiting browsers' standard Range/chunk requests
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/stream')) {
      return next(); // Exempt streaming from rate limit
    }
    apiLimiter(req, res, next);
  });

  // API Proxy for Google Drive Streaming
  app.get('/api/stream/:fileId', (req, res) => {
    const { fileId } = req.params;
    const { token } = req.query;
    const authHeader = req.headers.authorization || (token ? `Bearer ${token}` : null);
    const rangeHeader = req.headers.range;

    if (!authHeader) {
      return res.status(401).send('No Authorization header');
    }

    const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&acknowledgeAbuse=true`;
    
    const headers: Record<string, string> = {
      'Authorization': authHeader as string,
    };
    
    if (rangeHeader) {
      headers['Range'] = rangeHeader;
    }

    pipeDriveStream(driveUrl, headers, res);
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
