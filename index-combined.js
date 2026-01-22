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
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini AI
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;
let visionModel = null;

if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  visionModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  console.log('Gemini Vision AI initialized');
}

// Function to analyze screenshot with Gemini
async function analyzeScreenshot(imageBuffer) {
  if (!visionModel) {
    return { marketplace: 'Не определён', page: 'Не определена', description: '' };
  }

  try {
    const prompt = `Проанализируй этот скриншот и определи:
1. Какой это маркетплейс? (Ozon, Wildberries, Яндекс.Маркет, AliExpress, СберМегаМаркет, Amazon, или другой)
2. Какая это страница? (Главная, Каталог, Карточка товара, Корзина, Заказы, Поиск, Личный кабинет, или другая)
3. Краткое описание что изображено на скриншоте (1 предложение)

Ответь СТРОГО в формате JSON без markdown:
{"marketplace": "название", "page": "название страницы", "description": "краткое описание"}

Если не можешь определить - напиши "Не определён" или "Не определена".`;

    const imagePart = {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: 'image/jpeg'
      }
    };

    const result = await visionModel.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();
    
    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        marketplace: parsed.marketplace || 'Не определён',
        page: parsed.page || 'Не определена',
        description: parsed.description || ''
      };
    }
    
    return { marketplace: 'Не определён', page: 'Не определена', description: '' };
  } catch (error) {
    console.error('Gemini analysis error:', error.message);
    return { marketplace: 'Не определён', page: 'Не определена', description: '' };
  }
}

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
      bot.sendMessage(msg.chat.id, `
📸 *Screenshot Library Bot*

Просто отправьте мне скриншот — я автоматически определю:
• Маркетплейс (Ozon, Wildberries, и др.)
• Тип страницы (Карточка товара, Каталог, и др.)
• Описание содержимого

*Команды:*
/list — последние скриншоты
/stats — статистика

🤖 Powered by Gemini AI
      `, { parse_mode: 'Markdown' });
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
        bot.sendMessage(msg.chat.id, `📊 *Статистика*\n\nВсего скриншотов: *${images.length}*\nAI-анализ: ${visionModel ? '✅ включён' : '❌ выключен'}`, { parse_mode: 'Markdown' });
      } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Ошибка');
      }
    });

    // Handle photo upload with AI analysis
    bot.on('photo', async (msg) => {
      const chatId = msg.chat.id;

      try {
        const statusMsg = await bot.sendMessage(chatId, '🔍 *Анализирую скриншот...*', { parse_mode: 'Markdown' });

        const photo = msg.photo[msg.photo.length - 1];
        const file = await bot.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        const fileBuffer = await downloadFile(fileUrl);

        // Analyze with Gemini AI
        await bot.editMessageText('🤖 *AI анализирует изображение...*', { 
          chat_id: chatId, 
          message_id: statusMsg.message_id, 
          parse_mode: 'Markdown' 
        });

        const analysis = await analyzeScreenshot(fileBuffer);

        await bot.editMessageText('⏳ *Загружаю в библиотеку...*', { 
          chat_id: chatId, 
          message_id: statusMsg.message_id, 
          parse_mode: 'Markdown' 
        });

        const ext = file.file_path.split('.').pop() || 'jpg';
        const fileName = `${uuidv4()}.${ext}`;

        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(`images/${fileName}`, fileBuffer, {
            contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`
          });

        if (error) throw error;

        // Save metadata from AI analysis
        const metadata = {
          marketplace: analysis.marketplace,
          page: analysis.page,
          date: new Date().toISOString().split('T')[0],
          description: analysis.description
        };
        imageMetadata.set(fileName, metadata);

        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(`images/${fileName}`);

        await bot.editMessageText(
          `✅ *Скриншот загружен!*\n\n📦 Маркетплейс: *${metadata.marketplace}*\n📄 Страница: *${metadata.page}*\n📝 ${metadata.description}\n📅 Дата: ${metadata.date}\n\n🔗 ${urlData.publicUrl}`,
          { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
        );

      } catch (e) {
        console.error('Photo upload error:', e);
        bot.sendMessage(chatId, '❌ Ошибка при загрузке. Попробуйте ещё раз.');
      }
    });

    // Handle document (file) upload with AI analysis
    bot.on('document', async (msg) => {
      const chatId = msg.chat.id;
      const doc = msg.document;

      // Check if it's an image
      if (!doc.mime_type || !doc.mime_type.startsWith('image/')) {
        bot.sendMessage(chatId, '⚠️ Пожалуйста, отправьте изображение (JPEG, PNG, GIF, WebP)');
        return;
      }

      try {
        const statusMsg = await bot.sendMessage(chatId, '🔍 *Анализирую скриншот...*', { parse_mode: 'Markdown' });

        const file = await bot.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        const fileBuffer = await downloadFile(fileUrl);

        // Analyze with Gemini AI
        await bot.editMessageText('🤖 *AI анализирует изображение...*', { 
          chat_id: chatId, 
          message_id: statusMsg.message_id, 
          parse_mode: 'Markdown' 
        });

        const analysis = await analyzeScreenshot(fileBuffer);

        await bot.editMessageText('⏳ *Загружаю в библиотеку...*', { 
          chat_id: chatId, 
          message_id: statusMsg.message_id, 
          parse_mode: 'Markdown' 
        });

        const ext = file.file_path.split('.').pop() || 'jpg';
        const fileName = `${uuidv4()}.${ext}`;

        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(`images/${fileName}`, fileBuffer, {
            contentType: doc.mime_type
          });

        if (error) throw error;

        // Save metadata from AI analysis
        const metadata = {
          marketplace: analysis.marketplace,
          page: analysis.page,
          date: new Date().toISOString().split('T')[0],
          description: analysis.description
        };
        imageMetadata.set(fileName, metadata);

        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(`images/${fileName}`);

        await bot.editMessageText(
          `✅ *Скриншот загружен!*\n\n📦 Маркетплейс: *${metadata.marketplace}*\n📄 Страница: *${metadata.page}*\n📝 ${metadata.description}\n📅 Дата: ${metadata.date}\n\n🔗 ${urlData.publicUrl}`,
          { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
        );

      } catch (e) {
        console.error('Document upload error:', e);
        bot.sendMessage(chatId, '❌ Ошибка при загрузке. Попробуйте ещё раз.');
      }
    });

    bot.on('polling_error', (error) => {
      console.error('Bot polling error:', error.code);
    });

  } catch (botError) {
    console.error('Failed to start Telegram bot:', botError.message);
  }
} else {
  console.log('Telegram bot disabled (no token)');
}
