const express = require('express');
const cors = require('cors');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Placeholder for image comparison logic
async function compareImages(img1, img2) {
  // This is a placeholder. Replace with actual image comparison logic.
  // For now, return a random similarity score for testing.
  console.log(`Comparing images: ${img1} vs ${img2}`);
  return Math.random();
}

// Existing endpoint for batch comparisons
app.post('/compare-images-batch', async (req, res) => {
  console.log('Received request at /compare-images-batch');
  console.log('Parsed body imagePairs length:', req.body.imagePairs?.length);

  const { imagePairs } = req.body;
  if (!imagePairs || !Array.isArray(imagePairs)) {
    console.log('Invalid imagePairs:', imagePairs);
    return res.status(400).json({ error: 'imagePairs must be an array' });
  }

  try {
    const results = await Promise.all(
      imagePairs.map(async (pair) => {
        const { img1, img2 } = pair;
        if (!img1 || !img2) {
          return { img1, img2, similarity: 0, error: 'Missing image URL' };
        }
        const similarity = await compareImages(img1, img2);
        return { img1, img2, similarity };
      })
    );
    res.json({ results });
  } catch (error) {
    console.error('Error in batch comparison:', error);
    res.status(500).json({ error: 'Failed to compare images' });
  }
});

// New endpoint for single image comparison
app.post('/compare', async (req, res) => {
  console.log('Received request at /compare');
  const { img1, img2 } = req.body;

  if (!img1 || !img2) {
    console.log('Invalid request body:', req.body);
    return res.status(400).json({ error: 'img1 and img2 are required' });
  }

  try {
    const similarity = await compareImages(img1, img2);
    res.json({ similarity });
  } catch (error) {
    console.error('Error comparing images:', error);
    res.status(500).json({ error: 'Failed to compare images' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});