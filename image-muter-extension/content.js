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
  }

  // Initialize the extension
  init() {
    // Inject CSS to hide posts by default
    this.injectCSS();
    // Load muted images and start observing
    this.loadMutedImages().then(() => {
      console.log(`Loaded ${this.mutedImages.length} muted images for rescan.`);
      this.setupMutationObserver();
      this.scanInitialPosts();
    });

    // Listen for rescan messages from the popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'rescan') {
        console.log('Content script received rescan message.');
        this.loadMutedImages().then(() => {
          console.log(`Loaded ${this.mutedImages.length} muted images for rescan.`);
          this.processedPosts.clear(); // Reset processed posts for a fresh scan
          this.scanInitialPosts();
        });
      }
    });
  }

  // Inject CSS to hide posts by default
  injectCSS() {
    const style = document.createElement('style');
    style.textContent = `
      article[data-image-muter] {
        display: none !important;
      }
      article[data-image-muter][data-processed="false"] {
        display: none !important;
      }
      article[data-image-muter][data-processed="true"][data-muted="false"] {
        display: block !important;
      }
    `;
    document.head.appendChild(style);
  }

  // Load muted images from storage
  async loadMutedImages() {
    const data = await chrome.storage.local.get('mutedImages');
    this.mutedImages = data.mutedImages || [];
  }

  // Scan posts already present in the DOM on initial load
  scanInitialPosts() {
    const articles = document.querySelectorAll('article');
    articles.forEach((article) => {
      if (!article.dataset.imageMuter) {
        article.dataset.imageMuter = 'true';
        article.dataset.processed = 'false';
        article.dataset.muted = 'false';
        this.pendingPosts.add(article);
      }
    });
    this.debounceScan();
  }

  // Set up MutationObserver to watch for new posts
  setupMutationObserver() {
    const targetNode = document.querySelector('main[role="main"]') || document.body;
    if (!targetNode) {
      console.error('Could not find main content area to observe.');
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const articles = node.querySelectorAll('article') || [];
            articles.forEach((article) => {
              if (!article.dataset.imageMuter) {
                article.dataset.imageMuter = 'true';
                article.dataset.processed = 'false';
                article.dataset.muted = 'false';
                this.pendingPosts.add(article);
              }
            });
          }
        });
      });
      this.debounceScan();
    });

    this.observer.observe(targetNode, {
      childList: true,
      subtree: true,
    });
  }

  // Debounce the scanning process to avoid performance issues
  debounceScan() {
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
    }
    this.scanTimeout = setTimeout(() => {
      this.processPendingPosts();
    }, 100); // Adjust delay as needed
  }

  // Process pending posts in batches
  async processPendingPosts() {
    if (this.pendingPosts.size === 0 || this.mutedImages.length === 0) {
      this.isScanning = false;
      return;
    }

    this.isScanning = true;
    const postsToProcess = Array.from(this.pendingPosts);
    this.pendingPosts.clear();

    console.log(`Found ${postsToProcess.length} potential posts to scan`);

    const startTime = performance.now();

    // Build postImageMap for the batch
    for (const post of postsToProcess) {
      const postId = this.getPostId(post);
      if (!postId || this.processedPosts.has(postId)) {
        if (this.processedPosts.has(postId)) {
          post.dataset.processed = 'true';
          post.dataset.muted = post.dataset.wasMuted || 'false';
        }
        continue;
      }

      const images = Array.from(post.querySelectorAll('img'))
        .map((img) => img.src)
        .filter((src) => src && !src.includes('profile_images'));
      console.log(`Found ${images.length} images in post: ${postId}`);

      if (images.length > 0) {
        images.forEach((imgSrc) => {
          this.postImageMap.set(imgSrc, postId);
          console.log(`Adding image to postImageMap: ${imgSrc} for post ${postId}`);
        });
      }
    }

    // Compare images and decide whether to mute
    let mutedCount = 0;
    for (const [imgSrc, postId] of this.postImageMap) {
      let shouldMute = false;
      for (const mutedImg of this.mutedImages) {
        const similarity = await this.compareImages(imgSrc, mutedImg);
        console.log(`Image similarity for ${imgSrc} in post ${postId}: ${similarity}`);
        if (similarity >= 0.85) { // Adjusted threshold for better accuracy
          shouldMute = true;
          console.log(`Looking up post for image: ${imgSrc}`);
          break;
        }
      }

      const postElement = postsToProcess.find((post) => this.getPostId(post) === postId);
      if (postElement) {
        this.processedPosts.add(postId);
        postElement.dataset.processed = 'true';
        if (shouldMute) {
          postElement.dataset.muted = 'true';
          postElement.dataset.wasMuted = 'true';
          mutedCount++;
          console.log(`Muted post due to matching image: ${this.getPostText(postElement)} (postId: ${postId})`);
        } else {
          postElement.dataset.muted = 'false';
          postElement.dataset.wasMuted = 'false';
        }
      }
    }

    this.postImageMap.clear();
    const duration = performance.now() - startTime;
    console.log(`Scan completed in ${duration}ms`);
    this.updatePopupStatus(`Scan complete: Scanned ${postsToProcess.length} posts, muted ${mutedCount} posts`);
    this.isScanning = false;

    // Continue processing if more posts were added during the scan
    if (this.pendingPosts.size > 0) {
      this.debounceScan();
    }
  }

  // Get a unique identifier for a post
  getPostId(postElement) {
    const timeElement = postElement.querySelector('time');
    if (!timeElement) return null;
    const datetime = timeElement.getAttribute('datetime');
    const usernameElement = postElement.querySelector('a[href*="/"]');
    const username = usernameElement ? usernameElement.getAttribute('href').split('/')[1] : 'unknown';
    return `${username}-${datetime}`;
  }

  // Get the text content of a post
  getPostText(postElement) {
    const textElement = postElement.querySelector('div[lang]');
    return textElement ? textElement.textContent.trim() : 'Unknown post content';
  }

  // Compare two images by sending them to the server
  async compareImages(img1Src, img2Src) {
    const cacheKey = `comparison:${img1Src}:${img2Src}`;
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached[cacheKey]) {
      console.log(`Using cached similarity for ${img1Src} vs ${img2Src}: ${cached[cacheKey]}`);
      return cached[cacheKey];
    }

    try {
      const response = await fetch(`${this.serverUrl}/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ img1: img1Src, img2: img2Src }),
      });
      const data = await response.json();
      const similarity = data.similarity || 0;
      await chrome.storage.local.set({ [cacheKey]: similarity });
      return similarity;
    } catch (error) {
      console.error('Error comparing images:', error);
      return 0;
    }
  }

  // Update the popup with the current status
  updatePopupStatus(message) {
    chrome.runtime.sendMessage({ action: 'updateStatus', status: message }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Popup not open or context invalidated, skipping status update:', message);
      }
    });
  }
}

const imageMuter = new ImageMuter();
imageMuter.init();