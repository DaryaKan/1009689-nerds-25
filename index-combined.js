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

// Initialize Gemini AI
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (GEMINI_API_KEY) {
  console.log('Gemini API key configured');
}

// Function to analyze screenshot with Gemini using direct HTTP API
async function analyzeScreenshot(imageBuffer) {
  if (!GEMINI_API_KEY) {
    console.log('Gemini API key not configured');
    return { marketplace: null, page: null, description: '', confidence: false };
  }

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

  // Try different API endpoints - using available models
  const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro-vision'];
  
  for (const model of models) {
    try {
      console.log(`Trying Gemini model: ${model}`);
      
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      
      const requestBody = {
        contents: [{
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: imageBuffer.toString('base64')
              }
            }
          ]
        }]
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();
      
      if (data.error) {
        console.log(`Model ${model} error:`, data.error.message);
        continue;
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) {
        console.log(`Model ${model}: No text in response`);
        continue;
      }

      console.log(`Gemini response from ${model}:`, text);
      
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
    } catch (error) {
      console.error(`Model ${model} request error:`, error.message);
      continue;
    }
  }
  
  console.log('All Gemini models failed');
  return { marketplace: null, page: null, description: '', confidence: false };
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

// In-memory metadata store
const imageMetadata = new Map();
const METADATA_FILE = 'metadata.json';

// Load metadata from Supabase Storage on startup
async function loadMetadata() {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(METADATA_FILE);
    
    if (error) {
      console.log('No existing metadata file, starting fresh');
      return;
    }
    
    const text = await data.text();
    const metadata = JSON.parse(text);
    
    Object.entries(metadata).forEach(([key, value]) => {
      imageMetadata.set(key, value);
    });
    
    console.log(`Loaded metadata for ${imageMetadata.size} images`);
  } catch (err) {
    console.log('Error loading metadata:', err.message);
  }
}

// Save metadata to Supabase Storage
async function saveMetadata() {
  try {
    const metadata = Object.fromEntries(imageMetadata);
    const jsonData = JSON.stringify(metadata, null, 2);
    
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(METADATA_FILE, jsonData, {
        contentType: 'application/json',
        upsert: true
      });
    
    if (error) {
      console.error('Error saving metadata:', error.message);
    }
  } catch (err) {
    console.error('Error saving metadata:', err.message);
  }
}

// Load metadata on startup
loadMetadata();

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
    
    // Save metadata to storage
    await saveMetadata();

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

    // Remove metadata and save
    imageMetadata.delete(id);
    await saveMetadata();

    res.json({ success: true, message: 'Deleted' });

  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Update image metadata
app.put('/api/images/:id/metadata', express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { marketplace, page, date, description } = req.body;
    
    // Check if image exists
    const existingMeta = imageMetadata.get(id);
    if (!existingMeta) {
      // Check if file exists in storage
      const { data } = await supabase.storage.from(BUCKET).list('images');
      const fileExists = data?.some(f => f.name === id);
      if (!fileExists) {
        return res.status(404).json({ error: 'Image not found' });
      }
    }
    
    // Update metadata
    const newMetadata = {
      marketplace: marketplace || existingMeta?.marketplace || '',
      page: page || existingMeta?.page || '',
      date: date || existingMeta?.date || '',
      description: description !== undefined ? description : (existingMeta?.description || '')
    };
    
    imageMetadata.set(id, newMetadata);
    await saveMetadata();
    
    res.json({ success: true, metadata: newMetadata });
    
  } catch (error) {
    console.error('Update metadata error:', error);
    res.status(500).json({ error: 'Update failed', details: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    bot: process.env.TELEGRAM_BOT_TOKEN ? 'enabled' : 'disabled',
    gemini: GEMINI_API_KEY ? 'configured' : 'not configured'
  });
});

// Test Gemini API
app.get('/api/test-gemini', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.json({ success: false, error: 'GEMINI_API_KEY not configured' });
  }
  
  try {
    const models = ['gemini-1.5-flash', 'gemini-1.5-pro'];
    const results = [];
    
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Say "Hello"' }] }]
          })
        });
        
        const data = await response.json();
        
        if (data.error) {
          results.push({ model, success: false, error: data.error.message });
        } else {
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          results.push({ model, success: true, response: text?.substring(0, 50) });
        }
      } catch (e) {
        results.push({ model, success: false, error: e.message });
      }
    }
    
    res.json({ success: true, results });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Analyze images with missing metadata
app.post('/api/analyze-missing', async (req, res) => {
  try {
    // Check if Gemini is configured
    if (!GEMINI_API_KEY) {
      return res.status(400).json({ 
        error: 'GEMINI_API_KEY not configured',
        hint: 'Set GEMINI_API_KEY environment variable in Railway'
      });
    }
    
    // Get all images
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list('images', { limit: 1000 });
    
    if (error) {
      return res.status(500).json({ error: 'Failed to list images' });
    }
    
    const images = files.filter(f => f.name !== '.emptyFolderPlaceholder');
    
    // Find images that need analysis
    const invalidValues = ['не указан', 'не указана', 'не определён', 'не определена', 'unknown', ''];
    const toAnalyze = images.filter(img => {
      const meta = imageMetadata.get(img.name);
      if (!meta) return true;
      const mp = (meta.marketplace || '').toLowerCase();
      const pg = (meta.page || '').toLowerCase();
      return invalidValues.includes(mp) || invalidValues.includes(pg);
    });
    
    if (toAnalyze.length === 0) {
      return res.json({ success: true, message: 'All images have valid metadata', analyzed: 0 });
    }
    
    console.log(`Analyzing ${toAnalyze.length} images with missing metadata...`);
    
    let updated = 0;
    let failed = 0;
    const results = [];
    
    for (const img of toAnalyze) {
      try {
        // Get public URL
        const { data: urlData } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(`images/${img.name}`);
        
        // Download image
        const imageBuffer = await new Promise((resolve, reject) => {
          const protocol = urlData.publicUrl.startsWith('https') ? https : http;
          protocol.get(urlData.publicUrl, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
          }).on('error', reject);
        });
        
        // Analyze with AI
        const analysis = await analyzeScreenshot(imageBuffer);
        
        if (analysis && analysis.marketplace) {
          // Normalize marketplace name
          let normalizedMp = analysis.marketplace;
          const lower = normalizedMp.toLowerCase();
          
          if (lower.includes('мегамаркет') || lower.includes('сбер')) {
            normalizedMp = 'Мегамаркет';
          } else if (lower.includes('яндекс') && lower.includes('маркет')) {
            normalizedMp = 'Яндекс Маркет';
          }
          
          // Get existing metadata
          const existingMeta = imageMetadata.get(img.name) || {};
          
          // Update metadata
          const newMeta = {
            marketplace: normalizedMp,
            page: analysis.page || existingMeta.page || 'Не указана',
            date: existingMeta.date || new Date().toISOString().split('T')[0],
            description: analysis.description || existingMeta.description || ''
          };
          
          imageMetadata.set(img.name, newMeta);
          results.push({ id: img.name, success: true, marketplace: normalizedMp, page: analysis.page });
          updated++;
        } else {
          results.push({ id: img.name, success: false });
          failed++;
        }
        
        // Small delay
        await new Promise(r => setTimeout(r, 500));
        
      } catch (err) {
        console.error(`Error analyzing ${img.name}:`, err.message);
        results.push({ id: img.name, success: false, error: err.message });
        failed++;
      }
    }
    
    // Save metadata
    if (updated > 0) {
      await saveMetadata();
    }
    
    res.json({
      success: true,
      total: toAnalyze.length,
      updated,
      failed,
      results
    });
    
  } catch (error) {
    console.error('Analyze missing error:', error);
    res.status(500).json({ error: 'Analysis failed', details: error.message });
  }
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
    
    // Store user states (date selection, etc.)
    const userStates = new Map();
    
    // Store pending photos waiting for date
    const pendingPhotos = new Map();
    
    // Store media groups (albums) for batch processing
    const mediaGroups = new Map();
    const MEDIA_GROUP_TIMEOUT = 1000; // Wait 1 second to collect all photos in album

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

    // Date keyboard
    const dateKeyboard = {
      inline_keyboard: [
        [{ text: '📅 Сегодня', callback_data: 'date_today' }, { text: '📅 Вчера', callback_data: 'date_yesterday' }],
        [{ text: '📅 Позавчера', callback_data: 'date_2days' }, { text: '📅 3 дня назад', callback_data: 'date_3days' }],
        [{ text: '✏️ Ввести дату', callback_data: 'date_custom' }]
      ]
    };

    // Format date for display
    function formatDate(date) {
      return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    // Get date string (YYYY-MM-DD)
    function getDateString(date) {
      return date.toISOString().split('T')[0];
    }

    // Start command
    bot.onText(/\/start/, (msg) => {
      pendingUploads.delete(msg.chat.id);
      userStates.delete(msg.chat.id);
      pendingPhotos.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, `
📸 *Screenshot Library Bot*

*Как загрузить скриншоты:*
1️⃣ Укажите дату командой /date
2️⃣ Отправьте скриншоты (можно несколько сразу)
3️⃣ Бот определит маркетплейс и страницу автоматически

*Команды:*
/date — установить дату для загрузок
/list — последние скриншоты
/stats — статистика
/cancel — отменить / сбросить

🤖 Powered by Gemini AI
      `, { parse_mode: 'Markdown' });
    });

    // Date command
    bot.onText(/\/date/, (msg) => {
      const state = userStates.get(msg.chat.id) || {};
      const currentDate = state.date ? new Date(state.date) : null;
      
      let text = '📅 *Выберите дату для скриншотов:*';
      if (currentDate) {
        text += `\n\nТекущая дата: *${formatDate(currentDate)}*`;
      }
      
      bot.sendMessage(msg.chat.id, text, { 
        parse_mode: 'Markdown',
        reply_markup: dateKeyboard 
      });
    });

    // Cancel command
    bot.onText(/\/cancel/, (msg) => {
      pendingUploads.delete(msg.chat.id);
      userStates.delete(msg.chat.id);
      pendingPhotos.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, '❌ Сброшено. Используйте /date чтобы начать заново.');
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
        bot.sendMessage(msg.chat.id, `📊 *Статистика*\n\nВсего скриншотов: *${images.length}*\nAI-анализ: ${GEMINI_API_KEY ? '✅ включён' : '❌ выключен'}`, { parse_mode: 'Markdown' });
      } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Ошибка');
      }
    });

    // Handle text messages (for custom date input)
    bot.on('text', async (msg) => {
      // Skip commands
      if (msg.text.startsWith('/')) return;
      
      const chatId = msg.chat.id;
      const state = userStates.get(chatId);
      
      // Check if waiting for custom date
      if (state && state.waitingForDate) {
        const text = msg.text.trim();
        
        // Try to parse date in DD.MM.YYYY format
        const dateMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          const date = new Date(year, month - 1, day);
          
          // Validate date
          if (date.getDate() == day && date.getMonth() == month - 1) {
            const dateStr = getDateString(date);
            userStates.set(chatId, { date: dateStr });
            
            // Check for pending photos
            const pending = pendingPhotos.get(chatId);
            if (pending && pending.length > 0) {
              pendingPhotos.delete(chatId);
              
              bot.sendMessage(chatId, 
                `✅ *Дата установлена: ${formatDate(date)}*\n\n⏳ Обрабатываю ${pending.length} скриншот(ов)...`,
                { parse_mode: 'Markdown' }
              );
              
              // Process pending photos
              const photos = pending.map(p => p.photo);
              if (photos.length === 1) {
                const photo = photos[0];
                const file = await bot.getFile(photo.file_id);
                const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
                const fileBuffer = await downloadFile(fileUrl);
                const ext = file.file_path.split('.').pop() || 'jpg';
                const fileName = `${uuidv4()}.${ext}`;
                const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                
                const statusMsg = await bot.sendMessage(chatId, '🔍 *Анализирую скриншот...*', { parse_mode: 'Markdown' });
                await processImage(chatId, fileBuffer, fileName, mimeType, statusMsg.message_id);
              } else {
                await processAlbum(chatId, photos);
              }
            } else {
              bot.sendMessage(chatId, 
                `✅ *Дата установлена: ${formatDate(date)}*\n\n📸 Теперь отправьте скриншоты — они будут сохранены с этой датой.\n\nДля смены даты: /date`,
                { parse_mode: 'Markdown' }
              );
            }
          } else {
            bot.sendMessage(chatId, '❌ Некорректная дата. Введите в формате ДД.ММ.ГГГГ\nНапример: 15.01.2026');
          }
        } else {
          bot.sendMessage(chatId, '❌ Неверный формат. Введите дату в формате ДД.ММ.ГГГГ\nНапример: 15.01.2026');
        }
        return;
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

        // Get date from user state or use today
        const state = userStates.get(chatId);
        const screenshotDate = state?.date || new Date().toISOString().split('T')[0];

        // Save metadata
        const metadata = {
          marketplace: analysis.marketplace,
          page: analysis.page,
          date: screenshotDate,
          description: analysis.description || ''
        };
        imageMetadata.set(fileName, metadata);
        await saveMetadata();

        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(`images/${fileName}`);
        const formattedDate = new Date(screenshotDate).toLocaleDateString('ru-RU');

        await bot.editMessageText(
          `✅ *Скриншот загружен!*\n\n📦 Маркетплейс: *${metadata.marketplace}*\n📄 Страница: *${metadata.page}*\n${metadata.description ? `📝 ${metadata.description}\n` : ''}📅 Дата: ${formattedDate}\n\n🔗 ${urlData.publicUrl}`,
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

      bot.answerCallbackQuery(query.id);

      // Handle date selection
      if (data.startsWith('date_')) {
        let selectedDate;
        const today = new Date();
        
        if (data === 'date_today') {
          selectedDate = today;
        } else if (data === 'date_yesterday') {
          selectedDate = new Date(today);
          selectedDate.setDate(selectedDate.getDate() - 1);
        } else if (data === 'date_2days') {
          selectedDate = new Date(today);
          selectedDate.setDate(selectedDate.getDate() - 2);
        } else if (data === 'date_3days') {
          selectedDate = new Date(today);
          selectedDate.setDate(selectedDate.getDate() - 3);
        } else if (data === 'date_custom') {
          // Ask for custom date input
          userStates.set(chatId, { waitingForDate: true });
          await bot.editMessageText(
            '✏️ *Введите дату в формате ДД.ММ.ГГГГ*\n\nНапример: 15.01.2026',
            { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
          );
          return;
        }

        if (selectedDate) {
          const dateStr = getDateString(selectedDate);
          userStates.set(chatId, { date: dateStr });
          
          // Check for pending photos
          const pending = pendingPhotos.get(chatId);
          if (pending && pending.length > 0) {
            pendingPhotos.delete(chatId);
            
            await bot.editMessageText(
              `✅ *Дата установлена: ${formatDate(selectedDate)}*\n\n⏳ Обрабатываю ${pending.length} скриншот(ов)...`,
              { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
            );
            
            // Process pending photos
            const photos = pending.map(p => p.photo);
            if (photos.length === 1) {
              // Single photo
              const photo = photos[0];
              const file = await bot.getFile(photo.file_id);
              const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
              const fileBuffer = await downloadFile(fileUrl);
              const ext = file.file_path.split('.').pop() || 'jpg';
              const fileName = `${uuidv4()}.${ext}`;
              const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
              
              const statusMsg = await bot.sendMessage(chatId, '🔍 *Анализирую скриншот...*', { parse_mode: 'Markdown' });
              await processImage(chatId, fileBuffer, fileName, mimeType, statusMsg.message_id);
            } else {
              // Multiple photos
              await processAlbum(chatId, photos);
            }
          } else {
            await bot.editMessageText(
              `✅ *Дата установлена: ${formatDate(selectedDate)}*\n\n📸 Теперь отправьте скриншоты — они будут сохранены с этой датой.\n\nДля смены даты: /date`,
              { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
            );
          }
        }
        return;
      }

      // Handle marketplace/page selection
      const pending = pendingUploads.get(chatId);

      if (!pending) {
        return;
      }

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

    // Process album (multiple photos)
    async function processAlbum(chatId, photos) {
      // Get date from user state or use today
      const state = userStates.get(chatId);
      const screenshotDate = state?.date || new Date().toISOString().split('T')[0];
      const formattedDate = new Date(screenshotDate).toLocaleDateString('ru-RU');

      const statusMsg = await bot.sendMessage(chatId, `📸 *Обрабатываю ${photos.length} скриншотов...*\n📅 Дата: ${formattedDate}`, { parse_mode: 'Markdown' });
      
      let successCount = 0;
      let failCount = 0;
      const results = [];

      for (let i = 0; i < photos.length; i++) {
        try {
          await bot.editMessageText(
            `🔍 *Анализирую скриншот ${i + 1} из ${photos.length}...*\n📅 Дата: ${formattedDate}`,
            { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
          );

          const photo = photos[i];
          const file = await bot.getFile(photo.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
          const fileBuffer = await downloadFile(fileUrl);

          // Analyze with AI
          const analysis = await analyzeScreenshot(fileBuffer);

          const ext = file.file_path.split('.').pop() || 'jpg';
          const fileName = `${uuidv4()}.${ext}`;
          const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

          // Upload to Supabase
          const { error } = await supabase.storage
            .from(BUCKET)
            .upload(`images/${fileName}`, fileBuffer, {
              contentType: mimeType
            });

          if (error) throw error;

          // Save metadata with user-specified date
          const metadata = {
            marketplace: analysis.marketplace || 'Не определён',
            page: analysis.page || 'Не определена',
            date: screenshotDate,
            description: analysis.description || ''
          };
          imageMetadata.set(fileName, metadata);

          const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(`images/${fileName}`);
          
          results.push({
            success: true,
            marketplace: metadata.marketplace,
            page: metadata.page,
            url: urlData.publicUrl
          });
          successCount++;

        } catch (e) {
          console.error(`Photo ${i + 1} upload error:`, e);
          results.push({ success: false });
          failCount++;
        }
      }

      // Save all metadata after batch upload
      await saveMetadata();

      // Send summary
      let summaryText = `✅ *Загружено ${successCount} из ${photos.length} скриншотов*\n\n`;
      
      results.forEach((r, i) => {
        if (r.success) {
          summaryText += `${i + 1}. ${r.marketplace} • ${r.page}\n`;
        } else {
          summaryText += `${i + 1}. ❌ Ошибка\n`;
        }
      });

      if (successCount > 0) {
        summaryText += `\n📁 Все скриншоты доступны в веб-галерее`;
      }

      await bot.editMessageText(summaryText, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown'
      });
    }

    // Handle photo upload (single or album)
    bot.on('photo', async (msg) => {
      const chatId = msg.chat.id;
      const mediaGroupId = msg.media_group_id;

      try {
        const photo = msg.photo[msg.photo.length - 1];
        const state = userStates.get(chatId);

        // Check if date is set
        if (!state?.date) {
          // Store photos for later processing
          if (!pendingPhotos.has(chatId)) {
            pendingPhotos.set(chatId, []);
          }
          pendingPhotos.get(chatId).push({ photo, mediaGroupId });

          // Only send message once (for first photo or single photo)
          if (!mediaGroupId || pendingPhotos.get(chatId).length === 1) {
            setTimeout(async () => {
              // After collecting all photos from album, ask for date
              bot.sendMessage(chatId, 
                '📅 *Сначала укажите дату скриншотов*\n\nВыберите дату, под которой сохранить скриншоты:',
                { parse_mode: 'Markdown', reply_markup: dateKeyboard }
              );
            }, mediaGroupId ? MEDIA_GROUP_TIMEOUT + 100 : 0);
          }
          return;
        }

        if (mediaGroupId) {
          // This is part of an album
          if (!mediaGroups.has(mediaGroupId)) {
            mediaGroups.set(mediaGroupId, {
              chatId,
              photos: [],
              timeout: null
            });
          }

          const group = mediaGroups.get(mediaGroupId);
          group.photos.push(photo);

          // Clear previous timeout and set new one
          if (group.timeout) {
            clearTimeout(group.timeout);
          }

          // Wait for more photos, then process
          group.timeout = setTimeout(async () => {
            const groupData = mediaGroups.get(mediaGroupId);
            mediaGroups.delete(mediaGroupId);
            
            if (groupData && groupData.photos.length > 0) {
              await processAlbum(groupData.chatId, groupData.photos);
            }
          }, MEDIA_GROUP_TIMEOUT);

        } else {
          // Single photo
          const statusMsg = await bot.sendMessage(chatId, '🔍 *Анализирую скриншот...*', { parse_mode: 'Markdown' });

          const file = await bot.getFile(photo.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
          const fileBuffer = await downloadFile(fileUrl);

          const ext = file.file_path.split('.').pop() || 'jpg';
          const fileName = `${uuidv4()}.${ext}`;
          const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

          await processImage(chatId, fileBuffer, fileName, mimeType, statusMsg.message_id);
        }

      } catch (e) {
        console.error('Photo upload error:', e);
        bot.sendMessage(chatId, '❌ Ошибка при загрузке. Попробуйте ещё раз.');
      }
    });

    // Store document groups for batch processing
    const documentGroups = new Map();

    // Process document album
    async function processDocumentAlbum(chatId, documents) {
      // Get date from user state or use today
      const state = userStates.get(chatId);
      const screenshotDate = state?.date || new Date().toISOString().split('T')[0];
      const formattedDate = new Date(screenshotDate).toLocaleDateString('ru-RU');

      const statusMsg = await bot.sendMessage(chatId, `📸 *Обрабатываю ${documents.length} файлов...*\n📅 Дата: ${formattedDate}`, { parse_mode: 'Markdown' });
      
      let successCount = 0;
      let failCount = 0;
      const results = [];

      for (let i = 0; i < documents.length; i++) {
        try {
          await bot.editMessageText(
            `🔍 *Анализирую файл ${i + 1} из ${documents.length}...*\n📅 Дата: ${formattedDate}`,
            { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
          );

          const doc = documents[i];
          const file = await bot.getFile(doc.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
          const fileBuffer = await downloadFile(fileUrl);

          // Analyze with AI
          const analysis = await analyzeScreenshot(fileBuffer);

          const ext = file.file_path.split('.').pop() || 'jpg';
          const fileName = `${uuidv4()}.${ext}`;

          // Upload to Supabase
          const { error } = await supabase.storage
            .from(BUCKET)
            .upload(`images/${fileName}`, fileBuffer, {
              contentType: doc.mime_type
            });

          if (error) throw error;

          // Save metadata with user-specified date
          const metadata = {
            marketplace: analysis.marketplace || 'Не определён',
            page: analysis.page || 'Не определена',
            date: screenshotDate,
            description: analysis.description || ''
          };
          imageMetadata.set(fileName, metadata);

          results.push({
            success: true,
            marketplace: metadata.marketplace,
            page: metadata.page
          });
          successCount++;

        } catch (e) {
          console.error(`Document ${i + 1} upload error:`, e);
          results.push({ success: false });
          failCount++;
        }
      }

      // Save all metadata after batch upload
      await saveMetadata();

      // Send summary
      let summaryText = `✅ *Загружено ${successCount} из ${documents.length} файлов*\n\n`;
      
      results.forEach((r, i) => {
        if (r.success) {
          summaryText += `${i + 1}. ${r.marketplace} • ${r.page}\n`;
        } else {
          summaryText += `${i + 1}. ❌ Ошибка\n`;
        }
      });

      await bot.editMessageText(summaryText, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown'
      });
    }

    // Handle document (file) upload
    bot.on('document', async (msg) => {
      const chatId = msg.chat.id;
      const doc = msg.document;
      const mediaGroupId = msg.media_group_id;

      // Check if it's an image
      if (!doc.mime_type || !doc.mime_type.startsWith('image/')) {
        if (!mediaGroupId) {
          bot.sendMessage(chatId, '⚠️ Пожалуйста, отправьте изображение (JPEG, PNG, GIF, WebP)');
        }
        return;
      }

      try {
        if (mediaGroupId) {
          // This is part of an album
          if (!documentGroups.has(mediaGroupId)) {
            documentGroups.set(mediaGroupId, {
              chatId,
              documents: [],
              timeout: null
            });
          }

          const group = documentGroups.get(mediaGroupId);
          group.documents.push(doc);

          // Clear previous timeout and set new one
          if (group.timeout) {
            clearTimeout(group.timeout);
          }

          // Wait for more documents, then process
          group.timeout = setTimeout(async () => {
            const groupData = documentGroups.get(mediaGroupId);
            documentGroups.delete(mediaGroupId);
            
            if (groupData && groupData.documents.length > 0) {
              await processDocumentAlbum(groupData.chatId, groupData.documents);
            }
          }, MEDIA_GROUP_TIMEOUT);

        } else {
          // Single document
          const statusMsg = await bot.sendMessage(chatId, '🔍 *Анализирую скриншот...*', { parse_mode: 'Markdown' });

          const file = await bot.getFile(doc.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
          const fileBuffer = await downloadFile(fileUrl);

          const ext = file.file_path.split('.').pop() || 'jpg';
          const fileName = `${uuidv4()}.${ext}`;

          await processImage(chatId, fileBuffer, fileName, doc.mime_type, statusMsg.message_id);
        }

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
