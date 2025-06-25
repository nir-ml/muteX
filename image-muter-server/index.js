const express = require('express');
const cors = require('cors');
const axios = require('axios');
const sharp = require('sharp');
const { imageHash } = require('image-hash');

const app = express();
app.use(cors());
app.use(express.json());

// Resize images to 256x256 for consistent hashing (Fixes Issue #1: Missed Match)
async function hashImage(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    const resizedBuffer = await sharp(buffer)
      .resize(256, 256, { fit: 'fill' })
      .toBuffer();
    return new Promise((resolve, reject) => {
      imageHash({ data: resizedBuffer }, 16, true, (err, hash) => {
        if (err) reject(err);
        else resolve(hash);
      });
    });
  } catch (error) {
    console.error(`Error hashing image ${url}:`, error.message);
    return null;
  }
}

function hammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return 1;
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  return distance / hash1.length;
}

app.post('/compare', async (req, res) => {
  console.log('Received request at /compare');
  const { img1, img2 } = req.body;
  try {
    const hash1 = await hashImage(img1);
    const hash2 = await hashImage(img2);
    const distance = hammingDistance(hash1, hash2);
    const similarity = 1 - distance;
    res.json({ similarity });
  } catch (error) {
    console.error('Error comparing images:', error.message);
    res.status(500).json({ similarity: 0 });
  }
});

// Batch comparison endpoint (Fixes Issue #4: Slow Performance)
app.post('/compareBatch', async (req, res) => {
  console.log('Received request at /compareBatch');
  const { pairs } = req.body;
  const results = [];

  for (const pair of pairs) {
    const { img1, img2, cacheKey } = pair;
    try {
      const hash1 = await hashImage(img1);
      const hash2 = await hashImage(img2);
      const distance = hammingDistance(hash1, hash2);
      const similarity = 1 - distance;
      results.push({ img1, img2, similarity, cacheKey });
    } catch (error) {
      console.error(`Error comparing ${img1} and ${img2}:`, error.message);
      results.push({ img1, img2, similarity: 0, cacheKey });
    }
  }

  res.json({ results });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
