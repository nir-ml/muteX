const express = require('express');
const axios = require('axios');
const sharp = require('sharp');
const cors = require('cors');

const app = express();
app.use(cors());

// Increase payload limit to 50mb to handle large data URLs
app.use(express.raw({ type: 'application/json', limit: '50mb' }));

// Middleware to parse JSON
app.use((req, res, next) => {
  console.log('Raw request body length:', req.body.length);
  console.log('Raw request body (first 100 chars):', req.body.toString().slice(0, 100));
  try {
    req.body = JSON.parse(req.body.toString());
    next();
  } catch (error) {
    console.error('JSON parsing error:', error.message);
    res.status(400).json({ error: 'Invalid JSON payload' });
  }
});

app.post('/compare-images-batch', async (req, res) => {
  console.log('Received request at /compare-images-batch');
  console.log('Parsed body imagePairs length:', req.body.imagePairs?.length);

  const { imagePairs } = req.body;
  if (!imagePairs || !Array.isArray(imagePairs)) {
    console.log('Invalid imagePairs:', imagePairs);
    return res.status(400).json({ error: 'imagePairs must be an array' });
  }

  const results = await Promise.all(
    imagePairs.map(async ({ image1Url, image2Url }) => {
      try {
        console.log(`Comparing images: ${image1Url.slice(0, 50)}... and ${image2Url.slice(0, 50)}...`);
        const image1Response = await axios.get(image1Url, {
          responseType: 'arraybuffer',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
          timeout: 10000
        });
        const image2Response = await axios.get(image2Url, {
          responseType: 'arraybuffer',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
          timeout: 10000
        });

        const image1 = await sharp(image1Response.data).normalize().resize(100, 100).grayscale().raw().toBuffer();
        const image2 = await sharp(image2Response.data).normalize().resize(100, 100).grayscale().raw().toBuffer();

        let diff = 0;
        for (let i = 0; i < image1.length; i++) {
          diff += Math.abs(image1[i] - image2[i]);
        }

        const maxDiff = 100 * 100 * 255;
        const similarity = 1 - (diff / maxDiff);

        return { image1Url, image2Url, similarity };
      } catch (error) {
        console.error('Server comparison error:', error.message);
        return { image1Url, image2Url, error: 'Failed to compare images' };
      }
    })
  );

  res.json(results);
});

const PORT = 3000;
app.listen(PORT, 'localhost', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});