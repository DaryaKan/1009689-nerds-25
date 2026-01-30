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
const Tesseract = require('tesseract.js');
const puppeteer = require('puppeteer-core');

// Initialize Gemini AI
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Backup Gemini API key (second Google account)
const GEMINI_API_KEY_BACKUP = process.env.GEMINI_API_KEY_BACKUP || 'AIzaSyBN02W3NWHCM6avgt1BHiZLE7T9atLqBfQ';

// Initialize OpenRouter AI (backup)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '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';

// Initialize Anthropic Claude API
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
let anthropic = null;
if (ANTHROPIC_API_KEY) {
  const Anthropic = require('@anthropic-ai/sdk');
  anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  console.log('Claude API configured');
}

if (GEMINI_API_KEY) {
  console.log('Gemini API key configured');
}

// Claude Opus 4.5 for general questions and chat
async function askClaude(query, context = null, images = []) {
  if (!anthropic) {
    console.log('Claude API not configured, falling back to Gemini');
    return null;
  }

  try {
    console.log('Asking Claude Opus 4.5:', query.substring(0, 100));
    
    const systemPrompt = `Ты - AI ассистент по UX/UI дизайну и e-commerce. Ты помогаешь анализировать скриншоты мобильных приложений маркетплейсов и отвечаешь на вопросы о дизайне, UX, трендах и лучших практиках.

Ты можешь:
- Анализировать UX/UI скриншотов
- Сравнивать дизайн разных маркетплейсов
- Отвечать на вопросы о трендах в e-commerce дизайне
- Давать рекомендации по улучшению UX
- Обсуждать лучшие практики в мобильном дизайне

Отвечай кратко и по делу. Используй структурированные ответы с заголовками и списками когда это уместно.`;

    const messages = [];
    
    // Build content array
    const content = [];
    
    // Add images if provided
    if (images && images.length > 0) {
      for (const img of images) {
        if (img.base64 && img.mediaType) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mediaType,
              data: img.base64
            }
          });
        }
      }
    }
    
    // Add context if provided
    let textContent = query;
    if (context) {
      textContent = `${context}\n\nВопрос: ${query}`;
    }
    
    content.push({ type: 'text', text: textContent });
    
    messages.push({ role: 'user', content });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages
    });

    const answer = response.content[0]?.text || '';
    console.log('Claude response received, length:', answer.length);
    return answer;

  } catch (error) {
    console.error('Claude API error:', error.message);
    return null;
  }
}

// Determine if query is about screenshots/comparison or general question
function isScreenshotQuery(query) {
  const queryLower = query.toLowerCase();
  
  // Keywords that REQUIRE screenshots (action words)
  const actionKeywords = [
    'сравни скриншот', 'сравни страниц', 'сравни корзин', 'сравни главн', 'сравни карточк',
    'проанализируй ux', 'проанализируй ui', 'проанализируй интерфейс', 'проанализируй дизайн',
    'покажи скриншот', 'покажи страниц', 'покажи интерфейс',
    'на скриншот', 'на картинк', 'на изображен',
    'анализ скриншот', 'анализ интерфейс'
  ];
  
  // Check for action keywords first (these definitely need screenshots)
  if (actionKeywords.some(kw => queryLower.includes(kw))) {
    return true;
  }
  
  // Keywords that suggest screenshot analysis when combined with marketplace names
  const analysisWords = ['сравни', 'проанализируй', 'покажи', 'анализ'];
  const pageWords = ['корзин', 'каталог', 'карточк', 'профил', 'главн', 'страниц', 'экран', 'интерфейс'];
  
  const hasAnalysisWord = analysisWords.some(w => queryLower.includes(w));
  const hasPageWord = pageWords.some(w => queryLower.includes(w));
  
  // If has analysis word AND page word - needs screenshots
  if (hasAnalysisWord && hasPageWord) {
    return true;
  }
  
  // Otherwise, treat as general question (even if mentions marketplace names)
  return false;
}

// Pipeline function: Run ALL stages, then choose best result
async function analyzeScreenshotPipeline(imageBuffer) {
  console.log('=== Starting full analysis pipeline (all stages) ===');
  
  const results = [];
  
  // Stage 1: OCR-based local analysis (no AI)
  console.log('Stage 1: OCR analysis...');
  try {
    const ocrResult = await analyzeWithOCR(imageBuffer);
    if (ocrResult.marketplace && ocrResult.confidence) {
      results.push({ 
        stage: 'OCR', 
        priority: 1,
        ...ocrResult 
      });
      console.log(`Stage 1 result: ${ocrResult.marketplace}`);
    } else {
      console.log('Stage 1: No match');
    }
  } catch (err) {
    console.log('Stage 1 error:', err.message);
  }
  
  // Stage 2: AI analysis by visual features (logos, colors, UI)
  console.log('Stage 2: AI visual analysis...');
  try {
    const aiResult = await analyzeScreenshot(imageBuffer);
    if (aiResult.marketplace && aiResult.confidence) {
      results.push({ 
        stage: 'AI Visual', 
        priority: 2,
        ...aiResult 
      });
      console.log(`Stage 2 result: ${aiResult.marketplace}`);
    } else {
      console.log('Stage 2: No confident match');
    }
  } catch (err) {
    console.log('Stage 2 error:', err.message);
  }
  
  // Stage 3: AI comparison with known examples
  console.log('Stage 3: AI comparison analysis...');
  try {
    const comparisonResult = await analyzeByComparisonInternal(imageBuffer);
    if (comparisonResult.marketplace && comparisonResult.confidence) {
      results.push({ 
        stage: 'Comparison', 
        priority: 3,
        ...comparisonResult 
      });
      console.log(`Stage 3 result: ${comparisonResult.marketplace}`);
    } else {
      console.log('Stage 3: No match');
    }
  } catch (err) {
    console.log('Stage 3 error:', err.message);
  }
  
  // Stage 4: Backup Gemini API (second account)
  console.log('Stage 4: Backup Gemini AI analysis...');
  try {
    const backupResult = await analyzeWithBackupGemini(imageBuffer);
    if (backupResult.marketplace && backupResult.confidence) {
      results.push({ 
        stage: 'Backup AI', 
        priority: 4,
        ...backupResult 
      });
      console.log(`Stage 4 result: ${backupResult.marketplace}`);
    } else {
      console.log('Stage 4: No match');
    }
  } catch (err) {
    console.log('Stage 4 error:', err.message);
  }
  
  console.log(`=== All stages complete. Results: ${results.length} ===`);
  
  // No results from any stage
  if (results.length === 0) {
    console.log('Pipeline: No marketplace identified by any method');
    return { 
      marketplace: null, 
      page: null, 
      description: 'Не удалось определить', 
      confidence: false,
      allResults: []
    };
  }
  
  // If only one result, use it
  if (results.length === 1) {
    const r = results[0];
    console.log(`Pipeline: Single result from ${r.stage}: ${r.marketplace}`);
    return {
      marketplace: r.marketplace,
      page: r.page,
      description: `${r.stage}: ${r.marketplace}`,
      confidence: true,
      allResults: results
    };
  }
  
  // Multiple results - find consensus or use priority
  const marketplaceCounts = {};
  const pageCounts = {};
  
  for (const r of results) {
    const mp = r.marketplace;
    const pg = r.page;
    
    if (mp) {
      marketplaceCounts[mp] = (marketplaceCounts[mp] || 0) + 1;
    }
    if (pg) {
      pageCounts[pg] = (pageCounts[pg] || 0) + 1;
    }
  }
  
  // Find marketplace with most votes
  let bestMarketplace = null;
  let maxMpVotes = 0;
  for (const [mp, count] of Object.entries(marketplaceCounts)) {
    if (count > maxMpVotes) {
      maxMpVotes = count;
      bestMarketplace = mp;
    }
  }
  
  // Find page with most votes
  let bestPage = null;
  let maxPgVotes = 0;
  for (const [pg, count] of Object.entries(pageCounts)) {
    if (count > maxPgVotes) {
      maxPgVotes = count;
      bestPage = pg;
    }
  }
  
  // Build description showing consensus
  const stagesAgreed = results.filter(r => r.marketplace === bestMarketplace).map(r => r.stage);
  const description = maxMpVotes > 1 
    ? `Консенсус (${stagesAgreed.join(', ')}): ${bestMarketplace}`
    : `${results[0].stage}: ${bestMarketplace}`;
  
  console.log(`Pipeline result: ${bestMarketplace} (${maxMpVotes}/${results.length} votes)`);
  console.log(`Page result: ${bestPage} (${maxPgVotes}/${results.length} votes)`);
  
  return {
    marketplace: bestMarketplace,
    page: bestPage,
    description: description,
    confidence: true,
    votes: { marketplace: maxMpVotes, page: maxPgVotes, total: results.length },
    allResults: results
  };
}

// Fuzzy match function - check if pattern is similar to text
function fuzzyMatch(text, pattern, threshold = 0.6) {
  if (text.includes(pattern)) return true;
  
  // Check if at least 60% of pattern chars are in sequence in text
  let matchCount = 0;
  let textIdx = 0;
  
  for (const char of pattern) {
    const idx = text.indexOf(char, textIdx);
    if (idx !== -1) {
      matchCount++;
      textIdx = idx + 1;
    }
  }
  
  return matchCount / pattern.length >= threshold;
}

// Stage 1: OCR-based analysis (local, no AI)
async function analyzeWithOCR(imageBuffer) {
  try {
    const result = await Tesseract.recognize(imageBuffer, 'rus+eng', {
      logger: m => {}
    });
    
    let text = result.data.text.toLowerCase();
    text = text.replace(/\s+/g, ' ');
    const textNoSpaces = text.replace(/\s/g, '');
    
    console.log('OCR text (150 chars):', text.substring(0, 150));
    
    // Extended marketplace patterns - ORDER MATTERS! More specific patterns first
    const marketplacePatterns = [
      // AliExpress - check first, has many variations
      { patterns: ['aliexpress', 'aliexpres', 'алиэкспресс', 'алиэкспрес', 'ali express', 'a]iexpress', 'allexpress', 'tmall', 'найти на aliexpress', 'на aliexpress', 'aiexpress', 'a1iexpress', 'al1express', 'программа лояльности ali'], mp: 'AliExpress' },
      
      // Wildberries  
      { patterns: ['wildberries', 'wildberry', 'вайлдберриз', 'вайлдберри', 'вайлдбери', 'wbberries', 'коледино wb', 'коледино'], mp: 'Wildberries' },
      
      // Ozon
      { patterns: ['ozon', 'озон', 'o3on', 'oz0n', '0zon'], mp: 'Ozon' },
      
      // Яндекс Маркет
      { patterns: ['яндекс маркет', 'яндексмаркет', 'yandex market', 'я.маркет', 'яндекс'], mp: 'Яндекс Маркет' },
      
      // Мегамаркет
      { patterns: ['мегамаркет', 'megamarket', 'сбермегамаркет', 'мега маркет', 'сбермега'], mp: 'Мегамаркет' },
      
      // Lamoda
      { patterns: ['lamoda', 'ламода', 'la moda', 'лямода', '1amoda'], mp: 'Lamoda' },
      
      // Avito
      { patterns: ['avito', 'авито', 'avit0', 'av1to'], mp: 'Avito' },
      
      // SHEIN
      { patterns: ['shein', 'shеin', 'she1n', 'шеин'], mp: 'SHEIN' },
      
      // Золотое Яблоко - more specific patterns only
      { patterns: ['золотое яблоко', 'золотоеяблоко', 'золотоея', 'олотоея', 'goldapple', 'gold apple'], mp: 'Золотое Яблоко' },
      
      // ВкусВилл
      { patterns: ['вкусвилл', 'vkusvill', 'вкусвил'], mp: 'ВкусВилл' },
      
      // Lazada
      { patterns: ['lazada', '1azada'], mp: 'Lazada' },
      
      // Amazon
      { patterns: ['amazon', 'амазон'], mp: 'Amazon' }
    ];
    
    // Page keywords
    const pageKeywords = {
      'главная': 'Главная', 'home': 'Главная',
      'каталог': 'Каталог', 'catalog': 'Каталог', 'категории': 'Каталог',
      'корзина': 'Корзина', 'cart': 'Корзина',
      'профиль': 'Профиль', 'profile': 'Профиль', 'аккаунт': 'Профиль',
      'заказы': 'Заказы', 'orders': 'Заказы',
      'избранное': 'Избранное', 'favorites': 'Избранное'
    };
    
    // Find marketplace using patterns - exact matching only for reliability
    let foundMarketplace = null;
    
    for (const { patterns, mp } of marketplacePatterns) {
      for (const pattern of patterns) {
        // Check in text with spaces and without
        if (text.includes(pattern) || textNoSpaces.includes(pattern.replace(/\s/g, ''))) {
          foundMarketplace = mp;
          console.log(`OCR match: "${pattern}" -> ${mp}`);
          break;
        }
      }
      if (foundMarketplace) break;
    }
    
    // If no match, try fuzzy matching for specific long patterns only
    if (!foundMarketplace) {
      const fuzzyPatterns = [
        { pattern: 'aliexpress', mp: 'AliExpress' },
        { pattern: 'wildberries', mp: 'Wildberries' },
        { pattern: 'золотоеяблоко', mp: 'Золотое Яблоко' },
        { pattern: 'мегамаркет', mp: 'Мегамаркет' }
      ];
      
      for (const { pattern, mp } of fuzzyPatterns) {
        if (fuzzyMatch(textNoSpaces, pattern, 0.75)) {
          foundMarketplace = mp;
          console.log(`OCR fuzzy match: "${pattern}" -> ${mp}`);
          break;
        }
      }
    }
    
    // Find page
    let foundPage = null;
    for (const [kw, pg] of Object.entries(pageKeywords)) {
      if (text.includes(kw)) {
        foundPage = pg;
        break;
      }
    }
    
    if (foundMarketplace) {
      return { marketplace: foundMarketplace, page: foundPage, description: 'OCR detected', confidence: true };
    }
    
    return { marketplace: null, page: null, description: '', confidence: false };
    
  } catch (err) {
    console.error('OCR error:', err.message);
    return { marketplace: null, page: null, description: '', confidence: false };
  }
}

// Stage 3: Comparison with known examples (internal function)
async function analyzeByComparisonInternal(unknownBuffer) {
  if (!GEMINI_API_KEY) {
    return { marketplace: null, page: null, description: '', confidence: false };
  }
  
  try {
    // Get example images from storage
    const { data: files } = await supabase.storage.from(BUCKET).list('images', { limit: 100 });
    if (!files) return { marketplace: null, page: null, description: '', confidence: false };
    
    // Find examples (one per marketplace)
    const marketplaces = ['Ozon', 'Wildberries', 'AliExpress', 'Яндекс Маркет', 'Мегамаркет', 'Lamoda', 'Avito', 'Золотое Яблоко', 'SHEIN'];
    const examples = [];
    
    for (const mp of marketplaces) {
      const example = files.find(f => {
        const meta = imageMetadata.get(f.name);
        return meta && meta.marketplace === mp;
      });
      
      if (example && examples.length < 3) { // Limit to 3 examples to save quota
        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(`images/${example.name}`);
        try {
          const buffer = await new Promise((resolve, reject) => {
            const protocol = urlData.publicUrl.startsWith('https') ? https : http;
            protocol.get(urlData.publicUrl, (response) => {
              const chunks = [];
              response.on('data', (chunk) => chunks.push(chunk));
              response.on('end', () => resolve(Buffer.concat(chunks)));
              response.on('error', reject);
            }).on('error', reject);
          });
          
          examples.push({ marketplace: mp, page: imageMetadata.get(example.name)?.page, buffer });
        } catch (e) {
          // Skip failed downloads
        }
      }
    }
    
    if (examples.length === 0) {
      return { marketplace: null, page: null, description: '', confidence: false };
    }
    
    // Build comparison prompt
    const prompt = `Compare the FIRST image (unknown) with the following example images.
Examples: ${examples.map((e, i) => `Image ${i+2}: ${e.marketplace}`).join(', ')}

Which marketplace does the first image belong to based on visual similarity (colors, layout, UI style)?
Respond with JSON only: {"marketplace": "NAME", "page": "PAGE_TYPE", "confidence": true}
If unsure, set confidence: false.`;

    const model = 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    
    const parts = [{ text: prompt }];
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: unknownBuffer.toString('base64') } });
    for (const ex of examples) {
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: ex.buffer.toString('base64') } });
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] })
    });
    
    const data = await response.json();
    if (data.error) {
      console.log('Comparison API error:', data.error.message);
      return { marketplace: null, page: null, description: '', confidence: false };
    }
    
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { marketplace: null, page: null, description: '', confidence: false };
    
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.confidence) {
        return { 
          marketplace: parsed.marketplace, 
          page: parsed.page, 
          description: 'Comparison match', 
          confidence: true 
        };
      }
    }
    
    return { marketplace: null, page: null, description: '', confidence: false };
    
  } catch (err) {
    console.error('Comparison error:', err.message);
    return { marketplace: null, page: null, description: '', confidence: false };
  }
}

// Stage 4: Analyze with backup Gemini API key
async function analyzeWithBackupGemini(imageBuffer) {
  if (!GEMINI_API_KEY_BACKUP) {
    return { marketplace: null, page: null, description: '', confidence: false };
  }

  const prompt = `Analyze this screenshot of a Russian e-commerce marketplace app.

Identify:
1. MARKETPLACE - look for: Ozon (blue), Wildberries (purple), AliExpress (red/orange), Яндекс Маркет (yellow), Мегамаркет (green), Lamoda (black/white), Avito (green), SHEIN, Золотое Яблоко (yellow-green)

2. PAGE TYPE - one of: Главная, Каталог, Карточка товара, Корзина, Профиль, Заказы, Избранное, Поиск

Respond with JSON only:
{"marketplace": "NAME", "page": "PAGE_TYPE", "confidence": true}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY_BACKUP}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: imageBuffer.toString('base64') } }
          ]
        }]
      })
    });

    const data = await response.json();
    
    if (data.error) {
      console.log('Backup Gemini error:', data.error.message);
      return { marketplace: null, page: null, description: '', confidence: false };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.log('Backup Gemini: No response text');
      return { marketplace: null, page: null, description: '', confidence: false };
    }

    console.log('Backup Gemini response:', text.substring(0, 200));

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.confidence && parsed.marketplace) {
        // Normalize marketplace name
        let mp = parsed.marketplace;
        const lower = mp.toLowerCase();
        if (lower.includes('ozon') || lower.includes('озон')) mp = 'Ozon';
        else if (lower.includes('wildberries') || lower.includes('wb')) mp = 'Wildberries';
        else if (lower.includes('ali')) mp = 'AliExpress';
        else if (lower.includes('яндекс') || lower.includes('маркет')) mp = 'Яндекс Маркет';
        else if (lower.includes('мегамаркет') || lower.includes('сбер')) mp = 'Мегамаркет';
        else if (lower.includes('lamoda') || lower.includes('ламода')) mp = 'Lamoda';
        else if (lower.includes('avito') || lower.includes('авито')) mp = 'Avito';
        else if (lower.includes('shein')) mp = 'SHEIN';
        else if (lower.includes('золот') || lower.includes('яблок')) mp = 'Золотое Яблоко';
        
        return {
          marketplace: mp,
          page: parsed.page || null,
          description: 'Backup Gemini detected',
          confidence: true
        };
      }
    }

    return { marketplace: null, page: null, description: '', confidence: false };

  } catch (err) {
    console.error('Backup Gemini error:', err.message);
    return { marketplace: null, page: null, description: '', confidence: false };
  }
}

// Function to analyze ONLY page type (not marketplace)
async function analyzePageOnly(imageBuffer) {
  if (!GEMINI_API_KEY_BACKUP) {
    return { page: null, confidence: false };
  }

  const prompt = `Look at this mobile app screenshot and tell me what PAGE/SCREEN is shown.

Pick ONE from this list based on what you see:
- "Главная" - home screen with banners, recommendations, promotions
- "Каталог" - product listings, multiple products in grid/list
- "Карточка товара" - single product detail page with price, description, buy button
- "Корзина" - shopping cart showing items to buy
- "Профиль" - user profile, account settings, personal info
- "Заказы" - order history, order tracking, delivery status
- "Избранное" - favorites, wishlist, saved items with hearts
- "Поиск" - search results or search bar focused
- "Акции" - promotions, sales, discount banners
- "Уведомления" - notifications list

Look at:
1. Bottom navigation - which tab is highlighted?
2. Screen title at top
3. Main content area

Always try to pick the BEST match. If showing products in a grid = "Каталог". If one product with buy button = "Карточка товара".

Reply ONLY with JSON:
{"page": "PAGE_NAME", "confidence": true}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY_BACKUP}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: imageBuffer.toString('base64') } }
          ]
        }]
      })
    });

    const data = await response.json();
    
    if (data.error) {
      console.log('Page analysis error:', data.error.message);
      return { page: null, confidence: false };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.log('Page analysis: No response');
      return { page: null, confidence: false };
    }

    console.log('Page analysis response:', text.substring(0, 150));

    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.confidence && parsed.page) {
        return {
          page: parsed.page,
          confidence: true
        };
      }
    }

    return { page: null, confidence: false };

  } catch (err) {
    console.error('Page analysis error:', err.message);
    return { page: null, confidence: false };
  }
}

// Stage 2: Function to analyze screenshot with Gemini using direct HTTP API
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

// Create screenshot from web page URL using Puppeteer
app.post('/api/screenshot-url', express.json(), async (req, res) => {
  let browser = null;
  
  try {
    const { url, marketplace, page, date, tag, device } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    // Validate URL
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Некорректный URL' });
    }
    
    console.log('Creating screenshot from URL:', url);
    
    // Launch Puppeteer with system Chromium
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--disable-extensions'
      ]
    });
    
    const browserPage = await browser.newPage();
    
    // Set desktop viewport by default
    await browserPage.setViewport({
      width: 1440,
      height: 900,
      deviceScaleFactor: 2
    });
    await browserPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to URL
    await browserPage.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait a bit for dynamic content
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Take screenshot
    const imageBuffer = await browserPage.screenshot({
      type: 'png',
      fullPage: false
    });
    
    await browser.close();
    browser = null;
    
    console.log('Screenshot captured, size:', imageBuffer.length);
    
    // Generate unique filename
    const fileName = `${uuidv4()}.png`;
    const filePath = `images/${fileName}`;
    
    // Upload to Supabase
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, imageBuffer, {
        contentType: 'image/png'
      });
    
    if (uploadError) {
      console.error('Upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload screenshot' });
    }
    
    // Try to analyze if marketplace/page not provided
    let finalMarketplace = marketplace || '';
    let finalPage = page || '';
    
    if (!finalMarketplace || !finalPage) {
      try {
        const analysis = await analyzeScreenshotPipeline(imageBuffer);
        if (!finalMarketplace && analysis.marketplace) {
          finalMarketplace = analysis.marketplace;
        }
        if (!finalPage && analysis.page) {
          finalPage = analysis.page;
        }
        console.log('AI Analysis result:', finalMarketplace, finalPage);
      } catch (e) {
        console.log('Analysis failed:', e.message);
      }
    }
    
    // Store metadata
    imageMetadata.set(fileName, {
      marketplace: finalMarketplace || 'Не определён',
      page: finalPage || 'Не определена',
      date: date || new Date().toISOString().split('T')[0],
      description: `Скриншот: ${url.substring(0, 80)}`,
      tag: tag || 'web'
    });
    
    await saveMetadata();
    
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);
    
    res.json({
      success: true,
      id: fileName,
      url: urlData.publicUrl,
      marketplace: finalMarketplace || 'Не определён',
      page: finalPage || 'Не определена'
    });
    
  } catch (error) {
    console.error('Screenshot URL error:', error);
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    res.status(500).json({ error: 'Не удалось создать скриншот', details: error.message });
  }
});

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
      description: metadata.description || '',
      tag: metadata.tag || 'app'
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

        const meta = imageMetadata.get(file.name) || {
          marketplace: 'Не указан',
          page: 'Не указана',
          date: file.created_at ? file.created_at.split('T')[0] : '',
          description: '',
          tag: 'app'
        };
        // Ensure tag exists
        if (!meta.tag) meta.tag = 'app';
        
        return {
          id: file.name,
          url: urlData.publicUrl,
          size: file.metadata?.size,
          createdAt: file.created_at,
          metadata: meta
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
    const { marketplace, page, date, description, tag } = req.body;
    
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
      description: description !== undefined ? description : (existingMeta?.description || ''),
      tag: tag !== undefined ? tag : (existingMeta?.tag || 'app')
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

// OCR-based analysis - find marketplace names in image text
app.post('/api/analyze-ocr', async (req, res) => {
  try {
    // Get all images
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list('images', { limit: 1000 });

    if (error) {
      return res.status(500).json({ error: 'Failed to list images' });
    }

    const images = files.filter(f => f.name !== '.emptyFolderPlaceholder');

    // Find unrecognized images
    const unrecognized = images.filter(img => {
      const meta = imageMetadata.get(img.name);
      if (!meta) return true;
      const mp = (meta.marketplace || '').toLowerCase();
      if (mp === 'требует проверки' || mp.startsWith('сравнение:') || mp.startsWith('ocr:')) return false;
      return mp === 'не указан' || mp === 'не определён' || mp === 'не определен' || mp === '';
    });

    if (unrecognized.length === 0) {
      return res.json({ success: true, message: 'No images to analyze', remaining: 0 });
    }

    // Take first image
    const img = unrecognized[0];
    console.log(`OCR analyzing: ${img.name} (${unrecognized.length} remaining)`);

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(`images/${img.name}`);

    // Marketplace keywords to search for
    // Extended keywords with OCR error tolerance
    const marketplaceKeywords = {
      // Ozon variations
      'ozon': 'Ozon', 'озон': 'Ozon', 'o3on': 'Ozon', 'оzon': 'Ozon', 'oz0n': 'Ozon',
      '0zon': 'Ozon', 'озо|': 'Ozon', 'озо': 'Ozon',
      
      // Wildberries variations  
      'wildberries': 'Wildberries', 'вайлдберриз': 'Wildberries', 'wb': 'Wildberries',
      'вайлдберис': 'Wildberries', 'wildberris': 'Wildberries', 'вайлдбериз': 'Wildberries',
      'wild berries': 'Wildberries', 'вайлд': 'Wildberries', 'берриз': 'Wildberries',
      'wildber': 'Wildberries', 'wldberries': 'Wildberries', 'w1ldberries': 'Wildberries',
      'коледино wb': 'Wildberries', 'коледино': 'Wildberries',
      
      // AliExpress variations
      'aliexpress': 'AliExpress', 'алиэкспресс': 'AliExpress', 'ali': 'AliExpress',
      'aliexp': 'AliExpress', 'ali express': 'AliExpress', 'алиэкс': 'AliExpress',
      'алиэксп': 'AliExpress', 'aliexpres': 'AliExpress', 'al1express': 'AliExpress',
      'a]iexpress': 'AliExpress', 'aliexpre': 'AliExpress', 'алик': 'AliExpress',
      'tmall': 'AliExpress',
      
      // Яндекс Маркет variations
      'яндекс': 'Яндекс Маркет', 'yandex': 'Яндекс Маркет', 'маркет': 'Яндекс Маркет',
      'я.маркет': 'Яндекс Маркет', 'яндексмаркет': 'Яндекс Маркет', 'ymarket': 'Яндекс Маркет',
      'яндекс.маркет': 'Яндекс Маркет', 'я маркет': 'Яндекс Маркет', 'янд': 'Яндекс Маркет',
      'яндек': 'Яндекс Маркет', 'yandex market': 'Яндекс Маркет',
      
      // Мегамаркет variations
      'мегамаркет': 'Мегамаркет', 'сбермегамаркет': 'Мегамаркет', 'megamarket': 'Мегамаркет',
      'мега маркет': 'Мегамаркет', 'сбер мега': 'Мегамаркет', 'mega market': 'Мегамаркет',
      'sbermegamarket': 'Мегамаркет', 'сбермега': 'Мегамаркет',
      
      // Lamoda variations
      'lamoda': 'Lamoda', 'ламода': 'Lamoda', 'la moda': 'Lamoda', 'лямода': 'Lamoda',
      'лaмода': 'Lamoda', 'lamоda': 'Lamoda', '1amoda': 'Lamoda',
      
      // Avito variations
      'avito': 'Avito', 'авито': 'Avito', 'avit0': 'Avito', 'av1to': 'Avito',
      'авит0': 'Avito', 'abito': 'Avito', 'авита': 'Avito',
      
      // SHEIN variations
      'shein': 'SHEIN', 'she1n': 'SHEIN', 'shien': 'SHEIN', 'шеин': 'SHEIN',
      'shе1n': 'SHEIN', 'shеin': 'SHEIN', 'shei': 'SHEIN',
      
      // Золотое Яблоко variations
      'золотое яблоко': 'Золотое Яблоко', 'золотоеяблоко': 'Золотое Яблоко',
      'золотое': 'Золотое Яблоко', 'яблоко': 'Золотое Яблоко', 'золотой': 'Золотое Яблоко',
      'zolotoe': 'Золотое Яблоко', 'goldapple': 'Золотое Яблоко', 'gold apple': 'Золотое Яблоко',
      
      // ВкусВилл variations
      'вкусвилл': 'ВкусВилл', 'вкусвил': 'ВкусВилл', 'vkusvill': 'ВкусВилл',
      'вкус вилл': 'ВкусВилл', 'вкусви': 'ВкусВилл',
      
      // Lazada
      'lazada': 'Lazada', '1azada': 'Lazada',
      
      // Amazon
      'amazon': 'Amazon', 'амазон': 'Amazon',
      
      // Joom
      'joom': 'Joom', 'джум': 'Joom',
      
      // KazanExpress
      'kazanexpress': 'KazanExpress', 'казань экспресс': 'KazanExpress', 'kazanexp': 'KazanExpress'
    };

    const pageKeywords = {
      'главная': 'Главная',
      'home': 'Главная',
      'каталог': 'Каталог',
      'catalog': 'Каталог',
      'категории': 'Каталог',
      'корзина': 'Корзина',
      'cart': 'Корзина',
      'профиль': 'Профиль',
      'profile': 'Профиль',
      'аккаунт': 'Профиль',
      'account': 'Профиль',
      'заказы': 'Заказы',
      'orders': 'Заказы',
      'избранное': 'Избранное',
      'favorites': 'Избранное',
      'wishlist': 'Избранное'
    };

    try {
      // Run OCR with better settings
      console.log('Running OCR...');
      const result = await Tesseract.recognize(urlData.publicUrl, 'rus+eng', {
        logger: m => {} // Silent
      });

      // Normalize text: lowercase, remove extra spaces, fix common OCR errors
      let text = result.data.text.toLowerCase();
      text = text.replace(/\s+/g, ' '); // Normalize spaces
      text = text.replace(/[|1l]/g, 'i'); // Common OCR confusion
      text = text.replace(/[0о]/g, 'o'); // 0 and о
      text = text.replace(/[3з]/g, 'з');
      text = text.replace(/[бb]/g, 'b');
      
      // Also create version without spaces for compound words
      const textNoSpaces = text.replace(/\s/g, '');
      
      console.log('OCR text (first 300 chars):', text.substring(0, 300));

      // Find marketplace - check both with and without spaces
      let foundMarketplace = null;
      let foundKeyword = null;
      
      // Sort keywords by length (longer first) to match more specific ones first
      const sortedKeywords = Object.entries(marketplaceKeywords)
        .sort((a, b) => b[0].length - a[0].length);
      
      for (const [keyword, marketplace] of sortedKeywords) {
        if (text.includes(keyword) || textNoSpaces.includes(keyword.replace(/\s/g, ''))) {
          foundMarketplace = marketplace;
          foundKeyword = keyword;
          console.log(`Found marketplace: ${marketplace} (keyword: ${keyword})`);
          break;
        }
      }

      // Find page
      let foundPage = null;
      for (const [keyword, page] of Object.entries(pageKeywords)) {
        if (text.includes(keyword)) {
          foundPage = page;
          break;
        }
      }

      if (foundMarketplace) {
        const existingMeta = imageMetadata.get(img.name) || {};
        imageMetadata.set(img.name, {
          ...existingMeta,
          marketplace: foundMarketplace,
          page: foundPage || existingMeta.page || 'Не указана'
        });
        await saveMetadata();

        return res.json({
          success: true,
          id: img.name,
          marketplace: foundMarketplace,
          page: foundPage,
          remaining: unrecognized.length - 1
        });
      } else {
        // Mark as OCR checked
        const existingMeta = imageMetadata.get(img.name) || {};
        imageMetadata.set(img.name, {
          ...existingMeta,
          marketplace: 'OCR: не найден',
          page: existingMeta.page || 'Не указана'
        });
        await saveMetadata();

        return res.json({
          success: false,
          id: img.name,
          error: 'No marketplace found in text',
          remaining: unrecognized.length - 1
        });
      }

    } catch (ocrError) {
      console.error('OCR error:', ocrError.message);
      
      // Mark as checked
      const existingMeta = imageMetadata.get(img.name) || {};
      imageMetadata.set(img.name, {
        ...existingMeta,
        marketplace: 'OCR: ошибка',
        page: existingMeta.page || 'Не указана'
      });
      await saveMetadata();

      return res.json({
        success: false,
        id: img.name,
        error: ocrError.message,
        remaining: unrecognized.length - 1
      });
    }

  } catch (error) {
    console.error('OCR analysis error:', error);
    res.status(500).json({ error: 'OCR analysis failed', details: error.message });
  }
});

// Debug OCR - show what text is recognized
app.get('/api/debug-ocr/:id', async (req, res) => {
  try {
    const imageId = req.params.id;
    
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(`images/${imageId}`);
    
    console.log('Debug OCR for:', urlData.publicUrl);
    
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
    
    // Run OCR with detailed output
    const result = await Tesseract.recognize(imageBuffer, 'rus+eng', {
      logger: m => console.log(m)
    });
    
    const rawText = result.data.text;
    const normalizedText = rawText.toLowerCase().replace(/\s+/g, ' ');
    
    // Check for keywords
    const keywords = ['золотое', 'яблоко', 'ozon', 'wildberries', 'wb', 'aliexpress', 'ali', 'shein', 'lamoda', 'avito', 'мегамаркет', 'яндекс'];
    const found = keywords.filter(kw => normalizedText.includes(kw));
    
    res.json({
      imageId,
      url: urlData.publicUrl,
      rawText: rawText.substring(0, 1000),
      normalizedText: normalizedText.substring(0, 500),
      foundKeywords: found,
      confidence: result.data.confidence
    });
    
  } catch (error) {
    console.error('Debug OCR error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test 3-stage pipeline on one unrecognized image
app.post('/api/analyze-pipeline', async (req, res) => {
  try {
    // Get all images
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list('images', { limit: 1000 });

    if (error) {
      return res.status(500).json({ error: 'Failed to list images' });
    }

    const images = files.filter(f => f.name !== '.emptyFolderPlaceholder');

    // Find unrecognized images
    const unrecognized = images.filter(img => {
      const meta = imageMetadata.get(img.name);
      if (!meta) return true;
      const mp = (meta.marketplace || '').toLowerCase();
      // Exclude already checked
      if (mp.startsWith('ocr:') || mp.startsWith('pipeline:') || mp === 'требует проверки') return false;
      return mp === 'не указан' || mp === 'не определён' || mp === 'не определен' || mp === '';
    });

    if (unrecognized.length === 0) {
      return res.json({ success: true, message: 'No images to analyze', remaining: 0 });
    }

    const img = unrecognized[0];
    console.log(`Pipeline analyzing: ${img.name} (${unrecognized.length} remaining)`);

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

    // Run 3-stage pipeline
    const startTime = Date.now();
    const result = await analyzeScreenshotPipeline(imageBuffer);
    const elapsed = Date.now() - startTime;

    const existingMeta = imageMetadata.get(img.name) || {};
    
    if (result.marketplace && result.confidence) {
      // Success - update metadata
      imageMetadata.set(img.name, {
        ...existingMeta,
        marketplace: result.marketplace,
        page: result.page || existingMeta.page || 'Не указана'
      });
      await saveMetadata();

      return res.json({
        success: true,
        id: img.name,
        marketplace: result.marketplace,
        page: result.page,
        description: result.description,
        votes: result.votes,
        allResults: result.allResults?.map(r => ({ stage: r.stage, marketplace: r.marketplace, page: r.page })),
        elapsed: `${elapsed}ms`,
        remaining: unrecognized.length - 1
      });
    } else {
      // Failed - mark as checked
      imageMetadata.set(img.name, {
        ...existingMeta,
        marketplace: 'Pipeline: не определён',
        page: existingMeta.page || 'Не указана'
      });
      await saveMetadata();

      return res.json({
        success: false,
        id: img.name,
        error: 'Pipeline could not determine marketplace',
        allResults: result.allResults?.map(r => ({ stage: r.stage, marketplace: r.marketplace, page: r.page })),
        elapsed: `${elapsed}ms`,
        remaining: unrecognized.length - 1
      });
    }

  } catch (error) {
    console.error('Pipeline analysis error:', error);
    res.status(500).json({ error: 'Pipeline failed', details: error.message });
  }
});

// Analyze pages only for images with marketplace but no page
app.post('/api/analyze-pages', async (req, res) => {
  try {
    // Get all images
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list('images', { limit: 1000 });

    if (error) {
      return res.status(500).json({ error: 'Failed to list images' });
    }

    const images = files.filter(f => f.name !== '.emptyFolderPlaceholder');

    // Find images with marketplace but without page
    const needsPage = images.filter(img => {
      const meta = imageMetadata.get(img.name);
      if (!meta) return false;
      
      const mp = (meta.marketplace || '').toLowerCase();
      const pg = (meta.page || '').toLowerCase();
      
      // Has valid marketplace
      const hasMarketplace = mp && 
        !mp.includes('не определён') && 
        !mp.includes('не указан') && 
        !mp.startsWith('pipeline:') &&
        !mp.startsWith('ai:') &&
        !mp.startsWith('ocr:');
      
      // Skip if already checked by AI
      if (pg.startsWith('ai:') || pg.startsWith('pipeline:')) {
        return false;
      }
      
      // Page is missing or unrecognized
      const needsPageAnalysis = !pg || 
        pg === 'не определена' || 
        pg === 'не указана';
      
      return hasMarketplace && needsPageAnalysis;
    });

    if (needsPage.length === 0) {
      return res.json({ success: true, message: 'No images need page analysis', remaining: 0 });
    }

    const img = needsPage[0];
    console.log(`Page analyzing: ${img.name} (${needsPage.length} remaining)`);

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

    // Analyze page only
    const startTime = Date.now();
    const result = await analyzePageOnly(imageBuffer);
    const elapsed = Date.now() - startTime;

    const existingMeta = imageMetadata.get(img.name) || {};
    
    if (result.page && result.confidence) {
      // Success - update page
      imageMetadata.set(img.name, {
        ...existingMeta,
        page: result.page
      });
      await saveMetadata();

      return res.json({
        success: true,
        id: img.name,
        marketplace: existingMeta.marketplace,
        page: result.page,
        elapsed: `${elapsed}ms`,
        remaining: needsPage.length - 1
      });
    } else {
      // Failed - mark as AI checked
      imageMetadata.set(img.name, {
        ...existingMeta,
        page: 'AI: не определена'
      });
      await saveMetadata();

      return res.json({
        success: false,
        id: img.name,
        marketplace: existingMeta.marketplace,
        error: 'Could not determine page',
        elapsed: `${elapsed}ms`,
        remaining: needsPage.length - 1
      });
    }

  } catch (error) {
    console.error('Page analysis error:', error);
    res.status(500).json({ error: 'Page analysis failed', details: error.message });
  }
});

// Compare same page across different marketplaces - UX/UI expert analysis
app.post('/api/compare-page', async (req, res) => {
  try {
    const { page } = req.body;
    
    if (!page) {
      return res.status(400).json({ error: 'Page parameter required' });
    }

    // Get all images
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list('images', { limit: 1000 });

    if (error) {
      return res.status(500).json({ error: 'Failed to list images' });
    }

    // Find images for this page from different marketplaces
    const pageImages = [];
    const seenMarketplaces = new Set();

    for (const file of files) {
      if (file.name === '.emptyFolderPlaceholder') continue;
      
      const meta = imageMetadata.get(file.name);
      if (!meta) continue;
      
      const imgPage = (meta.page || '').toLowerCase();
      const imgMp = meta.marketplace || '';
      
      if (imgPage === page.toLowerCase() && imgMp && !seenMarketplaces.has(imgMp)) {
        seenMarketplaces.add(imgMp);
        
        const { data: urlData } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(`images/${file.name}`);
        
        pageImages.push({
          id: file.name,
          marketplace: imgMp,
          url: urlData.publicUrl
        });
      }
    }

    if (pageImages.length < 2) {
      return res.status(400).json({ 
        error: 'Need at least 2 different marketplaces for comparison',
        found: pageImages.length
      });
    }

    // Limit to 6 images to avoid API limits
    const imagesToCompare = pageImages.slice(0, 6);

    // Download images
    const imageBuffers = [];
    for (const img of imagesToCompare) {
      const buffer = await new Promise((resolve, reject) => {
        const protocol = img.url.startsWith('https') ? https : http;
        protocol.get(img.url, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
          response.on('error', reject);
        }).on('error', reject);
      });
      imageBuffers.push({ ...img, buffer });
    }

    // Build prompt for UX/UI expert analysis
    const marketplaceList = imagesToCompare.map(i => i.marketplace).join(', ');
    
    const prompt = `Ты - эксперт по продуктовому дизайну и UX/UI мобильных приложений e-commerce.

Я показываю тебе скриншоты страницы "${page}" из ${imagesToCompare.length} разных маркетплейсов: ${marketplaceList}.

Проведи детальный сравнительный анализ:

## 1. ВИЗУАЛЬНЫЙ ДИЗАЙН
- Цветовые схемы и акценты
- Типографика и читаемость
- Иконки и визуальные элементы
- Общий стиль (минимализм/насыщенность)

## 2. ИНФОРМАЦИОННАЯ АРХИТЕКТУРА  
- Иерархия информации
- Группировка элементов
- Что выделено, что скрыто

## 3. UX ПАТТЕРНЫ
- Навигация и CTA (call-to-action)
- Как пользователь достигает цели
- Удобство взаимодействия

## 4. УНИКАЛЬНЫЕ РЕШЕНИЯ
- Что каждый маркетплейс делает по-своему?
- Какие интересные находки?

## 5. ЛУЧШИЕ ПРАКТИКИ
- Кто делает лучше всего и почему?
- Что можно улучшить?

## 6. РЕКОМЕНДАЦИИ
- Какие решения стоит перенять?
- Общие тренды

Пиши на русском языке. Будь конкретен, приводи примеры из скриншотов.`;

    // Call Gemini API with multiple images
    const parts = [{ text: prompt }];
    
    for (const img of imageBuffers) {
      parts.push({
        text: `\n--- Скриншот: ${img.marketplace} ---`
      });
      parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: img.buffer.toString('base64')
        }
      });
    }

    const apiKey = GEMINI_API_KEY_BACKUP || GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'No Gemini API key configured' });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          maxOutputTokens: 4000
        }
      })
    });

    const data = await response.json();
    
    if (data.error) {
      return res.status(500).json({ 
        error: 'Gemini API error', 
        details: data.error.message,
        marketplaces: imagesToCompare.map(i => i.marketplace)
      });
    }

    const analysisText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!analysisText) {
      return res.status(500).json({ error: 'No analysis received from AI' });
    }

    res.json({
      success: true,
      page: page,
      marketplaces: imagesToCompare.map(i => ({ id: i.id, name: i.marketplace })),
      analysis: analysisText
    });

  } catch (error) {
    console.error('Compare page error:', error);
    res.status(500).json({ error: 'Comparison failed', details: error.message });
  }
});

// Analyze with custom query - flexible AI analysis
app.post('/api/analyze-query', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter required' });
    }

    console.log('Analyze query:', query);
    
    // Determine if this is a screenshot-related query or general question
    const needsScreenshots = isScreenshotQuery(query);
    console.log('Needs screenshots:', needsScreenshots);

    // If general question (not about screenshots), use Claude
    if (!needsScreenshots) {
      console.log('General question - using Claude');
      
      // Try Claude first
      const claudeResponse = await askClaude(query);
      
      if (claudeResponse) {
        return res.json({
          success: true,
          query: query,
          images: [],
          analysis: claudeResponse,
          model: 'claude-sonnet-4'
        });
      }
      
      // Fallback to Gemini for general question
      console.log('Claude unavailable, falling back to Gemini');
      const apiKey = GEMINI_API_KEY || GEMINI_API_KEY_BACKUP;
      if (!apiKey) {
        return res.status(400).json({ error: 'No AI API key configured' });
      }
      
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const geminiResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ 
            text: `Ты - AI ассистент по UX/UI дизайну и e-commerce. Отвечай кратко и по делу.\n\nВопрос: ${query}` 
          }] }],
          generationConfig: { maxOutputTokens: 2000 }
        })
      });
      
      const geminiData = await geminiResponse.json();
      const analysisText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Не удалось получить ответ';
      
      return res.json({
        success: true,
        query: query,
        images: [],
        analysis: analysisText,
        model: 'gemini'
      });
    }

    // Screenshot-related query - use existing logic
    // Get all images
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list('images', { limit: 1000 });

    if (error) {
      return res.status(500).json({ error: 'Failed to list images' });
    }

    // Parse query to find relevant images
    const queryLower = query.toLowerCase();
    
    // Check if user wants ALL marketplaces
    const wantsAllMarketplaces = queryLower.includes('всех маркетплейс') || 
                                  queryLower.includes('все маркетплейс') ||
                                  queryLower.includes('всех магазин') ||
                                  queryLower.includes('у всех') ||
                                  queryLower.includes('разных маркетплейс');
    
    // Detect marketplaces mentioned (only if not asking for all)
    const marketplaceKeywords = {
      'wildberries': 'Wildberries', 'wb ': 'Wildberries', 'вайлдберриз': 'Wildberries',
      'ozon': 'Ozon', 'озон': 'Ozon',
      'aliexpress': 'AliExpress', 'алиэкспресс': 'AliExpress',
      'яндекс маркет': 'Яндекс Маркет', 'яндекс.маркет': 'Яндекс Маркет',
      'мегамаркет': 'Мегамаркет', 'сбермегамаркет': 'Мегамаркет',
      'lamoda': 'Lamoda', 'ламода': 'Lamoda',
      'avito': 'Avito', 'авито': 'Avito',
      'shein': 'SHEIN', 'шейн': 'SHEIN',
      'золотое яблоко': 'Золотое Яблоко'
    };
    
    // Detect pages mentioned
    const pageKeywords = {
      'корзин': 'Корзина', 'cart': 'Корзина',
      'главн': 'Главная', 'home': 'Главная',
      'каталог': 'Каталог', 'catalog': 'Каталог',
      'карточк': 'Карточка товара', 'product': 'Карточка товара',
      'профил': 'Профиль', 'profile': 'Профиль',
      'заказ': 'Заказы', 'order': 'Заказы',
      'избранн': 'Избранное', 'favorit': 'Избранное',
      'поиск': 'Поиск', 'search': 'Поиск'
    };
    
    let targetMarketplaces = [];
    let targetPages = [];
    
    // Only look for specific marketplaces if NOT asking for all
    if (!wantsAllMarketplaces) {
      for (const [keyword, mp] of Object.entries(marketplaceKeywords)) {
        if (queryLower.includes(keyword) && !targetMarketplaces.includes(mp)) {
          targetMarketplaces.push(mp);
        }
      }
    }
    
    for (const [keyword, pg] of Object.entries(pageKeywords)) {
      if (queryLower.includes(keyword) && !targetPages.includes(pg)) {
        targetPages.push(pg);
      }
    }
    
    console.log('Wants all marketplaces:', wantsAllMarketplaces);
    console.log('Target marketplaces:', targetMarketplaces);
    console.log('Target pages:', targetPages);

    // Select images based on query
    const selectedImages = [];
    const seenMarketplaces = new Set();

    for (const file of files) {
      if (file.name === '.emptyFolderPlaceholder') continue;
      
      const meta = imageMetadata.get(file.name);
      if (!meta) continue;
      
      const mp = meta.marketplace || '';
      const pg = meta.page || '';
      
      // Skip unrecognized
      if (!mp || mp.toLowerCase().includes('не определён')) continue;
      if (!pg || pg.toLowerCase().includes('не определена')) continue;
      
      let shouldInclude = false;
      
      // If user wants ALL marketplaces for specific page
      if (wantsAllMarketplaces && targetPages.length > 0) {
        // Check if this image matches the target page
        if (targetPages.some(t => pg.toLowerCase().includes(t.toLowerCase()))) {
          // Include only one per marketplace
          if (!seenMarketplaces.has(mp)) {
            seenMarketplaces.add(mp);
            shouldInclude = true;
          }
        }
      }
      // If specific marketplaces requested
      else if (targetMarketplaces.length > 0) {
        if (targetMarketplaces.some(t => mp.toLowerCase().includes(t.toLowerCase()))) {
          // If also specific pages requested
          if (targetPages.length > 0) {
            if (targetPages.some(t => pg.toLowerCase().includes(t.toLowerCase()))) {
              // One image per page for this marketplace
              const key = `${mp}-${pg}`;
              if (!seenMarketplaces.has(key)) {
                seenMarketplaces.add(key);
                shouldInclude = true;
              }
            }
          } else {
            // Include multiple pages from this marketplace (one per page type)
            const key = `${mp}-${pg}`;
            if (!seenMarketplaces.has(key)) {
              seenMarketplaces.add(key);
              shouldInclude = true;
            }
          }
        }
      }
      // If only specific pages requested (no specific marketplaces)
      else if (targetPages.length > 0) {
        if (targetPages.some(t => pg.toLowerCase().includes(t.toLowerCase()))) {
          // Include one per marketplace for this page
          if (!seenMarketplaces.has(mp)) {
            seenMarketplaces.add(mp);
            shouldInclude = true;
          }
        }
      }
      // If no specific filters, include diverse sample
      else {
        // Include one per marketplace
        if (!seenMarketplaces.has(mp)) {
          seenMarketplaces.add(mp);
          shouldInclude = true;
        }
      }
      
      if (shouldInclude) {
        const { data: urlData } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(`images/${file.name}`);
        
        selectedImages.push({
          id: file.name,
          marketplace: mp,
          page: pg,
          url: urlData.publicUrl
        });
      }
      
      // Limit to 8 images
      if (selectedImages.length >= 8) break;
    }

    // If no images found, fallback to general question mode
    if (selectedImages.length === 0) {
      console.log('No images found, falling back to general question mode');
      
      // Try Claude first
      const claudeResponse = await askClaude(query);
      if (claudeResponse) {
        return res.json({
          success: true,
          query: query,
          images: [],
          analysis: claudeResponse,
          model: 'claude-sonnet-4'
        });
      }
      
      // Fallback to Gemini
      const apiKey = GEMINI_API_KEY || GEMINI_API_KEY_BACKUP;
      if (apiKey) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const geminiResponse = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ 
              text: `Ты - AI ассистент по UX/UI дизайну и e-commerce. Отвечай кратко и по делу.\n\nВопрос: ${query}` 
            }] }],
            generationConfig: { maxOutputTokens: 2000 }
          })
        });
        
        const geminiData = await geminiResponse.json();
        const analysisText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Не удалось получить ответ';
        
        return res.json({
          success: true,
          query: query,
          images: [],
          analysis: analysisText,
          model: 'gemini'
        });
      }
      
      return res.status(400).json({ error: 'Не найдено изображений и нет доступных AI моделей' });
    }

    console.log(`Selected ${selectedImages.length} images for analysis`);

    // Download images
    const imageBuffers = [];
    for (const img of selectedImages) {
      const buffer = await new Promise((resolve, reject) => {
        const protocol = img.url.startsWith('https') ? https : http;
        protocol.get(img.url, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
          response.on('error', reject);
        }).on('error', reject);
      });
      imageBuffers.push({ ...img, buffer });
    }

    // Build prompt
    const imageDescriptions = selectedImages.map(i => `${i.marketplace} - ${i.page}`).join(', ');
    
    const prompt = `Ты - эксперт по продуктовому дизайну и UX/UI мобильных приложений e-commerce.

Пользователь задал вопрос: "${query}"

Я показываю тебе ${selectedImages.length} скриншотов из разных маркетплейсов: ${imageDescriptions}

Дай развернутый ответ на вопрос пользователя, опираясь на эти скриншоты.

Структурируй ответ с заголовками (##).
Будь конкретен, приводи примеры из скриншотов.
Пиши на русском языке.`;

    // Try Claude with images first (if available)
    if (anthropic) {
      try {
        console.log('Using Claude for image analysis');
        
        const claudeImages = imageBuffers.map(img => ({
          base64: img.buffer.toString('base64'),
          mediaType: 'image/jpeg'
        }));
        
        const claudeResponse = await askClaude(query, `Я показываю тебе ${selectedImages.length} скриншотов из маркетплейсов: ${imageDescriptions}. Проанализируй их и ответь на вопрос.`, claudeImages);
        
        if (claudeResponse) {
          return res.json({
            success: true,
            query: query,
            images: selectedImages.map(i => ({ id: i.id, marketplace: i.marketplace, page: i.page })),
            analysis: claudeResponse,
            model: 'claude-sonnet-4'
          });
        }
      } catch (claudeErr) {
        console.log('Claude failed, falling back to Gemini:', claudeErr.message);
      }
    }

    // Fallback to Gemini API
    const parts = [{ text: prompt }];
    
    for (const img of imageBuffers) {
      parts.push({
        text: `\n--- ${img.marketplace} | ${img.page} ---`
      });
      parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: img.buffer.toString('base64')
        }
      });
    }

    const apiKey = GEMINI_API_KEY || GEMINI_API_KEY_BACKUP;
    if (!apiKey) {
      return res.status(400).json({ error: 'No Gemini API key configured' });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          maxOutputTokens: 4000
        }
      })
    });

    const data = await response.json();
    
    if (data.error) {
      return res.status(500).json({ 
        error: 'Gemini API error', 
        details: data.error.message
      });
    }

    const analysisText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!analysisText) {
      return res.status(500).json({ error: 'No analysis received from AI' });
    }

    res.json({
      success: true,
      query: query,
      images: selectedImages.map(i => ({ id: i.id, marketplace: i.marketplace, page: i.page })),
      analysis: analysisText,
      model: 'gemini'
    });

  } catch (error) {
    console.error('Analyze query error:', error);
    res.status(500).json({ error: 'Analysis failed', details: error.message });
  }
});

// Get available pages for comparison
app.get('/api/compare-options', async (req, res) => {
  try {
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list('images', { limit: 1000 });

    if (error) {
      return res.status(500).json({ error: 'Failed to list images' });
    }

    // Group by pages
    const pages = {};
    
    for (const file of files) {
      if (file.name === '.emptyFolderPlaceholder') continue;
      
      const meta = imageMetadata.get(file.name);
      if (!meta) continue;
      
      const pg = meta.page || '';
      const mp = meta.marketplace || '';
      
      if (pg && !pg.toLowerCase().includes('не определена') && !pg.toLowerCase().startsWith('ai:') && mp) {
        if (!pages[pg]) {
          pages[pg] = { count: 0, marketplaces: new Set() };
        }
        pages[pg].count++;
        pages[pg].marketplaces.add(mp);
      }
    }

    // Convert to array and filter pages with 2+ marketplaces
    const options = Object.entries(pages)
      .filter(([_, data]) => data.marketplaces.size >= 2)
      .map(([page, data]) => ({
        page,
        count: data.count,
        marketplaces: Array.from(data.marketplaces).sort()
      }))
      .sort((a, b) => b.marketplaces.length - a.marketplaces.length);

    res.json({ options });

  } catch (error) {
    console.error('Compare options error:', error);
    res.status(500).json({ error: 'Failed to get options' });
  }
});

// Set tag for all images
app.post('/api/set-all-tags', express.json(), async (req, res) => {
  try {
    const { tag } = req.body;
    
    if (!tag || !['app', 'web'].includes(tag)) {
      return res.status(400).json({ error: 'Tag must be "app" or "web"' });
    }
    
    let updated = 0;
    
    for (const [id, meta] of imageMetadata.entries()) {
      meta.tag = tag;
      imageMetadata.set(id, meta);
      updated++;
    }
    
    await saveMetadata();
    
    res.json({ 
      success: true, 
      message: `Updated ${updated} images with tag "${tag}"`,
      updated 
    });
    
  } catch (error) {
    console.error('Set all tags error:', error);
    res.status(500).json({ error: 'Failed to set tags' });
  }
});

// Reset ALL images for full re-analysis
app.post('/api/reset-all', async (req, res) => {
  try {
    let reset = 0;
    
    for (const [id, meta] of imageMetadata.entries()) {
      meta.marketplace = 'Не определён';
      meta.page = 'Не определена';
      imageMetadata.set(id, meta);
      reset++;
    }
    
    if (reset > 0) {
      await saveMetadata();
    }
    
    res.json({
      success: true,
      message: `Reset all ${reset} images for re-analysis`,
      count: reset
    });
    
  } catch (error) {
    console.error('Reset all error:', error);
    res.status(500).json({ error: 'Reset failed', details: error.message });
  }
});

// Reset only pages (not marketplaces) for re-analysis
app.post('/api/reset-pages', async (req, res) => {
  try {
    let reset = 0;
    
    for (const [id, meta] of imageMetadata.entries()) {
      const pg = meta.page || '';
      if (pg.startsWith('AI:') || pg.startsWith('Pipeline:') || pg === 'Не определена') {
        meta.page = 'Не определена';
        imageMetadata.set(id, meta);
        reset++;
      }
    }
    
    if (reset > 0) {
      await saveMetadata();
    }
    
    res.json({
      success: true,
      message: `Reset ${reset} pages for re-analysis`,
      count: reset
    });
    
  } catch (error) {
    console.error('Reset pages error:', error);
    res.status(500).json({ error: 'Reset failed', details: error.message });
  }
});

// Reset "AI: не определён" marks for re-analysis
app.post('/api/reset-unrecognized', async (req, res) => {
  try {
    let reset = 0;
    const resetIds = [];
    
    for (const [id, meta] of imageMetadata.entries()) {
      // Reset AI:, Сравнение:, OCR:, Pipeline:, and Требует проверки
      const mp = meta.marketplace || '';
      if (mp.startsWith('AI:') || mp.startsWith('Сравнение:') || mp.startsWith('OCR:') || mp.startsWith('Pipeline:') || mp === 'Требует проверки') {
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

    // Marketplace keyboard - актуальный список
    const marketplaceKeyboard = {
      inline_keyboard: [
        [{ text: '🟣 Wildberries', callback_data: 'mp_Wildberries' }, { text: '🔵 Ozon', callback_data: 'mp_Ozon' }],
        [{ text: '🟠 AliExpress', callback_data: 'mp_AliExpress' }, { text: '🟡 Яндекс Маркет', callback_data: 'mp_Яндекс Маркет' }],
        [{ text: '🟢 Мегамаркет', callback_data: 'mp_Мегамаркет' }, { text: '🖤 Lamoda', callback_data: 'mp_Lamoda' }],
        [{ text: '🟢 Avito', callback_data: 'mp_Avito' }, { text: '🍏 Золотое Яблоко', callback_data: 'mp_Золотое Яблоко' }],
        [{ text: '⬛ SHEIN', callback_data: 'mp_SHEIN' }, { text: '📦 Другой...', callback_data: 'mp_custom' }]
      ]
    };

    // Page type keyboard
    const pageKeyboard = {
      inline_keyboard: [
        [{ text: '🏠 Главная', callback_data: 'pg_Главная' }, { text: '📋 Каталог', callback_data: 'pg_Каталог' }],
        [{ text: '📦 Карточка товара', callback_data: 'pg_Карточка товара' }, { text: '🛒 Корзина', callback_data: 'pg_Корзина' }],
        [{ text: '👤 Профиль', callback_data: 'pg_Профиль' }, { text: '📋 Заказы', callback_data: 'pg_Заказы' }],
        [{ text: '❤️ Избранное', callback_data: 'pg_Избранное' }, { text: '🔍 Поиск', callback_data: 'pg_Поиск' }],
        [{ text: '📄 Другое...', callback_data: 'pg_custom' }]
      ]
    };

    // Date keyboard - упрощённый
    const dateKeyboard = {
      inline_keyboard: [
        [{ text: '📅 Сегодня', callback_data: 'date_today' }, { text: '📅 Вчера', callback_data: 'date_yesterday' }],
        [{ text: '✏️ Ввести дату вручную', callback_data: 'date_custom' }]
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

    // Start command - начинает flow загрузки
    bot.onText(/\/start/, (msg) => {
      pendingUploads.delete(msg.chat.id);
      userStates.delete(msg.chat.id);
      pendingPhotos.delete(msg.chat.id);
      
      // Шаг 1: Сразу спрашиваем дату
      bot.sendMessage(msg.chat.id, `
✦ *Screenshot Library*

Давайте загрузим скриншоты!

*Шаг 1 из 3* — Выберите дату скриншотов:
      `, { 
        parse_mode: 'Markdown',
        reply_markup: dateKeyboard
      });
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
      const state = userStates.get(chatId) || {};
      
      // Ввод кастомной даты
      if (state.waitingForDate) {
        const text = msg.text.trim();
        const dateMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          const date = new Date(year, month - 1, day);
          
          if (date.getDate() == day && date.getMonth() == month - 1) {
            const dateStr = getDateString(date);
            userStates.set(chatId, { date: dateStr, step: 'marketplace' });
            
            // Шаг 2: Выбор маркетплейса
            bot.sendMessage(chatId, 
              `✅ Дата: *${formatDate(date)}*\n\n*Шаг 2 из 3* — Выберите маркетплейс:`,
              { parse_mode: 'Markdown', reply_markup: marketplaceKeyboard }
            );
          } else {
            bot.sendMessage(chatId, '❌ Некорректная дата. Введите в формате ДД.ММ.ГГГГ\nНапример: 15.01.2026');
          }
        } else {
          bot.sendMessage(chatId, '❌ Неверный формат. Введите дату в формате ДД.ММ.ГГГГ\nНапример: 15.01.2026');
        }
        return;
      }
      
      // Ввод кастомного маркетплейса
      if (state.waitingForMarketplace) {
        const marketplace = msg.text.trim();
        if (marketplace.length < 2) {
          bot.sendMessage(chatId, '❌ Название слишком короткое. Введите название маркетплейса:');
          return;
        }
        
        userStates.set(chatId, { ...state, marketplace, waitingForMarketplace: false, step: 'upload' });
        
        // Шаг 3: Загрузка изображений
        bot.sendMessage(chatId, 
          `✅ Дата: *${state.date ? formatDate(new Date(state.date)) : 'не указана'}*\n✅ Маркетплейс: *${marketplace}*\n\n*Шаг 3 из 3* — Загрузите скриншоты\n\n📸 Отправьте один или несколько скриншотов.\nAI автоматически определит тип страницы.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      // Ввод кастомной страницы
      if (state.waitingForPage) {
        const page = msg.text.trim();
        if (page.length < 2) {
          bot.sendMessage(chatId, '❌ Название слишком короткое. Введите название страницы:');
          return;
        }
        
        userStates.set(chatId, { ...state, page, waitingForPage: false });
        
        // Продолжить обработку если есть pending upload
        const pending = pendingUploads.get(chatId);
        if (pending) {
          pending.analysis.page = page;
          // Финализировать загрузку
          await finalizeUpload(chatId, pending);
        }
        return;
      }
    });

    // Process and upload image
    async function processImage(chatId, fileBuffer, fileName, mimeType, statusMsgId) {
      try {
        // Get state with preset marketplace
        const state = userStates.get(chatId) || {};
        const presetMarketplace = state.marketplace;
        
        // Analyze with 3-stage pipeline
        await bot.editMessageText('🔍 *Анализирую скриншот...*\n\n1️⃣ OCR проверка\n2️⃣ AI анализ\n3️⃣ Сравнение с примерами', { 
          chat_id: chatId, 
          message_id: statusMsgId, 
          parse_mode: 'Markdown' 
        });

        const analysis = await analyzeScreenshotPipeline(fileBuffer);
        
        // Если маркетплейс был указан в flow, использовать его
        if (presetMarketplace) {
          analysis.marketplace = presetMarketplace;
          analysis.confidence = true;
        }
        
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
        } else if (data === 'date_custom') {
          // Ask for custom date input
          userStates.set(chatId, { waitingForDate: true, step: 'date' });
          await bot.editMessageText(
            '✏️ *Введите дату в формате ДД.ММ.ГГГГ*\n\nНапример: 15.01.2026',
            { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
          );
          return;
        }

        if (selectedDate) {
          const dateStr = getDateString(selectedDate);
          userStates.set(chatId, { date: dateStr, step: 'marketplace' });
          
          // Шаг 2: Выбор маркетплейса
          await bot.editMessageText(
            `✅ Дата: *${formatDate(selectedDate)}*\n\n*Шаг 2 из 3* — Выберите маркетплейс:`,
            { 
              chat_id: chatId, 
              message_id: query.message.message_id, 
              parse_mode: 'Markdown',
              reply_markup: marketplaceKeyboard
            }
          );
        }
        return;
      }
      
      // Handle marketplace/page selection
      const pending = pendingUploads.get(chatId);
      const state = userStates.get(chatId) || {};

      if (data.startsWith('mp_')) {
        // Обработка кастомного ввода
        if (data === 'mp_custom') {
          userStates.set(chatId, { ...state, waitingForMarketplace: true });
          await bot.editMessageText(
            '✏️ *Введите название маркетплейса:*',
            { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
          );
          return;
        }
        
        const marketplace = data.replace('mp_', '');
        
        // Если есть pending upload (AI не смог определить) - обработать его
        if (pending) {
          pending.analysis.marketplace = marketplace;
          
          if (!pending.analysis.page || pending.analysis.page === 'null') {
            pending.step = 'page';
            pendingUploads.set(chatId, pending);
            await bot.editMessageText(
              `✅ Маркетплейс: *${marketplace}*\n\nВыберите тип страницы:`,
              { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: pageKeyboard }
            );
          } else {
            await finalizeUpload(chatId, pending.fileBuffer, pending.fileName, pending.mimeType, pending.analysis, query.message.message_id);
          }
          return;
        }
        
        // Flow из /start - сохранить маркетплейс и перейти к загрузке
        userStates.set(chatId, { ...state, marketplace, step: 'upload' });
        await bot.editMessageText(
          `✅ Дата: *${state.date ? formatDate(new Date(state.date)) : 'не указана'}*\n✅ Маркетплейс: *${marketplace}*\n\n*Шаг 3 из 3* — Загрузите скриншоты\n\n📸 Отправьте один или несколько скриншотов.\nAI автоматически определит тип страницы.`,
          { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
        );
        return;
      }
      
      if (data.startsWith('pg_')) {
        // Обработка кастомного ввода
        if (data === 'pg_custom') {
          userStates.set(chatId, { ...state, waitingForPage: true });
          await bot.editMessageText(
            '✏️ *Введите название страницы:*',
            { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
          );
          return;
        }
        
        // Если есть pending upload
        if (pending) {
          pending.analysis.page = data.replace('pg_', '');
          await finalizeUpload(chatId, pending.fileBuffer, pending.fileName, pending.mimeType, pending.analysis, query.message.message_id);
        }
      }
    });

    // Process album (multiple photos)
    async function processAlbum(chatId, photos) {
      // Get date and marketplace from user state
      const state = userStates.get(chatId) || {};
      const screenshotDate = state.date || new Date().toISOString().split('T')[0];
      const presetMarketplace = state.marketplace; // Маркетплейс из flow
      const formattedDate = new Date(screenshotDate).toLocaleDateString('ru-RU');

      let statusText = `📸 *Обрабатываю ${photos.length} скриншотов...*\n📅 Дата: ${formattedDate}`;
      if (presetMarketplace) {
        statusText += `\n🏪 Маркетплейс: ${presetMarketplace}`;
      }
      
      const statusMsg = await bot.sendMessage(chatId, statusText, { parse_mode: 'Markdown' });
      
      let successCount = 0;
      let failCount = 0;
      const results = [];

      for (let i = 0; i < photos.length; i++) {
        try {
          await bot.editMessageText(
            `🔍 *Анализирую скриншот ${i + 1} из ${photos.length}...*\n📅 Дата: ${formattedDate}${presetMarketplace ? `\n🏪 ${presetMarketplace}` : ''}`,
            { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
          );

          const photo = photos[i];
          const file = await bot.getFile(photo.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
          const fileBuffer = await downloadFile(fileUrl);

          // Analyze with 3-stage pipeline (OCR -> AI -> Comparison)
          const analysis = await analyzeScreenshotPipeline(fileBuffer);
          
          // Если маркетплейс был указан в flow, использовать его
          if (presetMarketplace) {
            analysis.marketplace = presetMarketplace;
          }

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
