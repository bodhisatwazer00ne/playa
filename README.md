# Playa - Your Music, Anywhere! 🎧

Playa is a high-performance, cloud-native music and video player that turns your Google Drive into a powerful personal streaming service. Built with a focus on speed, style, and seamless integration, Playa ensures your media library is always just a click away.

---

## 🌟 Key Features

### ☁️ Cloud-Native Streaming
Directly connect to your **Google Drive** library. No uploading, no syncing—just instant access to your entire media collection. Playa intelligently scans your folders and organizes your music for you.

### 🔊 High-Fidelity Audio & Video
Supports a wide range of formats, including **MP3, AAC, FLAC, WAV, OGG, and MP4**. Whether you're an audiophile or just want to watch a quick clip, Playa handles it all with a high-performance streaming proxy.

### 📂 Smart Folder Scanning
Tired of manually adding files? Use the **Scan All Music** feature to deep-crawl your chosen folders and automatically build a temporary library of all playable media.

### 📚 Collections (Playlists)
Create persistent **Collections** to group your favorite tracks. All your playlists are saved securely in the cloud via Firebase, so they transition with you across devices.

### 🔒 The Vault
A dedicated space for your most-loved tracks. Simply "Like" a song to add it to your Vault for quick, one-tap listening.

### 🎨 Custom Art & Metadata
Personalize your library by uploading **custom cover art** for any track. Playa remembers your preferences and keeps your library looking sharp.

### ⚡ Polished Interface
Experience a minimalist, glassmorphic UI powered by **Tailwind CSS** and **Motion**. Smooth transitions, responsive design, and intuitive controls make navigation a breeze.

---

## 🛠️ Technology Stack

- **Frontend**: React 19, TypeScript
- **Styling**: Tailwind CSS 4.0
- **Animations**: Motion (f.k.a. Framer Motion)
- **Backend/API**: Express (Node.js) with Google Drive API integration
- **Database & Auth**: Firebase (Authentication & Firestore)
- **Icons**: Lucide React
- **Runtime**: Node.js (Vite for development)

---

## 🚀 Getting Started

### Prerequisites

- A **Google Account** with media files stored in Google Drive.
- A **Firebase Project** for authentication and data persistence.

### Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/playa.git
   cd playa
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root and add your Firebase and Google API credentials (see `.env.example`).

4. **Start the development server**:
   ```bash
   npm run dev
   ```

5. **Open the app**:
   Visit `http://localhost:3000` in your browser.

---

## ⚙️ Deployment (Render)

Playa is designed to be easily deployed on **Render**.

1. Connect your GitHub repository to Render.
2. Select **Web Service**.
3. Use the following build/start commands:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
4. Add your **Environment Variables** (VITE_FIREBASE_*) in the Render dashboard.
5. In your Google Cloud Console, add your Render URL to the **Authorized JavaScript origins** and **Authorized redirect URIs**.

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests to help make Playa the best cloud player for everyone.

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

---

*Enjoy your music, anywhere.*
