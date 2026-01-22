require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function testUpload() {
  console.log('Тестирую загрузку в bucket "screenshots"...\n');
  
  // Create a simple test image (1x1 red pixel PNG)
  const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const testBuffer = Buffer.from(testImageBase64, 'base64');
  
  const { data, error } = await supabase.storage
    .from('screenshots')
    .upload('test/test-image.png', testBuffer, {
      contentType: 'image/png',
      upsert: true
    });
  
  if (error) {
    console.log('❌ Ошибка загрузки:', error.message);
    console.log('\nВозможные причины:');
    console.log('1. Bucket "screenshots" не существует или не публичный');
    console.log('2. Нужно настроить RLS политики в Supabase');
    console.log('\nНастройка RLS:');
    console.log('1. Supabase → Storage → screenshots → Policies');
    console.log('2. New policy → For full customization');
    console.log('3. Policy name: "Allow all"');
    console.log('4. Allowed operation: ALL');
    console.log('5. Target roles: anon, authenticated');
    console.log('6. USING expression: true');
    console.log('7. WITH CHECK expression: true');
    return;
  }
  
  console.log('✅ Файл успешно загружен!');
  console.log('Path:', data.path);
  
  // Get public URL
  const { data: urlData } = supabase.storage
    .from('screenshots')
    .getPublicUrl('test/test-image.png');
  
  console.log('URL:', urlData.publicUrl);
  console.log('\n🎉 Всё работает! Можно запускать сервер.');
}

testUpload();
