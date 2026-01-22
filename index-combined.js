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
const VISION_MODELS = ['gemini-1.5-flash-latest', 'gemini-1.5-pro-latest', 'gemini-pro-vision', 'gemini-1.0-pro-vision-latest'];
let currentModelIndex = 0;

if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  visionModel = genAI.getGenerativeModel({ model: VISION_MODELS[0] });
  console.log(`Gemini Vision AI initialized, will try models: ${VISION_MODELS.join(', ')}`);
}

// Function to analyze screenshot with Gemini
async function analyzeScreenshot(imageBuffer) {
  if (!genAI) {
    console.log('Gemini AI not initialized');
    return { marketplace: null, page: null, description: '', confidence: false };
  }

  // Try each model until one works
  for (let i = 0; i < VISION_MODELS.length; i++) {
    const modelName = VISION_MODELS[i];
    console.log(`Trying model: ${modelName}`);
    
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await tryAnalyzeWithModel(model, imageBuffer);
      if (result) {
        console.log(`Success with model: ${modelName}`);
        return result;
      }
    } catch (error) {
      console.log(`Model ${modelName} failed: ${error.message}`);
      continue;
    }
  }
  
  console.log('All models failed');
  return { marketplace: null, page: null, description: '', confidence: false };
}

async function tryAnalyzeWithModel(model, imageBuffer) {
  const prompt = `Analyze this screenshot of a marketplace/e-commerce app or website.

TASK: Identify the marketplace and page type.

MARKETPLACE IDENTIFICATION - Look for these visual signs:
1. ALIEXPRESS - Red/orange colors, "AliExpress" text anywhere on screen, Chinese products, prices in rubles with discounts
2. OZON - Blue colors, "OZON" logo, blue buttons and interface
3. WILDBERRIES - Purple/pink colors, "Wildberries" or "WB" logo
4. ЯНДЕКС.МАРКЕТ - Yellow colors, Yandex logo, "Маркет" text
5. СБЕРМЕГАМАРКЕТ - Green colors, "СберМегаМаркет" or "Мегамаркет" text
6. AMAZON - Orange smile arrow logo, "Amazon" text
7. LAMODA - Black and white minimalist design, "LAMODA" text
8. AVITO - Green colors, "Avito" logo

PAGE TYPE - Identify what kind of page this is:
- Главная (main page with banners, categories, recommendations, promotions)
- Каталог (product list, category page, filters)
- Карточка товара (single product page with buy button)
- Корзина (shopping cart)
- Поиск (search results)
- Заказы (order history)
- Профиль (user profile, account)

IMPORTANT: If you see "AliExpress" text ANYWHERE on the image, the marketplace IS AliExpress.

Respond ONLY with JSON (no markdown):
{"marketplace": "NAME", "page": "PAGE_TYPE", "description": "brief description", "confidence": true}

Set confidence to true if you can identify the marketplace. Only set false if you truly cannot determine it.`;

    const imagePart = {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: 'image/jpeg'
      }
    };

    const result = await visionModel.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();
    
    console.log('Gemini raw response:', text);
    
    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('Parsed result:', parsed);
        
        // Normalize marketplace names
        let marketplace = parsed.marketplace;
        if (marketplace) {
          marketplace = marketplace.trim();
          // Normalize common variations
          if (marketplace.toLowerCase().includes('aliexpress') || marketplace.toLowerCase().includes('ali express')) {
            marketplace = 'AliExpress';
          } else if (marketplace.toLowerCase().includes('ozon')) {
            marketplace = 'Ozon';
          } else if (marketplace.toLowerCase().includes('wildberries') || marketplace.toLowerCase() === 'wb') {
            marketplace = 'Wildberries';
          } else if (marketplace.toLowerCase().includes('яндекс') || marketplace.toLowerCase().includes('yandex')) {
            marketplace = 'Яндекс.Маркет';
          }
        }
        
        return {
          marketplace: marketplace || null,
          page: parsed.page || null,
          description: parsed.description || '',
          confidence: parsed.confidence !== false
        };
      } catch (parseError) {
        console.error('JSON parse error:', parseError.message);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Model error:', error.message);
    throw error; // Re-throw to try next model
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

    // Store pending uploads waiting for user input
    const pendingUploads = new Map();

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

    // Marketplace keyboard
    const marketplaceKeyboard = {
      inline_keyboard: [
        [{ text: '🔵 Ozon', callback_data: 'mp_Ozon' }, { text: '🟣 Wildberries', callback_data: 'mp_Wildberries' }],
        [{ text: '🟡 Яндекс.Маркет', callback_data: 'mp_Яндекс.Маркет' }, { text: '🟠 AliExpress', callback_data: 'mp_AliExpress' }],
        [{ text: '🟢 СберМегаМаркет', callback_data: 'mp_СберМегаМаркет' }, { text: '🛒 Lamoda', callback_data: 'mp_Lamoda' }],
        [{ text: '🟢 Avito', callback_data: 'mp_Avito' }, { text: '📦 Amazon', callback_data: 'mp_Amazon' }],
        [{ text: '⚪ Другой', callback_data: 'mp_Другой' }]
      ]
    };

    // Page type keyboard
    const pageKeyboard = {
      inline_keyboard: [
        [{ text: '🏠 Главная', callback_data: 'pg_Главная' }, { text: '📋 Каталог', callback_data: 'pg_Каталог' }],
        [{ text: '🛍️ Карточка товара', callback_data: 'pg_Карточка товара' }, { text: '🛒 Корзина', callback_data: 'pg_Корзина' }],
        [{ text: '📦 Заказы', callback_data: 'pg_Заказы' }, { text: '🔍 Поиск', callback_data: 'pg_Поиск' }],
        [{ text: '👤 Личный кабинет', callback_data: 'pg_Личный кабинет' }, { text: '⭐ Отзывы', callback_data: 'pg_Отзывы' }],
        [{ text: '🏷️ Акции', callback_data: 'pg_Акции' }, { text: '📄 Другое', callback_data: 'pg_Другое' }]
      ]
    };

    // Start command
    bot.onText(/\/start/, (msg) => {
      pendingUploads.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, `
📸 *Screenshot Library Bot*

Отправьте мне скриншот маркетплейса — я автоматически определю:
• Маркетплейс (Ozon, Wildberries, и др.)
• Тип страницы (Карточка товара, Каталог, и др.)

Если не смогу определить — спрошу у вас!

*Команды:*
/list — последние скриншоты
/stats — статистика
/cancel — отменить загрузку

🤖 Powered by Gemini AI
      `, { parse_mode: 'Markdown' });
    });

    // Cancel command
    bot.onText(/\/cancel/, (msg) => {
      pendingUploads.delete(msg.chat.id);
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
        bot.sendMessage(msg.chat.id, `📊 *Статистика*\n\nВсего скриншотов: *${images.length}*\nAI-анализ: ${visionModel ? '✅ включён' : '❌ выключен'}`, { parse_mode: 'Markdown' });
      } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Ошибка');
      }
    });

    // Process and upload image
    async function processImage(chatId, fileBuffer, fileName, mimeType, statusMsgId) {
      try {
        // Analyze with Gemini AI
        await bot.editMessageText('🤖 *AI анализирует изображение...*', { 
          chat_id: chatId, 
          message_id: statusMsgId, 
          parse_mode: 'Markdown' 
        });

        const analysis = await analyzeScreenshot(fileBuffer);
        
        console.log('Analysis result:', analysis);

        // Check if AI is confident about the result
        const needsMarketplace = !analysis.marketplace || analysis.marketplace === 'null' || !analysis.confidence;
        const needsPage = !analysis.page || analysis.page === 'null';

        if (needsMarketplace) {
          // Store pending upload and ask user
          pendingUploads.set(chatId, {
            fileBuffer,
            fileName,
            mimeType,
            analysis,
            step: 'marketplace',
            statusMsgId
          });

          await bot.editMessageText(
            `🤔 *Не удалось определить маркетплейс автоматически*\n\n${analysis.description ? `📝 ${analysis.description}\n\n` : ''}Выберите маркетплейс:`,
            { 
              chat_id: chatId, 
              message_id: statusMsgId, 
              parse_mode: 'Markdown',
              reply_markup: marketplaceKeyboard
            }
          );
          return;
        }

        if (needsPage) {
          // Store pending upload and ask for page
          pendingUploads.set(chatId, {
            fileBuffer,
            fileName,
            mimeType,
            analysis,
            step: 'page',
            statusMsgId
          });

          await bot.editMessageText(
            `✅ Маркетплейс: *${analysis.marketplace}*\n\n🤔 *Не удалось определить тип страницы*\n\nВыберите страницу:`,
            { 
              chat_id: chatId, 
              message_id: statusMsgId, 
              parse_mode: 'Markdown',
              reply_markup: pageKeyboard
            }
          );
          return;
        }

        // AI is confident - proceed with upload
        await finalizeUpload(chatId, fileBuffer, fileName, mimeType, analysis, statusMsgId);

      } catch (e) {
        console.error('Process image error:', e);
        bot.sendMessage(chatId, '❌ Ошибка при обработке. Попробуйте ещё раз.');
      }
    }

    // Finalize upload
    async function finalizeUpload(chatId, fileBuffer, fileName, mimeType, analysis, statusMsgId) {
      try {
        await bot.editMessageText('⏳ *Загружаю в библиотеку...*', { 
          chat_id: chatId, 
          message_id: statusMsgId, 
          parse_mode: 'Markdown' 
        });

        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(`images/${fileName}`, fileBuffer, {
            contentType: mimeType
          });

        if (error) throw error;

        // Save metadata
        const metadata = {
          marketplace: analysis.marketplace,
          page: analysis.page,
          date: new Date().toISOString().split('T')[0],
          description: analysis.description || ''
        };
        imageMetadata.set(fileName, metadata);

        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(`images/${fileName}`);

        await bot.editMessageText(
          `✅ *Скриншот загружен!*\n\n📦 Маркетплейс: *${metadata.marketplace}*\n📄 Страница: *${metadata.page}*\n${metadata.description ? `📝 ${metadata.description}\n` : ''}📅 Дата: ${metadata.date}\n\n🔗 ${urlData.publicUrl}`,
          { chat_id: chatId, message_id: statusMsgId, parse_mode: 'Markdown' }
        );

        pendingUploads.delete(chatId);

      } catch (e) {
        console.error('Finalize upload error:', e);
        bot.sendMessage(chatId, '❌ Ошибка при загрузке.');
        pendingUploads.delete(chatId);
      }
    }

    // Handle callback queries (button clicks)
    bot.on('callback_query', async (query) => {
      const chatId = query.message.chat.id;
      const data = query.data;
      const pending = pendingUploads.get(chatId);

      if (!pending) {
        bot.answerCallbackQuery(query.id, { text: 'Сессия истекла, отправьте фото заново' });
        return;
      }

      bot.answerCallbackQuery(query.id);

      if (data.startsWith('mp_')) {
        // Marketplace selected
        pending.analysis.marketplace = data.replace('mp_', '');
        
        // Check if we also need page
        if (!pending.analysis.page || pending.analysis.page === 'null') {
          pending.step = 'page';
          pendingUploads.set(chatId, pending);

          await bot.editMessageText(
            `✅ Маркетплейс: *${pending.analysis.marketplace}*\n\nВыберите тип страницы:`,
            { 
              chat_id: chatId, 
              message_id: query.message.message_id, 
              parse_mode: 'Markdown',
              reply_markup: pageKeyboard
            }
          );
        } else {
          // Have both - finalize
          await finalizeUpload(chatId, pending.fileBuffer, pending.fileName, pending.mimeType, pending.analysis, query.message.message_id);
        }

      } else if (data.startsWith('pg_')) {
        // Page selected
        pending.analysis.page = data.replace('pg_', '');
        
        // Finalize upload
        await finalizeUpload(chatId, pending.fileBuffer, pending.fileName, pending.mimeType, pending.analysis, query.message.message_id);
      }
    });

    // Handle photo upload
    bot.on('photo', async (msg) => {
      const chatId = msg.chat.id;

      try {
        const statusMsg = await bot.sendMessage(chatId, '🔍 *Анализирую скриншот...*', { parse_mode: 'Markdown' });

        const photo = msg.photo[msg.photo.length - 1];
        const file = await bot.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        const fileBuffer = await downloadFile(fileUrl);

        const ext = file.file_path.split('.').pop() || 'jpg';
        const fileName = `${uuidv4()}.${ext}`;
        const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

        await processImage(chatId, fileBuffer, fileName, mimeType, statusMsg.message_id);

      } catch (e) {
        console.error('Photo upload error:', e);
        bot.sendMessage(chatId, '❌ Ошибка при загрузке. Попробуйте ещё раз.');
      }
    });

    // Handle document (file) upload
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

        const ext = file.file_path.split('.').pop() || 'jpg';
        const fileName = `${uuidv4()}.${ext}`;

        await processImage(chatId, fileBuffer, fileName, doc.mime_type, statusMsg.message_id);

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
