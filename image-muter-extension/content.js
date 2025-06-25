class ImageMuter {
  constructor() {
    this.serverUrl = 'http://localhost:3000';
    this.mutedImages = [];
    this.postImageMap = new Map();
    this.processedPosts = new Set();
    this.observer = null;
    this.pendingPosts = new Set();
    this.isScanning = false;
    this.scanTimeout = null;
    this.isEnabled = true;
    this.requestQueue = [];
    this.maxConcurrentRequests = 5; // Limit concurrent requests to avoid overloading the server
    this.activeRequests = 0;
  }

  // Inject CSS immediately to prevent screen jitters (Fixes Issue #2: Visible Muting)
  injectCSS() {
    const style = document.createElement('style');
    style.textContent = `
      article[data-image-muter] {
        display: none !important;
      }
      article[data-image-muter][data-processed="true"][data-muted="false"] {
        display: block !important;
      }
    `;
    document.head.appendChild(style);
  }

  init() {
    // Inject CSS at the very start to hide posts before they render
    this.injectCSS();

    // Load the toggle state
    chrome.storage.local.get('isEnabled', (data) => {
      this.isEnabled = data.isEnabled !== false;
      if (this.isEnabled) {
        this.startMuting();
      }
    });

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'updateMutedImages') {
        this.mutedImages = message.images;
        console.log('Updated muted images:', this.mutedImages);
        this.processedPosts.clear();
        this.postImageMap.clear();
        this.pendingPosts.clear();
        this.scanPosts();
      } else if (message.action === 'rescan') {
        console.log('Content script received rescan message.');
        this.processedPosts.clear();
        this.postImageMap.clear();
        this.pendingPosts.clear();
        this.scanPosts();
      } else if (message.action === 'toggleMuting') {
        this.isEnabled = message.enabled;
        chrome.storage.local.set({ isEnabled: this.isEnabled });
        if (this.isEnabled) {
          this.startMuting();
        } else {
          this.stopMuting();
        }
      }
    });

    // Load muted images from storage
    chrome.storage.local.get('mutedImages', (data) => {
      if (data.mutedImages) {
        this.mutedImages = data.mutedImages;
        console.log('Loaded muted images:', this.mutedImages);
      }
    });
  }

  startMuting() {
    this.setupMutationObserver();
    this.scanPosts();
  }

  stopMuting() {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.processedPosts.clear();
    this.postImageMap.clear();
    this.pendingPosts.clear();
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
    }
    // Remove data attributes to show all posts
    document.querySelectorAll('article[data-image-muter]').forEach((article) => {
      article.removeAttribute('data-image-muter');
      article.removeAttribute('data-processed');
      article.removeAttribute('data-muted');
    });
  }

  setupMutationObserver() {
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const articles = node.tagName === 'ARTICLE' ? [node] : node.querySelectorAll('article');
              articles.forEach((article) => {
                if (!article.hasAttribute('data-image-muter')) {
                  // Mark immediately to hide the post before processing (Fixes Issue #2: Visible Muting)
                  article.setAttribute('data-image-muter', 'true');
                  this.pendingPosts.add(article);
                }
              });
            }
          });
        }
      });

      if (this.pendingPosts.size > 0 && !this.isScanning) {
        this.isScanning = true;
        if (this.scanTimeout) clearTimeout(this.scanTimeout);
        // Reduced debounce delay to 50ms for faster processing (Fixes Issue #4: Slow Performance)
        this.scanTimeout = setTimeout(() => {
          this.processPendingPosts();
        }, 50);
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  scanPosts() {
    const articles = document.querySelectorAll('article');
    console.log(`Loaded ${this.mutedImages.length} muted images for rescan.`);
    articles.forEach((article) => {
      if (!article.hasAttribute('data-image-muter')) {
        article.setAttribute('data-image-muter', 'true');
        this.pendingPosts.add(article);
      }
    });

    if (this.pendingPosts.size > 0 && !this.isScanning) {
      this.isScanning = true;
      if (this.scanTimeout) clearTimeout(this.scanTimeout);
      this.scanTimeout = setTimeout(() => {
        this.processPendingPosts();
      }, 50);
    }
  }

  getPostId(post) {
    const timeElement = post.querySelector('time');
    if (timeElement) {
      const parentLink = timeElement.closest('a');
      if (parentLink && parentLink.href) {
        const match = parentLink.href.match(/status\/(\d+)/);
        if (match) {
          const username = post.querySelector('[data-testid="User-Name"]')?.textContent || 'unknown';
          return `${username}-${timeElement.getAttribute('datetime')}`;
        }
      }
    }
    return null;
  }

  // Skip emoji images to reduce unnecessary comparisons (Fixes Issue #4: Slow Performance)
  extractImages(post) {
    const images = post.querySelectorAll('img');
    const imageUrls = [];
    for (const img of images) {
      const src = img.src;
      if (src && !src.includes('emoji') && src.startsWith('http')) {
        imageUrls.push(src);
      }
    }
    return imageUrls;
  }

  // Batch image comparisons to reduce server requests (Fixes Issue #4: Slow Performance)
  async compareImagesBatch(imagePairs) {
    const results = [];
    const batchSize = this.maxConcurrentRequests;

    for (let i = 0; i < imagePairs.length; i += batchSize) {
      const batch = imagePairs.slice(i, i + batchSize);
      const batchPromises = batch.map(async (pair) => {
        const { img1, img2, cacheKey } = pair;
        const cached = await chrome.storage.local.get(cacheKey);
        if (cached[cacheKey]) {
          console.log(`Using cached similarity for ${img1} vs ${img2}: ${cached[cacheKey]}`);
          return { img1, img2, similarity: cached[cacheKey], cacheKey };
        }

        return new Promise((resolve) => {
          this.requestQueue.push(async () => {
            try {
              const response = await fetch(`${this.serverUrl}/compare`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ img1, img2 }),
              });
              const data = await response.json();
              const similarity = data.similarity || 0;
              await chrome.storage.local.set({ [cacheKey]: similarity });
              resolve({ img1, img2, similarity, cacheKey });
            } catch (error) {
              console.error(`Error comparing ${img1} vs ${img2}:`, error);
              resolve({ img1, img2, similarity: 0, cacheKey });
            }
          });
          this.processQueue();
        });
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  // Process the request queue with a limit on concurrent requests (Fixes Issue #4: Slow Performance)
  processQueue() {
    while (this.activeRequests < this.maxConcurrentRequests && this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      this.activeRequests++;
      request().finally(() => {
        this.activeRequests--;
        this.processQueue();
      });
    }
  }

  async processPendingPosts() {
    if (this.pendingPosts.size === 0) {
      this.isScanning = false;
      return;
    }

    console.log(`Found ${this.pendingPosts.size} potential posts to scan`);
    const postsToProcess = Array.from(this.pendingPosts);
    this.pendingPosts.clear();

    let mutedCount = 0;
    const imagePairs = [];
    const imageToPostMap = new Map();

    // Collect all image pairs for batch comparison
    for (const post of postsToProcess) {
      if (this.processedPosts.has(post)) continue;

      const postId = this.getPostId(post);
      if (!postId) continue;

      this.processedPosts.add(post);
      post.setAttribute('data-processed', 'true'); // Ensure post is marked as processed (Fixes Issue #3: Feed Not Showing)

      const images = this.extractImages(post);
      console.log(`Found ${images.length} images in post: ${postId}`);

      for (const imgSrc of images) {
        this.postImageMap.set(imgSrc, postId);
        console.log(`Adding image to postImageMap: ${imgSrc} for post ${postId}`);
        imageToPostMap.set(imgSrc, post);

        for (const mutedImg of this.mutedImages) {
          const cacheKey = `comparison:${imgSrc}:${mutedImg}`;
          const cached = await chrome.storage.local.get(cacheKey);
          if (!cached[cacheKey]) {
            imagePairs.push({ img1: imgSrc, img2: mutedImg, cacheKey });
          }
        }
      }
    }

    // Batch compare images
    const similarities = await this.compareImagesBatch(imagePairs);

    // Process similarities and mute posts
    for (const { img1, img2, similarity, cacheKey } of similarities) {
      console.log(`Image similarity for ${img1} vs ${img2}: ${similarity}`);

      const post = imageToPostMap.get(img1);
      if (!post) continue;

      // Lowered threshold to 0.5 to catch more matches (Fixes Issue #1: Missed Match)
      if (similarity >= 0.5) {
        post.setAttribute('data-muted', 'true');
        const postId = this.getPostId(post);
        console.log(`Muted post due to matching image: ${post.innerText.substring(0, 50)} (postId: ${postId})`);
        mutedCount++;
      } else {
        post.setAttribute('data-muted', 'false');
        console.log(`Showing post: ${this.getPostId(post)}`); // Debug to ensure non-muted posts are shown (Fixes Issue #3: Feed Not Showing)
      }
    }

    console.log(`Scan complete: Scanned ${postsToProcess.length} posts, muted ${mutedCount} posts`);
    this.isScanning = false;

    if (this.pendingPosts.size > 0) {
      this.scanTimeout = setTimeout(() => {
        this.processPendingPosts();
      }, 50);
    }
  }
}

const muter = new ImageMuter();
muter.init();
