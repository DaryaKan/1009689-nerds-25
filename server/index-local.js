/**
 * Image Library Server - LOCAL STORAGE VERSION
 * Работает без Supabase, сохраняет файлы локально
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Create uploads directory
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  }
});

// ============ API ROUTES ============

// Upload single image
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const file = req.file;
    const imageData = {
      id: file.filename,
      path: file.filename,
      url: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`,
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

    const uploadedImages = req.files.map(file => ({
      id: file.filename,
      path: file.filename,
      url: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      uploadedAt: new Date().toISOString()
    }));

    res.json({
      success: true,
      message: `Uploaded ${uploadedImages.length} images`,
      images: uploadedImages
    });

  } catch (error) {
    console.error('Multiple upload error:', error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Get all images
app.get('/api/images', async (req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    
    const images = files
      .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
      .map(file => {
        const filePath = path.join(UPLOADS_DIR, file);
        const stats = fs.statSync(filePath);
        
        return {
          id: file,
          path: file,
          url: `${req.protocol}://${req.get('host')}/uploads/${file}`,
          size: stats.size,
          createdAt: stats.birthtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

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
    const filePath = path.join(UPLOADS_DIR, id);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.json({
      success: true,
      image: {
        id,
        path: id,
        url: `${req.protocol}://${req.get('host')}/uploads/${id}`
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
    const filePath = path.join(UPLOADS_DIR, id);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    fs.unlinkSync(filePath);

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
    mode: 'local',
    timestamp: new Date().toISOString()
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
║       Image Library Server (LOCAL MODE)                ║
╠════════════════════════════════════════════════════════╣
║  Server:     http://localhost:${PORT}                     ║
║  Library:    http://localhost:${PORT}/library             ║
║  Uploads:    ./server/uploads/                         ║
╠════════════════════════════════════════════════════════╣
║  Работает без Supabase — файлы хранятся локально       ║
╚════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
