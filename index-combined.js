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

  const prompt = `You are an expert at identifying Russian e-commerce marketplace screenshots.

TASK: Identify the marketplace name and page type from this screenshot.

=== CRITICAL: TEXT ON IMAGES ===
IMPORTANT: The screenshot may contain TEXT MENTIONING marketplace names!
Look carefully for ANY text that says:
- "Ozon", "OZON", "Озон"
- "Wildberries", "WB", "Вайлдберриз"  
- "AliExpress", "Али", "Алиэкспресс"
- "Яндекс Маркет", "Yandex Market"
- "Мегамаркет", "СберМегаМаркет", "Сбер"
- "Lamoda", "LAMODA", "Ламода"
- "Avito", "Авито"
- "Золотое Яблоко", "Золотое яблоко"
- "SHEIN", "Shein"
- "Lazada"
- "KazanExpress", "Казань Экспресс"

If the image shows a comparison chart, review, or article MENTIONING a marketplace - that IS the marketplace!

=== ACTIVE TAB / NAVIGATION ===
Look for ACTIVE/SELECTED tabs in the interface:
- Bottom navigation bar with highlighted icon
- Top tabs with underline or bold text
- Sidebar with selected menu item

Active tab indicates the PAGE TYPE:
- "Главная" / Home icon = Главная
- "Каталог" / Grid icon = Каталог  
- "Корзина" / Cart icon = Корзина
- "Избранное" / Heart icon = Избранное
- "Профиль" / Person icon = Профиль
- "Заказы" / Box icon = Заказы

=== MARKETPLACE VISUAL SIGNATURES ===

**OZON** (Озон):
- Blue interface (#005BFF)
- "OZON" logo, blue buttons
- "Ozon fresh", "Ozon Express" badges

**WILDBERRIES** (Вайлдберриз):
- Purple/magenta (#CB11AB)
- "Wildberries" or "WB" logo
- Purple/pink interface

**ALIEXPRESS** (АлиЭкспресс):
- Red/orange (#FF4747)
- "AliExpress" text
- Chinese products, long delivery

**ЯНДЕКС МАРКЕТ**:
- Yellow (#FFCC00)
- "Яндекс" or "Маркет" text
- Red Y logo

**МЕГАМАРКЕТ**:
- Green (#21A038 Sber green)
- "Мегамаркет" text

**LAMODA**:
- Black/white minimalist
- "LAMODA" text
- Fashion focus

**AVITO**:
- Green/teal
- "Avito" logo
- Classifieds style

**ЗОЛОТОЕ ЯБЛОКО**:
- Green/gold colors
- Beauty/cosmetics focus
- "Золотое Яблоко" text

**SHEIN**:
- Black/white with orange accents
- "SHEIN" text
- Fast fashion

=== PAGE TYPES ===
- Главная (home page, banners, recommendations)
- Каталог (product grid/list, category)
- Карточка товара (single product page)
- Корзина (shopping cart)
- Поиск (search results)
- Избранное (favorites/wishlist)
- Заказы (order history)
- Профиль (account/profile)
- Акции (promotions/sales)
- Отзывы (reviews)

=== RESPONSE ===
JSON only, no markdown:
{"marketplace": "NAME", "page": "PAGE_TYPE", "description": "описание на русском", "confidence": true}

RULES:
1. TEXT ON IMAGE mentioning marketplace = USE THAT MARKETPLACE
2. Active tab = page type indicator
3. Color scheme = marketplace indicator
4. Set confidence: true if you identify marketplace`;

  // Try different API endpoints - using available models
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'];
  
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
            const lower = marketplace.toLowerCase();
            if (lower.includes('aliexpress') || lower.includes('ali express') || lower.includes('алиэкспресс')) {
              marketplace = 'AliExpress';
            } else if (lower.includes('ozon') || lower.includes('озон')) {
              marketplace = 'Ozon';
            } else if (lower.includes('wildberries') || lower === 'wb' || lower.includes('вайлдберриз')) {
              marketplace = 'Wildberries';
            } else if (lower.includes('яндекс') || lower.includes('yandex') || lower.includes('маркет')) {
              marketplace = 'Яндекс Маркет';
            } else if (lower.includes('мегамаркет') || lower.includes('сбер')) {
              marketplace = 'Мегамаркет';
            } else if (lower.includes('lamoda') || lower.includes('ламода')) {
              marketplace = 'Lamoda';
            } else if (lower.includes('avito') || lower.includes('авито')) {
              marketplace = 'Avito';
            } else if (lower.includes('amazon') || lower.includes('амазон')) {
              marketplace = 'Amazon';
            }
          }
          
          // Also normalize page names
          let page = parsed.page;
          if (page) {
            page = page.trim();
            const lowerPage = page.toLowerCase();
            if (lowerPage.includes('главн') || lowerPage.includes('home') || lowerPage.includes('main')) {
              page = 'Главная';
            } else if (lowerPage.includes('каталог') || lowerPage.includes('catalog') || lowerPage.includes('category')) {
              page = 'Каталог';
            } else if (lowerPage.includes('карточ') || lowerPage.includes('товар') || lowerPage.includes('product') || lowerPage.includes('detail')) {
              page = 'Карточка товара';
            } else if (lowerPage.includes('корзин') || lowerPage.includes('cart')) {
              page = 'Корзина';
            } else if (lowerPage.includes('поиск') || lowerPage.includes('search')) {
              page = 'Поиск';
            } else if (lowerPage.includes('избран') || lowerPage.includes('favorite') || lowerPage.includes('wish')) {
              page = 'Избранное';
            } else if (lowerPage.includes('заказ') || lowerPage.includes('order')) {
              page = 'Заказы';
            } else if (lowerPage.includes('профил') || lowerPage.includes('account') || lowerPage.includes('profile')) {
              page = 'Профиль';
            }
          }
          
          return {
            marketplace: marketplace || null,
            page: page || null,
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
        limit: 1000,
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
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
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

// Normalize all marketplace names to unified format
app.post('/api/normalize-marketplaces', async (req, res) => {
  try {
    const normalizeMap = {
      // Lamoda variations
      'lamoda': 'Lamoda',
      'LAMODA': 'Lamoda',
      'ламода': 'Lamoda',
      'Ламода': 'Lamoda',
      
      // Megamarket variations
      'мегамаркет': 'Мегамаркет',
      'МегаМаркет': 'Мегамаркет',
      'сбермегамаркет': 'Мегамаркет',
      'СберМегаМаркет': 'Мегамаркет',
      'Сбермегамаркет': 'Мегамаркет',
      'SberMegaMarket': 'Мегамаркет',
      
      // Yandex Market variations
      'яндекс.маркет': 'Яндекс Маркет',
      'Яндекс.Маркет': 'Яндекс Маркет',
      'яндекс маркет': 'Яндекс Маркет',
      'Yandex Market': 'Яндекс Маркет',
      'Yandex.Market': 'Яндекс Маркет',
      
      // Ozon variations
      'ozon': 'Ozon',
      'OZON': 'Ozon',
      'озон': 'Ozon',
      'Озон': 'Ozon',
      
      // Wildberries variations
      'wildberries': 'Wildberries',
      'WILDBERRIES': 'Wildberries',
      'WB': 'Wildberries',
      'wb': 'Wildberries',
      'вайлдберриз': 'Wildberries',
      'Вайлдберриз': 'Wildberries',
      
      // AliExpress variations
      'aliexpress': 'AliExpress',
      'ALIEXPRESS': 'AliExpress',
      'Ali Express': 'AliExpress',
      'алиэкспресс': 'AliExpress',
      'Алиэкспресс': 'AliExpress',
      
      // Avito variations
      'avito': 'Avito',
      'AVITO': 'Avito',
      'авито': 'Avito',
      'Авито': 'Avito',
      
      // Amazon variations
      'amazon': 'Amazon',
      'AMAZON': 'Amazon',
      'амазон': 'Amazon',
      'Амазон': 'Amazon',
      
      // SHEIN variations
      'shein': 'SHEIN',
      'Shein': 'SHEIN',
      'шейн': 'SHEIN',
      'Шейн': 'SHEIN',
    };
    
    let updated = 0;
    const changes = [];
    
    for (const [id, meta] of imageMetadata.entries()) {
      let changed = false;
      const oldMp = meta.marketplace;
      
      // Check if marketplace needs normalization
      if (oldMp && normalizeMap[oldMp]) {
        meta.marketplace = normalizeMap[oldMp];
        changed = true;
      }
      
      if (changed) {
        imageMetadata.set(id, meta);
        changes.push({ id, from: oldMp, to: meta.marketplace });
        updated++;
      }
    }
    
    if (updated > 0) {
      await saveMetadata();
    }
    
    res.json({
      success: true,
      message: `Normalized ${updated} marketplace names`,
      changes
    });
    
  } catch (error) {
    console.error('Normalize error:', error);
    res.status(500).json({ error: 'Normalization failed', details: error.message });
  }
});

// Compare unrecognized image with known examples
async function analyzeByComparison(unknownBuffer, examples) {
  if (!GEMINI_API_KEY) {
    return null;
  }

  // Build prompt with examples
  let prompt = `You are analyzing e-commerce marketplace screenshots.

I will show you ONE UNKNOWN screenshot and SEVERAL EXAMPLE screenshots from known marketplaces.
Your task: Determine which marketplace the UNKNOWN screenshot belongs to by comparing visual style, colors, layout, and UI elements.

=== KNOWN EXAMPLES ===
`;

  // Add example descriptions
  examples.forEach((ex, i) => {
    prompt += `\nExample ${i + 1}: ${ex.marketplace} - ${ex.page}`;
  });

  prompt += `

=== YOUR TASK ===
The FIRST image is the UNKNOWN screenshot.
The following images are EXAMPLES from known marketplaces.

Compare the UNKNOWN image with the examples and determine:
1. Which marketplace does the UNKNOWN image belong to? (based on visual similarity: colors, layout, UI style, fonts, icons)
2. What page type is it?

Look for:
- Similar color schemes (blue=Ozon, purple=Wildberries, green=Мегамаркет/Avito, yellow=Яндекс, red/orange=AliExpress)
- Similar UI layouts and button styles
- Similar navigation patterns
- Similar product card designs
- ANY text mentioning marketplace name

Respond ONLY with JSON:
{"marketplace": "NAME", "page": "PAGE_TYPE", "confidence": true, "reason": "brief explanation"}

If you cannot determine, set confidence: false.`;

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  // Build parts array with all images
  const parts = [{ text: prompt }];
  
  // First add unknown image
  parts.push({
    inline_data: {
      mime_type: 'image/jpeg',
      data: unknownBuffer.toString('base64')
    }
  });
  
  // Then add example images
  for (const ex of examples) {
    if (ex.buffer) {
      parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: ex.buffer.toString('base64')
        }
      });
    }
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }]
      })
    });

    const data = await response.json();
    
    if (data.error) {
      console.log('Comparison error:', data.error.message);
      return null;
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    console.log('Comparison result:', text);

    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.confidence) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Comparison error:', err.message);
  }
  
  return null;
}

// Download image helper
async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

// Analyze one unrecognized image by comparing with known examples
app.post('/api/analyze-by-comparison', async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(400).json({ error: 'GEMINI_API_KEY not configured' });
    }

    // Get all images
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list('images', { limit: 1000 });

    if (error) {
      return res.status(500).json({ error: 'Failed to list images' });
    }

    const images = files.filter(f => f.name !== '.emptyFolderPlaceholder');

    // Find unrecognized images (exclude already checked ones)
    const unrecognized = images.filter(img => {
      const meta = imageMetadata.get(img.name);
      if (!meta) return true;
      const mp = (meta.marketplace || '').toLowerCase();
      // Include: не указан, не определён, empty, ai: prefix
      // Exclude: требует проверки, сравнение: (already checked)
      if (mp === 'требует проверки' || mp.startsWith('сравнение:')) return false;
      return mp === 'не указан' || mp === 'не определён' || mp === 'не определен' || mp === '' || mp.startsWith('ai:');
    });

    if (unrecognized.length === 0) {
      return res.json({ success: true, message: 'No unrecognized images', remaining: 0 });
    }

    // Find recognized images as examples (one per marketplace)
    const marketplaces = ['Ozon', 'Wildberries', 'AliExpress', 'Яндекс Маркет', 'Мегамаркет', 'Lamoda', 'Avito', 'Золотое Яблоко', 'SHEIN'];
    const examples = [];

    for (const mp of marketplaces) {
      const example = images.find(img => {
        const meta = imageMetadata.get(img.name);
        return meta && meta.marketplace === mp;
      });
      
      if (example) {
        const { data: urlData } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(`images/${example.name}`);
        
        try {
          const buffer = await downloadImage(urlData.publicUrl);
          const meta = imageMetadata.get(example.name);
          examples.push({
            marketplace: mp,
            page: meta.page,
            buffer
          });
          console.log(`Loaded example for ${mp}`);
        } catch (e) {
          console.log(`Failed to load example for ${mp}`);
        }
      }
    }

    if (examples.length === 0) {
      return res.json({ success: false, error: 'No recognized examples available' });
    }

    console.log(`Using ${examples.length} examples for comparison`);

    // Take first unrecognized image
    const unknown = unrecognized[0];
    const { data: unknownUrl } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(`images/${unknown.name}`);

    console.log(`Analyzing: ${unknown.name}`);
    
    const unknownBuffer = await downloadImage(unknownUrl.publicUrl);
    
    // Compare with examples
    const result = await analyzeByComparison(unknownBuffer, examples);

    if (result && result.marketplace) {
      // Normalize marketplace name
      let mp = result.marketplace;
      const lower = mp.toLowerCase();
      if (lower.includes('ozon') || lower.includes('озон')) mp = 'Ozon';
      else if (lower.includes('wildberries') || lower === 'wb') mp = 'Wildberries';
      else if (lower.includes('ali')) mp = 'AliExpress';
      else if (lower.includes('яндекс') || lower.includes('маркет')) mp = 'Яндекс Маркет';
      else if (lower.includes('мегамаркет') || lower.includes('сбер')) mp = 'Мегамаркет';
      else if (lower.includes('lamoda')) mp = 'Lamoda';
      else if (lower.includes('avito')) mp = 'Avito';
      else if (lower.includes('золот')) mp = 'Золотое Яблоко';
      else if (lower.includes('shein')) mp = 'SHEIN';

      // Update metadata
      const existingMeta = imageMetadata.get(unknown.name) || {};
      imageMetadata.set(unknown.name, {
        ...existingMeta,
        marketplace: mp,
        page: result.page || existingMeta.page
      });
      await saveMetadata();

      return res.json({
        success: true,
        id: unknown.name,
        marketplace: mp,
        page: result.page,
        reason: result.reason,
        remaining: unrecognized.length - 1
      });
    } else {
      // Mark as checked so we don't retry - use prefix that won't be picked up again
      const existingMeta = imageMetadata.get(unknown.name) || {};
      imageMetadata.set(unknown.name, {
        ...existingMeta,
        marketplace: 'Требует проверки',
        page: existingMeta.page || 'Не указана'
      });
      await saveMetadata();
      
      return res.json({
        success: false,
        id: unknown.name,
        error: 'Could not determine by comparison - marked for manual review',
        remaining: unrecognized.length - 1
      });
    }

  } catch (error) {
    console.error('Comparison analysis error:', error);
    res.status(500).json({ error: 'Analysis failed', details: error.message });
  }
});

// Reset "AI: не определён" marks for re-analysis
app.post('/api/reset-unrecognized', async (req, res) => {
  try {
    let reset = 0;
    const resetIds = [];
    
    for (const [id, meta] of imageMetadata.entries()) {
      // Reset AI:, Сравнение:, and Требует проверки
      const mp = meta.marketplace || '';
      if (mp.startsWith('AI:') || mp.startsWith('Сравнение:') || mp === 'Требует проверки') {
        meta.marketplace = 'Не определён';
        meta.page = 'Не определена';
        imageMetadata.set(id, meta);
        resetIds.push(id);
        reset++;
      }
    }
    
    if (reset > 0) {
      await saveMetadata();
    }
    
    res.json({
      success: true,
      message: `Reset ${reset} images for re-analysis`,
      count: reset
    });
    
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ error: 'Reset failed', details: error.message });
  }
});

// Analyze ONE image with missing metadata
app.post('/api/analyze-one', async (req, res) => {
  try {
    // Check if Gemini is configured
    if (!GEMINI_API_KEY) {
      return res.status(400).json({ error: 'GEMINI_API_KEY not configured' });
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
      return res.json({ success: true, message: 'All images have valid metadata', remaining: 0 });
    }
    
    // Take only first image
    const img = toAnalyze[0];
    console.log(`Analyzing image: ${img.name} (${toAnalyze.length} remaining)`);
    
    try {
      // Get public URL
      const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(`images/${img.name}`);
      
      console.log(`Downloading: ${urlData.publicUrl}`);
      
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
      
      console.log(`Downloaded ${imageBuffer.length} bytes, analyzing...`);
      
      // Analyze with AI
      const analysis = await analyzeScreenshot(imageBuffer);
      
      console.log('Analysis result:', analysis);
      
      if (analysis && analysis.marketplace) {
        // Normalize marketplace name
        let normalizedMp = analysis.marketplace;
        const lower = normalizedMp.toLowerCase();
        
        if (lower.includes('мегамаркет') || lower.includes('сбер')) {
          normalizedMp = 'Мегамаркет';
        } else if (lower.includes('яндекс') && lower.includes('маркет')) {
          normalizedMp = 'Яндекс Маркет';
        } else if (lower.includes('ozon') || lower === 'озон') {
          normalizedMp = 'Ozon';
        } else if (lower.includes('wildberries') || lower === 'wb') {
          normalizedMp = 'Wildberries';
        } else if (lower.includes('aliexpress') || lower.includes('али')) {
          normalizedMp = 'AliExpress';
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
        await saveMetadata();
        
        return res.json({
          success: true,
          id: img.name,
          marketplace: normalizedMp,
          page: analysis.page,
          remaining: toAnalyze.length - 1
        });
      } else {
        // Mark as analyzed but unknown so we don't retry
        const existingMeta = imageMetadata.get(img.name) || {};
        const newMeta = {
          marketplace: 'AI: не определён',
          page: 'AI: не определена',
          date: existingMeta.date || new Date().toISOString().split('T')[0],
          description: existingMeta.description || ''
        };
        imageMetadata.set(img.name, newMeta);
        await saveMetadata();
        
        return res.json({
          success: false,
          id: img.name,
          error: 'AI could not analyze image - marked as checked',
          remaining: toAnalyze.length - 1
        });
      }
      
    } catch (err) {
      console.error(`Error analyzing ${img.name}:`, err.message);
      return res.json({
        success: false,
        id: img.name,
        error: err.message,
        remaining: toAnalyze.length - 1
      });
    }
    
  } catch (error) {
    console.error('Analyze one error:', error);
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
