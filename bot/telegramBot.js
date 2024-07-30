const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Video = require('../models/Video');
const { generateThumbnail, getVideoDuration } = require('../utils/thumbnailGenerator');

class ChuckflixTelegramBot {
  constructor(token) {
    this.bot = new TelegramBot(token, { polling: true });
    this.client = null;
    this.setupHandlers();
    this.ensureDirectories();
    this.activeDownloads = new Map();
    this.initializeWebTorrent();
  }

  async initializeWebTorrent() {
    try {
      const WebTorrent = await import('webtorrent');
      this.client = new WebTorrent.default();
      console.log('✅ WebTorrent initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize WebTorrent:', error);
      this.client = null;
    }
  }

  ensureDirectories() {
    const dirs = ['public/uploads/videos', 'public/uploads/thumbnails'];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  setupHandlers() {
    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      this.bot.sendMessage(chatId, 
        '🎬 Welcome to Chuckflix Auto-Downloader!\n\n' +
        'Send me:\n' +
        '• Video files (up to 2GB)\n' +
        '• Torrent magnet links\n' +
        '• .torrent files\n' +
        '• Direct video URLs (.mp4, .avi, .mkv, etc.)\n' +
        '• Forward videos from other chats\n\n' +
        'I\'ll automatically download and add them to your Chuckflix library!'
      );
    });

    this.bot.on('video', async (msg) => {
      await this.handleTelegramVideo(msg);
    });

    this.bot.on('document', async (msg) => {
      const document = msg.document;
      
      if (document.mime_type && document.mime_type.startsWith('video/')) {
        await this.handleTelegramVideo(msg);
      }
      else if (document.file_name && document.file_name.endsWith('.torrent')) {
        await this.handleTorrentFile(msg);
      }
    });

    this.bot.on('message', async (msg) => {
      if (msg.text && !msg.text.startsWith('/')) {
        await this.handleTextMessage(msg);
      }
    });

    this.bot.on('callback_query', async (query) => {
      await this.handleCallbackQuery(query);
    });
  }

  async handleTelegramVideo(msg) {
    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    
    try {
      const statusMsg = await this.bot.sendMessage(chatId, 
        '🔄 Download started...', {
          reply_to_message_id: messageId,
          reply_markup: {
            inline_keyboard: [[
              { text: '📊 Status', callback_data: `status_${messageId}` },
              { text: '❌ Cancel', callback_data: `cancel_${messageId}` }
            ]]
          }
        }
      );

      const video = msg.video || msg.document;
      const fileId = video.file_id;
      const originalName = video.file_name || `video_${Date.now()}.mp4`;
      
      if (video.file_size > 20 * 1024 * 1024) {
        await this.bot.editMessageText(
          '❌ File too large! Telegram bot API limit is 20MB. Try using a direct URL instead.',
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
        return;
      }

      const fileLink = await this.bot.getFileLink(fileId);
      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}.mp4`;
      const filePath = path.join('public/uploads/videos', uniqueName);
      
      await this.downloadFileWithProgress(fileLink, filePath, chatId, statusMsg.message_id, messageId);
      
      await this.bot.editMessageText(
        '🎬 Processing video...', 
        { chat_id: chatId, message_id: statusMsg.message_id }
      );

      const thumbnailName = uniqueName.replace('.mp4', '.jpg');
      const thumbnailPath = `public/uploads/thumbnails/${thumbnailName}`;
      
      let duration = 0;
      let thumbnailRelativePath = '';
      
      try {
        await generateThumbnail(filePath, thumbnailPath);
        duration = await getVideoDuration(filePath);
        thumbnailRelativePath = `uploads/thumbnails/${thumbnailName}`;
      } catch (error) {
        console.warn('Thumbnail generation failed:', error);
      }

      const videoDoc = new Video({
        title: originalName.replace(/\.[^/.]+$/, ''),
        description: `Downloaded from Telegram - ${msg.from.first_name || 'Unknown User'}`,
        filename: uniqueName,
        originalName: originalName,
        thumbnailPath: thumbnailRelativePath,
        duration: duration,
        fileSize: video.file_size,
        tags: ['telegram', 'auto-download']
      });

      await videoDoc.save();

      await this.bot.editMessageText(
        '✅ Video downloaded successfully!\n\n' +
        `📁 Title: ${videoDoc.title}\n` +
        `⏱️ Duration: ${this.formatDuration(duration)}\n` +
        `💾 Size: ${this.formatFileSize(video.file_size)}\n\n` +
        '🎬 Video added to Chuckflix library!',
        { 
          chat_id: chatId, 
          message_id: statusMsg.message_id
        }
      );

    } catch (error) {
      console.error('Error handling Telegram video:', error);
      await this.bot.sendMessage(chatId, 
        '❌ Error downloading video: ' + error.message,
        { reply_to_message_id: messageId }
      );
    }
  }

  async handleTorrentFile(msg) {
    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    
    try {
      if (!this.client) {
        await this.bot.sendMessage(chatId,
          '❌ Torrent functionality not available. WebTorrent failed to initialize.',
          { reply_to_message_id: messageId }
        );
        return;
      }

      const statusMsg = await this.bot.sendMessage(chatId,
        '📁 Processing .torrent file...', {
          reply_to_message_id: messageId,
          reply_markup: {
            inline_keyboard: [[
              { text: '📊 Status', callback_data: `torrent_status_${messageId}` },
              { text: '❌ Cancel', callback_data: `torrent_cancel_${messageId}` }
            ]]
          }
        }
      );

      const document = msg.document;
      const fileId = document.file_id;
      
      const fileStream = await this.bot.getFileStream(fileId);
      
      const chunks = [];
      for await (const chunk of fileStream) {
        chunks.push(chunk);
      }
      const torrentBuffer = Buffer.concat(chunks);
      
      torrentBuffer.name = document.file_name || 'upload.torrent';
      
      this.client.add(torrentBuffer, { 
        path: 'public/uploads/videos',
        select: (file) => {
          return file.name.match(/\.(mp4|avi|mkv|mov|wmv|flv|webm)$/i);
        }
      }, async (torrent) => {
        console.log('Torrent from file started:', torrent.name);
        
        const videoFiles = torrent.files.filter(file => 
          file.name.match(/\.(mp4|avi|mkv|mov|wmv|flv|webm)$/i)
        );

        if (videoFiles.length === 0) {
          await this.bot.editMessageText(
            '❌ No video files found in torrent',
            { chat_id: chatId, message_id: statusMsg.message_id }
          );
          return;
        }

        this.activeDownloads.set(`torrent_${messageId}`, torrent);
        
        const progressInterval = setInterval(async () => {
          const progress = Math.round(torrent.progress * 100);
          const downloadSpeed = this.formatSpeed(torrent.downloadSpeed);
          
          try {
            await this.bot.editMessageText(
              `🧲 Downloading video files...\n\n` +
              `📁 ${torrent.name}\n` +
              `🎬 Video files: ${videoFiles.length}\n` +
              `📊 Progress: ${progress}%\n` +
              `⚡ Speed: ${downloadSpeed}\n` +
              `👥 Peers: ${torrent.numPeers}`,
              { chat_id: chatId, message_id: statusMsg.message_id }
            );
          } catch (error) {
            // Ignore edit message errors (rate limiting)
          }
        }, 5000);

        torrent.on('done', async () => {
          clearInterval(progressInterval);
          this.activeDownloads.delete(`torrent_${messageId}`);
          
          for (const file of videoFiles) {
            await this.processTorrentVideoFile(file, chatId, statusMsg.message_id);
          }
          
          // Optional: Destroy torrent after processing to free memory
          setTimeout(() => {
            torrent.destroy();
            console.log('🧹 Torrent destroyed and memory freed');
          }, 5000);
        });

        torrent.on('error', async (error) => {
          clearInterval(progressInterval);
          this.activeDownloads.delete(`torrent_${messageId}`);
          await this.bot.editMessageText(
            '❌ Torrent download failed: ' + error.message,
            { chat_id: chatId, message_id: statusMsg.message_id }
          );
        });
      });

    } catch (error) {
      console.error('Error handling .torrent file:', error);
      await this.bot.sendMessage(chatId,
        '❌ Error processing .torrent file: ' + error.message,
        { reply_to_message_id: messageId }
      );
    }
  }

  async handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const messageId = msg.message_id;

    if (text.startsWith('magnet:')) {
      await this.handleMagnetLink(chatId, text, messageId);
    }
    else if (this.isDirectVideoURL(text)) {
      await this.handleDirectVideoURL(chatId, text, messageId);
    }
    else if (this.isSupportedURL(text)) {
      await this.bot.sendMessage(chatId, 
        '⚠️ This appears to be a streaming platform URL.\n' +
        'Please provide a direct video file URL (.mp4, .avi, .mkv, etc.) instead.',
        { reply_to_message_id: messageId }
      );
    }
  }

  async handleDirectVideoURL(chatId, url, messageId) {
    try {
      const statusMsg = await this.bot.sendMessage(chatId,
        '🔗 Downloading from URL...', {
          reply_to_message_id: messageId,
          reply_markup: {
            inline_keyboard: [[
              { text: '📊 Status', callback_data: `url_status_${messageId}` },
              { text: '❌ Cancel', callback_data: `url_cancel_${messageId}` }
            ]]
          }
        }
      );

      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}.mp4`;
      const filePath = path.join('public/uploads/videos', uniqueName);

      await this.downloadFileWithProgress(url, filePath, chatId, statusMsg.message_id, messageId);
      await this.processDownloadedVideo(filePath, uniqueName, url, chatId, statusMsg.message_id);

    } catch (error) {
      console.error('Error downloading from URL:', error);
      await this.bot.sendMessage(chatId,
        '❌ Error downloading from URL: ' + error.message,
        { reply_to_message_id: messageId }
      );
    }
  }

  async handleMagnetLink(chatId, magnetLink, messageId) {
    try {
      if (!this.client) {
        await this.bot.sendMessage(chatId,
          '❌ Torrent functionality not available. WebTorrent failed to initialize.',
          { reply_to_message_id: messageId }
        );
        return;
      }

      const statusMsg = await this.bot.sendMessage(chatId,
        '🧲 Starting torrent download...', {
          reply_to_message_id: messageId,
          reply_markup: {
            inline_keyboard: [[
              { text: '📊 Status', callback_data: `torrent_status_${messageId}` },
              { text: '❌ Cancel', callback_data: `torrent_cancel_${messageId}` }
            ]]
          }
        }
      );

      this.client.add(magnetLink, { 
        path: 'public/uploads/videos',
        select: (file) => {
          return file.name.match(/\.(mp4|avi|mkv|mov|wmv|flv|webm)$/i);
        }
      }, async (torrent) => {
        console.log('Torrent started:', torrent.name);
        
        const videoFiles = torrent.files.filter(file => 
          file.name.match(/\.(mp4|avi|mkv|mov|wmv|flv|webm)$/i)
        );

        if (videoFiles.length === 0) {
          await this.bot.editMessageText(
            '❌ No video files found in torrent',
            { chat_id: chatId, message_id: statusMsg.message_id }
          );
          return;
        }

        this.activeDownloads.set(`torrent_${messageId}`, torrent);
        
        const progressInterval = setInterval(async () => {
          const progress = Math.round(torrent.progress * 100);
          const downloadSpeed = this.formatSpeed(torrent.downloadSpeed);
          
          try {
            await this.bot.editMessageText(
              `🧲 Downloading video files...\n\n` +
              `📁 ${torrent.name}\n` +
              `🎬 Video files: ${videoFiles.length}\n` +
              `📊 Progress: ${progress}%\n` +
              `⚡ Speed: ${downloadSpeed}\n` +
              `👥 Peers: ${torrent.numPeers}`,
              { chat_id: chatId, message_id: statusMsg.message_id }
            );
          } catch (error) {
            // Ignore edit message errors (rate limiting)
          }
        }, 5000);

        torrent.on('done', async () => {
          clearInterval(progressInterval);
          this.activeDownloads.delete(`torrent_${messageId}`);
          
          for (const file of videoFiles) {
            await this.processTorrentVideoFile(file, chatId, statusMsg.message_id);
          }
          
          // Optional: Destroy torrent after processing to free memory
          setTimeout(() => {
            torrent.destroy();
            console.log('🧹 Torrent destroyed and memory freed');
          }, 5000);
        });

        torrent.on('error', async (error) => {
          clearInterval(progressInterval);
          this.activeDownloads.delete(`torrent_${messageId}`);
          await this.bot.editMessageText(
            '❌ Torrent download failed: ' + error.message,
            { chat_id: chatId, message_id: statusMsg.message_id }
          );
        });
      });

    } catch (error) {
      console.error('Error handling magnet link:', error);
      await this.bot.sendMessage(chatId,
        '❌ Error processing magnet link: ' + error.message,
        { reply_to_message_id: messageId }
      );
    }
  }

  async downloadFileWithProgress(url, destination, chatId, statusMsgId, downloadId) {
    return new Promise(async (resolve, reject) => {
      try {
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'stream',
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        const totalLength = parseInt(response.headers['content-length'], 10);
        let downloadedLength = 0;
        let lastProgressUpdate = 0;

        const writer = fs.createWriteStream(destination);
        
        this.activeDownloads.set(`download_${downloadId}`, { response, writer });

        response.data.on('data', async (chunk) => {
          downloadedLength += chunk.length;
          
          if (totalLength) {
            const progress = Math.round((downloadedLength / totalLength) * 100);
            
            if (progress >= lastProgressUpdate + 10) {
              lastProgressUpdate = progress;
              try {
                await this.bot.editMessageText(
                  `📥 Downloading... ${progress}%\n` +
                  `💾 ${this.formatFileSize(downloadedLength)} / ${this.formatFileSize(totalLength)}`,
                  { chat_id: chatId, message_id: statusMsgId }
                );
              } catch (error) {
                // Ignore edit message errors (rate limiting)
              }
            }
          }
        });

        response.data.pipe(writer);

        writer.on('finish', () => {
          this.activeDownloads.delete(`download_${downloadId}`);
          resolve();
        });

        writer.on('error', (error) => {
          this.activeDownloads.delete(`download_${downloadId}`);
          reject(error);
        });

        response.data.on('error', (error) => {
          this.activeDownloads.delete(`download_${downloadId}`);
          reject(error);
        });

      } catch (error) {
        this.activeDownloads.delete(`download_${downloadId}`);
        reject(error);
      }
    });
  }

  async handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const data = query.data;
    const messageId = query.message.message_id;

    if (data.startsWith('cancel_') || data.startsWith('torrent_cancel_') || data.startsWith('url_cancel_')) {
      const downloadId = data.split('_')[1];
      
      const downloadKey = `download_${downloadId}`;
      const torrentKey = `torrent_${downloadId}`;
      
      if (this.activeDownloads.has(downloadKey)) {
        const download = this.activeDownloads.get(downloadKey);
        download.response.destroy();
        download.writer.destroy();
        this.activeDownloads.delete(downloadKey);
      }
      
      if (this.activeDownloads.has(torrentKey)) {
        const torrent = this.activeDownloads.get(torrentKey);
        torrent.destroy();
        this.activeDownloads.delete(torrentKey);
      }

      await this.bot.editMessageText(
        '❌ Download cancelled by user',
        { chat_id: chatId, message_id: messageId }
      );
    }

    await this.bot.answerCallbackQuery(query.id);
  }

  // ENHANCED: Stream-based video file processing with automatic cleanup
  async processTorrentVideoFile(file, chatId, statusMsgId) {
    try {
      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}.mp4`;
      const destinationPath = path.join('public/uploads/videos', uniqueName);
      
      const readStream = file.createReadStream();
      const writeStream = fs.createWriteStream(destinationPath);
      
      await new Promise((resolve, reject) => {
        readStream.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        readStream.on('error', reject);
      });
      
      console.log(`Video file copied to: ${destinationPath}`);
      
      // CLEANUP: Delete the torrent folder after successful copy
      await this.cleanupTorrentFolder(file);
      
      await this.processDownloadedVideo(destinationPath, uniqueName, file.name, chatId, statusMsgId);
      
    } catch (error) {
      console.error('Error processing torrent video file:', error);
      await this.bot.editMessageText(
        '❌ Error processing video file: ' + error.message,
        { chat_id: chatId, message_id: statusMsgId }
      );
    }
  }

  // NEW: Automatic torrent folder cleanup
  async cleanupTorrentFolder(file) {
    try {
      const torrentPath = file.path;
      const torrentDir = path.dirname(torrentPath);
      
      if (torrentDir.includes('public/uploads/videos')) {
        const folderName = path.basename(torrentDir);
        const fullFolderPath = path.join('public/uploads/videos', folderName);
        
        if (fs.existsSync(fullFolderPath)) {
          // Use modern Node.js approach for cleanup
          fs.rmSync(fullFolderPath, { recursive: true, force: true });
          console.log(`✅ Cleaned up torrent folder: ${folderName}`);
        }
      }
    } catch (error) {
      console.warn('⚠️ Failed to cleanup torrent folder:', error.message);
      // Don't throw error - cleanup failure shouldn't stop video processing
    }
  }

  async processDownloadedVideo(filePath, filename, originalName, chatId, statusMsgId) {
    try {
      const thumbnailName = filename.replace(/\.[^/.]+$/, '.jpg');
      const thumbnailPath = `public/uploads/thumbnails/${thumbnailName}`;
      
      let duration = 0;
      let thumbnailRelativePath = '';
      
      try {
        await generateThumbnail(filePath, thumbnailPath);
        duration = await getVideoDuration(filePath);
        thumbnailRelativePath = `uploads/thumbnails/${thumbnailName}`;
      } catch (error) {
        console.warn('Thumbnail generation failed:', error);
      }

      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      const videoDoc = new Video({
        title: path.basename(originalName, path.extname(originalName)),
        description: 'Downloaded via Telegram Bot',
        filename: filename,
        originalName: originalName,
        thumbnailPath: thumbnailRelativePath,
        duration: duration,
        fileSize: fileSize,
        tags: ['telegram', 'auto-download']
      });

      await videoDoc.save();

      await this.bot.editMessageText(
        '✅ Video processed successfully!\n\n' +
        `📁 Title: ${videoDoc.title}\n` +
        `⏱️ Duration: ${this.formatDuration(duration)}\n` +
        `💾 Size: ${this.formatFileSize(fileSize)}\n\n` +
        '🎬 Video added to Chuckflix library!',
        { 
          chat_id: chatId, 
          message_id: statusMsgId
        }
      );

    } catch (error) {
      console.error('Error processing downloaded video:', error);
      await this.bot.editMessageText(
        '❌ Error processing video: ' + error.message,
        { chat_id: chatId, message_id: statusMsgId }
      );
    }
  }

  isDirectVideoURL(url) {
    const directVideoPatterns = [
      /\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v|3gp)(\?.*)?$/i,
      /^https?:\/\/.*\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v|3gp)/i
    ];
    
    return directVideoPatterns.some(pattern => pattern.test(url));
  }

  isSupportedURL(url) {
    const streamingPatterns = [
      /youtube\.com\/watch/,
      /youtu\.be\//,
      /vimeo\.com/,
      /dailymotion\.com/,
      /twitch\.tv/,
      /tiktok\.com/
    ];
    
    return streamingPatterns.some(pattern => pattern.test(url));
  }

  formatDuration(seconds) {
    if (!seconds) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  formatSpeed(bytesPerSecond) {
    return this.formatFileSize(bytesPerSecond) + '/s';
  }
}

module.exports = ChuckflixTelegramBot;
