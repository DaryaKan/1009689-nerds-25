require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

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
app.use(express.static(path.join(__dirname, '../')));

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  }
});

// Helper function to get file extension
function getExtension(mimetype) {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp'
  };
  return extensions[mimetype] || 'jpg';
}

// ============ API ROUTES ============

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

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) {
      console.error('Supabase upload error:', error);
      return res.status(500).json({ error: 'Failed to upload image', details: error.message });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    const imageData = {
      id: fileName,
      path: filePath,
      url: urlData.publicUrl,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      uploadedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      image: imageData
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Upload multiple images
app.post('/api/upload-multiple', upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No image files provided' });
    }

    const uploadedImages = [];
    const errors = [];

    for (const file of req.files) {
      const ext = getExtension(file.mimetype);
      const fileName = `${uuidv4()}.${ext}`;
      const filePath = `images/${fileName}`;

      const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (error) {
        errors.push({ file: file.originalname, error: error.message });
        continue;
      }

      const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(filePath);

      uploadedImages.push({
        id: fileName,
        path: filePath,
        url: urlData.publicUrl,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        uploadedAt: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: `Uploaded ${uploadedImages.length} of ${req.files.length} images`,
      images: uploadedImages,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Multiple upload error:', error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Get all images
app.get('/api/images', async (req, res) => {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list('images', {
        limit: 100,
        offset: 0,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (error) {
      console.error('List error:', error);
      return res.status(500).json({ error: 'Failed to list images', details: error.message });
    }

    const images = data
      .filter(file => file.name !== '.emptyFolderPlaceholder')
      .map(file => {
        const { data: urlData } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(`images/${file.name}`);

        return {
          id: file.name,
          path: `images/${file.name}`,
          url: urlData.publicUrl,
          size: file.metadata?.size,
          createdAt: file.created_at
        };
      });

    res.json({
      success: true,
      count: images.length,
      images
    });

  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ error: 'Failed to list images', details: error.message });
  }
});

// Get single image info
app.get('/api/images/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const filePath = `images/${id}`;

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    res.json({
      success: true,
      image: {
        id,
        path: filePath,
        url: urlData.publicUrl
      }
    });

  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({ error: 'Failed to get image', details: error.message });
  }
});

// Delete image
app.delete('/api/images/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const filePath = `images/${id}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .remove([filePath]);

    if (error) {
      console.error('Delete error:', error);
      return res.status(500).json({ error: 'Failed to delete image', details: error.message });
    }

    res.json({
      success: true,
      message: 'Image deleted successfully'
    });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete image', details: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
  });
});

// Serve library page
app.get('/library', (req, res) => {
  res.sendFile(path.join(__dirname, '../library.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║           Image Library Server Started                 ║
╠════════════════════════════════════════════════════════╣
║  Server:     http://localhost:${PORT}                     ║
║  Library:    http://localhost:${PORT}/library             ║
║  API:        http://localhost:${PORT}/api                 ║
╠════════════════════════════════════════════════════════╣
║  Endpoints:                                            ║
║  POST   /api/upload          - Upload single image     ║
║  POST   /api/upload-multiple - Upload multiple images  ║
║  GET    /api/images          - List all images         ║
║  GET    /api/images/:id      - Get image info          ║
║  DELETE /api/images/:id      - Delete image            ║
║  GET    /api/health          - Health check            ║
╚════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
