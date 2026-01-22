/**
 * Image Library - Combined Server + Telegram Bot
 * For deployment on Railway/Render/Fly.io
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const http = require('http');

// ============ EXPRESS SERVER ============

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const BUCKET = process.env.SUPABASE_BUCKET || 'screenshots';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, './')));

// Multer configuration
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

function getExtension(mimetype) {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp'
  };
  return extensions[mimetype] || 'jpg';
}

// In-memory metadata store (for simplicity)
const imageMetadata = new Map();

// Upload single image
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const file = req.file;
    const ext = getExtension(file.mimetype);
    const fileName = `${uuidv4()}.${ext}`;
    const filePath = `images/${fileName}`;

    // Parse metadata
    let metadata = {};
    try {
      metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};
    } catch (e) {
      metadata = {};
    }

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) {
      return res.status(500).json({ error: 'Failed to upload', details: error.message });
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    // Store metadata
    imageMetadata.set(fileName, {
      marketplace: metadata.marketplace || '',
      page: metadata.page || '',
      date: metadata.date || new Date().toISOString().split('T')[0],
      description: metadata.description || ''
    });

    res.json({
      success: true,
      image: {
        id: fileName,
        path: filePath,
        url: urlData.publicUrl,
        originalName: file.originalname,
        size: file.size,
        metadata: imageMetadata.get(fileName)
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Upload multiple images
app.post('/api/upload-multiple', upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const uploadedImages = [];

    for (const file of req.files) {
      const ext = getExtension(file.mimetype);
      const fileName = `${uuidv4()}.${ext}`;
      const filePath = `images/${fileName}`;

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype
        });

      if (!error) {
        const { data: urlData } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(filePath);

        uploadedImages.push({
          id: fileName,
          url: urlData.publicUrl,
          originalName: file.originalname
        });
      }
    }

    res.json({
      success: true,
      message: `Uploaded ${uploadedImages.length} images`,
      images: uploadedImages
    });

  } catch (error) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Get all images
app.get('/api/images', async (req, res) => {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list('images', {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (error) {
      return res.status(500).json({ error: 'Failed to list images' });
    }

    const images = data
      .filter(file => file.name !== '.emptyFolderPlaceholder')
      .map(file => {
        const { data: urlData } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(`images/${file.name}`);

        return {
          id: file.name,
          url: urlData.publicUrl,
          size: file.metadata?.size,
          createdAt: file.created_at,
          metadata: imageMetadata.get(file.name) || {
            marketplace: 'Не указан',
            page: 'Не указана',
            date: file.created_at ? file.created_at.split('T')[0] : '',
            description: ''
          }
        };
      });

    res.json({ success: true, count: images.length, images });

  } catch (error) {
    res.status(500).json({ error: 'Failed to list images' });
  }
});

// Delete image
app.delete('/api/images/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase.storage
      .from(BUCKET)
      .remove([`images/${id}`]);

    if (error) {
      return res.status(500).json({ error: 'Failed to delete' });
    }

    res.json({ success: true, message: 'Deleted' });

  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    bot: process.env.TELEGRAM_BOT_TOKEN ? 'enabled' : 'disabled'
  });
});

// Serve library page (now index.html)
app.get('/library', (req, res) => {
  res.sendFile(path.join(__dirname, './index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Library: http://localhost:${PORT}/library`);
});

// ============ TELEGRAM BOT ============

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (BOT_TOKEN && BOT_TOKEN.length > 10) {
  try {
    const bot = new TelegramBot(BOT_TOKEN, { polling: { interval: 1000, autoStart: true } });
    console.log('Telegram bot started');

    // User states for step-by-step upload
    const userStates = new Map();

    async function downloadFile(fileUrl) {
      return new Promise((resolve, reject) => {
        const protocol = fileUrl.startsWith('https') ? https : http;
        protocol.get(fileUrl, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
          response.on('error', reject);
        }).on('error', reject);
      });
    }

    // Start command
    bot.onText(/\/start/, (msg) => {
      userStates.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, `
📸 *Screenshot Library Bot*

Загружайте скриншоты в библиотеку!

*Как загрузить:*
1. Отправьте фото
2. Выберите маркетплейс
3. Укажите страницу
4. Готово!

*Или быстрая загрузка:*
Отправьте фото с подписью в формате:
\`Ozon | Карточка товара\`

*Команды:*
/list — последние скриншоты
/stats — статистика
/cancel — отменить загрузку
      `, { parse_mode: 'Markdown' });
    });

    // Cancel command
    bot.onText(/\/cancel/, (msg) => {
      userStates.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, '❌ Загрузка отменена');
    });

    // List command
    bot.onText(/\/list/, async (msg) => {
      try {
        const { data } = await supabase.storage
          .from(BUCKET)
          .list('images', { limit: 10, sortBy: { column: 'created_at', order: 'desc' } });

        const images = data?.filter(f => f.name !== '.emptyFolderPlaceholder') || [];

        if (images.length === 0) {
          bot.sendMessage(msg.chat.id, '📭 Библиотека пуста');
          return;
        }

        let message = `📸 *Последние ${images.length} скриншотов:*\n\n`;
        images.forEach((file, i) => {
          const { data: urlData } = supabase.storage
            .from(BUCKET)
            .getPublicUrl(`images/${file.name}`);
          const meta = imageMetadata.get(file.name);
          const info = meta ? `${meta.marketplace} • ${meta.page}` : 'Без метаданных';
          message += `${i + 1}. ${info}\n[Открыть](${urlData.publicUrl})\n\n`;
        });

        bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
      } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Ошибка');
      }
    });

    // Stats command
    bot.onText(/\/stats/, async (msg) => {
      try {
        const { data } = await supabase.storage.from(BUCKET).list('images', { limit: 1000 });
        const images = data?.filter(f => f.name !== '.emptyFolderPlaceholder') || [];
        bot.sendMessage(msg.chat.id, `📊 *Статистика*\n\nВсего скриншотов: *${images.length}*`, { parse_mode: 'Markdown' });
      } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Ошибка');
      }
    });

    // Handle photo upload
    bot.on('photo', async (msg) => {
      const chatId = msg.chat.id;
      const caption = msg.caption || '';

      try {
        // Check if caption has metadata (format: "Marketplace | Page")
        if (caption.includes('|')) {
          const parts = caption.split('|').map(s => s.trim());
          const marketplace = parts[0] || 'Другой';
          const page = parts[1] || 'Не указана';

          await uploadPhoto(msg, { marketplace, page, date: new Date().toISOString().split('T')[0] });
        } else {
          // Start step-by-step process
          const photo = msg.photo[msg.photo.length - 1];
          userStates.set(chatId, { 
            step: 'marketplace', 
            fileId: photo.file_id,
            description: caption 
          });

          const keyboard = {
            inline_keyboard: [
              [{ text: '🔵 Ozon', callback_data: 'mp_Ozon' }, { text: '🟣 Wildberries', callback_data: 'mp_Wildberries' }],
              [{ text: '🟡 Яндекс.Маркет', callback_data: 'mp_Яндекс.Маркет' }, { text: '🟠 AliExpress', callback_data: 'mp_AliExpress' }],
              [{ text: '🟢 СберМегаМаркет', callback_data: 'mp_СберМегаМаркет' }, { text: '⚪ Другой', callback_data: 'mp_Другой' }]
            ]
          };

          bot.sendMessage(chatId, '📦 *Выберите маркетплейс:*', { 
            parse_mode: 'Markdown',
            reply_markup: keyboard 
          });
        }
      } catch (e) {
        console.error('Photo handler error:', e);
        bot.sendMessage(chatId, '❌ Ошибка при обработке фото');
      }
    });

    // Handle document (file) upload
    bot.on('document', async (msg) => {
      const chatId = msg.chat.id;
      const doc = msg.document;
      const caption = msg.caption || '';

      // Check if it's an image
      if (!doc.mime_type || !doc.mime_type.startsWith('image/')) {
        bot.sendMessage(chatId, '⚠️ Пожалуйста, отправьте изображение (JPEG, PNG, GIF, WebP)');
        return;
      }

      try {
        if (caption.includes('|')) {
          const parts = caption.split('|').map(s => s.trim());
          const marketplace = parts[0] || 'Другой';
          const page = parts[1] || 'Не указана';

          await uploadDocument(msg, { marketplace, page, date: new Date().toISOString().split('T')[0] });
        } else {
          userStates.set(chatId, { 
            step: 'marketplace', 
            fileId: doc.file_id,
            isDocument: true,
            mimeType: doc.mime_type,
            description: caption
          });

          const keyboard = {
            inline_keyboard: [
              [{ text: '🔵 Ozon', callback_data: 'mp_Ozon' }, { text: '🟣 Wildberries', callback_data: 'mp_Wildberries' }],
              [{ text: '🟡 Яндекс.Маркет', callback_data: 'mp_Яндекс.Маркет' }, { text: '🟠 AliExpress', callback_data: 'mp_AliExpress' }],
              [{ text: '🟢 СберМегаМаркет', callback_data: 'mp_СберМегаМаркет' }, { text: '⚪ Другой', callback_data: 'mp_Другой' }]
            ]
          };

          bot.sendMessage(chatId, '📦 *Выберите маркетплейс:*', { 
            parse_mode: 'Markdown',
            reply_markup: keyboard 
          });
        }
      } catch (e) {
        console.error('Document handler error:', e);
        bot.sendMessage(chatId, '❌ Ошибка при обработке файла');
      }
    });

    // Handle callback queries (button clicks)
    bot.on('callback_query', async (query) => {
      const chatId = query.message.chat.id;
      const data = query.data;
      const state = userStates.get(chatId);

      if (!state) {
        bot.answerCallbackQuery(query.id, { text: 'Сессия истекла, отправьте фото заново' });
        return;
      }

      bot.answerCallbackQuery(query.id);

      if (data.startsWith('mp_')) {
        // Marketplace selected
        state.marketplace = data.replace('mp_', '');
        state.step = 'page';
        userStates.set(chatId, state);

        const keyboard = {
          inline_keyboard: [
            [{ text: '🏠 Главная', callback_data: 'pg_Главная' }, { text: '📋 Каталог', callback_data: 'pg_Каталог' }],
            [{ text: '🛍️ Карточка товара', callback_data: 'pg_Карточка товара' }, { text: '🛒 Корзина', callback_data: 'pg_Корзина' }],
            [{ text: '📦 Заказы', callback_data: 'pg_Заказы' }, { text: '🔍 Поиск', callback_data: 'pg_Поиск' }],
            [{ text: '✏️ Другое (напишите)', callback_data: 'pg_custom' }]
          ]
        };

        bot.editMessageText(`✅ Маркетплейс: *${state.marketplace}*\n\n📄 *Выберите страницу:*`, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });

      } else if (data.startsWith('pg_')) {
        // Page selected
        if (data === 'pg_custom') {
          state.step = 'page_input';
          userStates.set(chatId, state);
          bot.editMessageText(`✅ Маркетплейс: *${state.marketplace}*\n\n✏️ *Напишите название страницы:*`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
          });
        } else {
          state.page = data.replace('pg_', '');
          state.date = new Date().toISOString().split('T')[0];
          
          // Upload the file
          await finalizeUpload(chatId, state, query.message.message_id);
        }
      }
    });

    // Handle text messages for custom page input
    bot.on('text', async (msg) => {
      if (msg.text.startsWith('/')) return; // Skip commands
      
      const chatId = msg.chat.id;
      const state = userStates.get(chatId);

      if (state && state.step === 'page_input') {
        state.page = msg.text;
        state.date = new Date().toISOString().split('T')[0];
        
        await finalizeUpload(chatId, state);
      }
    });

    // Finalize upload
    async function finalizeUpload(chatId, state, editMessageId = null) {
      const statusMsg = editMessageId 
        ? await bot.editMessageText('⏳ *Загружаю скриншот...*', { chat_id: chatId, message_id: editMessageId, parse_mode: 'Markdown' })
        : await bot.sendMessage(chatId, '⏳ *Загружаю скриншот...*', { parse_mode: 'Markdown' });

      try {
        const file = await bot.getFile(state.fileId);
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        const fileBuffer = await downloadFile(fileUrl);

        const ext = file.file_path.split('.').pop() || 'jpg';
        const fileName = `${uuidv4()}.${ext}`;

        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(`images/${fileName}`, fileBuffer, {
            contentType: state.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`
          });

        if (error) {
          throw error;
        }

        // Save metadata
        imageMetadata.set(fileName, {
          marketplace: state.marketplace,
          page: state.page,
          date: state.date,
          description: state.description || ''
        });

        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(`images/${fileName}`);

        const msgId = editMessageId || statusMsg.message_id;
        await bot.editMessageText(
          `✅ *Скриншот загружен!*\n\n📦 Маркетплейс: ${state.marketplace}\n📄 Страница: ${state.page}\n📅 Дата: ${state.date}\n\n🔗 ${urlData.publicUrl}`,
          { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
        );

        userStates.delete(chatId);

      } catch (e) {
        console.error('Upload error:', e);
        bot.sendMessage(chatId, '❌ Ошибка загрузки. Попробуйте ещё раз.');
        userStates.delete(chatId);
      }
    }

    // Quick upload with metadata from caption
    async function uploadPhoto(msg, metadata) {
      const chatId = msg.chat.id;
      const statusMsg = await bot.sendMessage(chatId, '⏳ Загружаю...');

      try {
        const photo = msg.photo[msg.photo.length - 1];
        const file = await bot.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        const fileBuffer = await downloadFile(fileUrl);

        const ext = file.file_path.split('.').pop() || 'jpg';
        const fileName = `${uuidv4()}.${ext}`;

        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(`images/${fileName}`, fileBuffer, {
            contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`
          });

        if (error) throw error;

        imageMetadata.set(fileName, metadata);

        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(`images/${fileName}`);

        await bot.editMessageText(
          `✅ *Загружено!*\n\n📦 ${metadata.marketplace} • ${metadata.page}\n🔗 ${urlData.publicUrl}`,
          { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
        );

      } catch (e) {
        console.error('Quick upload error:', e);
        bot.editMessageText('❌ Ошибка', { chat_id: chatId, message_id: statusMsg.message_id });
      }
    }

    async function uploadDocument(msg, metadata) {
      const chatId = msg.chat.id;
      const statusMsg = await bot.sendMessage(chatId, '⏳ Загружаю...');

      try {
        const doc = msg.document;
        const file = await bot.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        const fileBuffer = await downloadFile(fileUrl);

        const ext = file.file_path.split('.').pop() || 'jpg';
        const fileName = `${uuidv4()}.${ext}`;

        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(`images/${fileName}`, fileBuffer, {
            contentType: doc.mime_type
          });

        if (error) throw error;

        imageMetadata.set(fileName, metadata);

        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(`images/${fileName}`);

        await bot.editMessageText(
          `✅ *Загружено!*\n\n📦 ${metadata.marketplace} • ${metadata.page}\n🔗 ${urlData.publicUrl}`,
          { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
        );

      } catch (e) {
        console.error('Document upload error:', e);
        bot.editMessageText('❌ Ошибка', { chat_id: chatId, message_id: statusMsg.message_id });
      }
    }

    bot.on('polling_error', (error) => {
      console.error('Bot polling error:', error.code);
    });

  } catch (botError) {
    console.error('Failed to start Telegram bot:', botError.message);
  }
} else {
  console.log('Telegram bot disabled (no token)');
}
