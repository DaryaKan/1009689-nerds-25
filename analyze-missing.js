/**
 * Script to analyze images with missing marketplace/page data
 * and update them using Gemini AI
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'screenshots';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Load metadata
async function loadMetadata() {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download('metadata.json');
    
    if (error) {
      console.log('No metadata file found');
      return {};
    }
    
    const text = await data.text();
    return JSON.parse(text);
  } catch (err) {
    console.log('Error loading metadata:', err.message);
    return {};
  }
}

// Save metadata
async function saveMetadata(metadata) {
  const jsonData = JSON.stringify(metadata, null, 2);
  
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload('metadata.json', jsonData, {
      contentType: 'application/json',
      upsert: true
    });
  
  if (error) {
    console.error('Error saving metadata:', error.message);
  } else {
    console.log('Metadata saved successfully');
  }
}

// Download image as buffer
async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

// Analyze image with Gemini
async function analyzeImage(imageBuffer) {
  const prompt = `Analyze this screenshot of a marketplace/e-commerce app or website.

TASK: Identify the marketplace and page type.

MARKETPLACE IDENTIFICATION - Look for these visual signs:
1. ALIEXPRESS - Red/orange colors, "AliExpress" text anywhere on screen, Chinese products, prices in rubles with discounts
2. OZON - Blue colors, "OZON" logo, blue buttons and interface
3. WILDBERRIES - Purple/pink colors, "Wildberries" or "WB" logo
4. ЯНДЕКС МАРКЕТ - Yellow colors, Yandex logo, "Маркет" text
5. МЕГАМАРКЕТ - Green colors, "СберМегаМаркет" or "Мегамаркет" text
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

IMPORTANT: If you see any marketplace text/logo ANYWHERE on the image, identify it.

Respond ONLY with JSON (no markdown):
{"marketplace": "NAME", "page": "PAGE_TYPE", "description": "brief description"}`;

  const models = ['gemini-1.5-flash', 'gemini-2.0-flash'];
  
  for (const model of models) {
    try {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (text) {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      }
    } catch (e) {
      console.log(`Model ${model} failed:`, e.message);
    }
  }
  
  return null;
}

// Normalize marketplace name
function normalizeMarketplace(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  
  if (lower.includes('мегамаркет') || lower.includes('мега маркет') || lower.includes('сбермегамаркет') || lower.includes('сбер')) {
    return 'Мегамаркет';
  }
  if (lower.includes('яндекс') && lower.includes('маркет')) {
    return 'Яндекс Маркет';
  }
  if (lower.includes('ozon') || lower === 'озон') {
    return 'Ozon';
  }
  if (lower.includes('wildberries') || lower === 'wb' || lower.includes('вайлдберриз')) {
    return 'Wildberries';
  }
  if (lower.includes('aliexpress') || lower.includes('али')) {
    return 'AliExpress';
  }
  if (lower.includes('amazon') || lower.includes('амазон')) {
    return 'Amazon';
  }
  if (lower.includes('lamoda') || lower.includes('ламода')) {
    return 'Lamoda';
  }
  if (lower.includes('avito') || lower.includes('авито')) {
    return 'Avito';
  }
  
  return name;
}

// Check if metadata needs update
function needsAnalysis(meta) {
  if (!meta) return true;
  
  const mp = (meta.marketplace || '').toLowerCase();
  const pg = (meta.page || '').toLowerCase();
  
  const invalidValues = ['не указан', 'не указана', 'не определён', 'не определена', 'unknown', ''];
  
  return invalidValues.includes(mp) || invalidValues.includes(pg);
}

// Main function
async function main() {
  console.log('Loading images from Supabase...');
  
  // Get list of images
  const { data: files, error } = await supabase.storage
    .from(BUCKET)
    .list('images', { limit: 1000 });
  
  if (error) {
    console.error('Error listing files:', error);
    return;
  }
  
  const images = files.filter(f => f.name !== '.emptyFolderPlaceholder');
  console.log(`Found ${images.length} images`);
  
  // Load existing metadata
  const metadata = await loadMetadata();
  console.log(`Loaded metadata for ${Object.keys(metadata).length} images`);
  
  // Find images that need analysis
  const toAnalyze = images.filter(img => needsAnalysis(metadata[img.name]));
  console.log(`Found ${toAnalyze.length} images needing analysis`);
  
  if (toAnalyze.length === 0) {
    console.log('All images already have valid metadata!');
    return;
  }
  
  let updated = 0;
  let failed = 0;
  
  for (let i = 0; i < toAnalyze.length; i++) {
    const img = toAnalyze[i];
    console.log(`\n[${i + 1}/${toAnalyze.length}] Analyzing: ${img.name}`);
    
    try {
      // Get public URL
      const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(`images/${img.name}`);
      
      // Download image
      console.log('  Downloading...');
      const imageBuffer = await downloadImage(urlData.publicUrl);
      
      // Analyze with AI
      console.log('  Analyzing with AI...');
      const analysis = await analyzeImage(imageBuffer);
      
      if (analysis && analysis.marketplace) {
        const normalizedMp = normalizeMarketplace(analysis.marketplace);
        
        // Update metadata
        metadata[img.name] = {
          ...metadata[img.name],
          marketplace: normalizedMp || analysis.marketplace,
          page: analysis.page || metadata[img.name]?.page || 'Не указана',
          description: analysis.description || metadata[img.name]?.description || '',
          date: metadata[img.name]?.date || new Date().toISOString().split('T')[0]
        };
        
        console.log(`  ✅ ${normalizedMp || analysis.marketplace} • ${analysis.page}`);
        updated++;
      } else {
        console.log('  ❌ Could not analyze');
        failed++;
      }
      
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 1000));
      
    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
      failed++;
    }
  }
  
  // Save updated metadata
  if (updated > 0) {
    console.log('\nSaving metadata...');
    await saveMetadata(metadata);
  }
  
  console.log(`\n========== DONE ==========`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
