class ImageMuter {
  constructor() {
    this.mutedImages = [];
    this.processedPosts = new Set();
    this.isScanning = false;
    this.scanTimeout = null;
    this.serverUrl = 'http://localhost:3000';
    this.isMuting = false;
    this.postImageMap = new Map();
    this.init();
  }

  async init() {
    // Load muted images and processed posts from storage
    const { mutedImages, processedPosts } = await chrome.storage.local.get(['mutedImages', 'processedPosts']);
    this.mutedImages = mutedImages || [];
    this.processedPosts = new Set(processedPosts || []);
    console.log(`Initialized with ${this.mutedImages.length} muted images and ${this.processedPosts.size} processed posts.`);

    this.observePage();
    this.scanPage();

    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'rescan') {
        console.log('Content script received rescan message.');
        this.processedPosts.clear();
        chrome.storage.local.set({ processedPosts: [] }, () => {
          chrome.storage.local.get(['mutedImages'], (result) => {
            this.mutedImages = result.mutedImages || [];
            console.log(`Loaded ${this.mutedImages.length} muted images for rescan.`);
            this.scanPage();
          });
        });
        sendResponse({ status: 'success', message: 'Rescan initiated.' });
      }
    });
  }

  observePage() {
    const observer = new MutationObserver((mutations) => {
      if (this.scanTimeout) clearTimeout(this.scanTimeout);
      this.scanTimeout = setTimeout(() => this.scanPage(), 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  async scanPage() {
    if (this.isScanning) {
      this.sendStatusUpdate('No images to scan or already scanning');
      return;
    }

    this.isScanning = true;
    this.sendStatusUpdate('Starting scan...');
    const startTime = performance.now();

    const posts = Array.from(document.querySelectorAll('article[role="article"]'));
    console.log(`Found ${posts.length} potential posts to scan`);

    let mutedCount = 0;

    for (const post of posts) {
      const postId = this.getPostId(post);
      if (!postId || this.processedPosts.has(postId)) {
        if (this.processedPosts.has(postId)) {
          console.log(`Skipping already processed post: ${postId}`);
        }
        continue;
      }

      // Handle both original posts and retweets
      const images = this.getImagesFromPost(post);
      console.log(`Found ${images.length} images in post: ${postId}`);

      if (images.length === 0) {
        this.processedPosts.add(postId);
        continue;
      }

      for (const img of images) {
        const src = img.src;
        if (!src) continue;

        console.log(`Adding image to postImageMap: ${src} for post ${postId}`);
        this.postImageMap.set(src, postId);
      }

      this.processedPosts.add(postId);
    }

    // Persist processedPosts to storage
    chrome.storage.local.set({ processedPosts: Array.from(this.processedPosts) });

    // Compare images with muted images
    for (const [imgSrc, postId] of this.postImageMap) {
      for (const mutedImg of this.mutedImages) {
        const similarity = await this.compareImages(imgSrc, mutedImg);
        console.log(`Image similarity for ${imgSrc} in post ${postId}: ${similarity}`);

        if (similarity >= 0.4) {
          console.log(`Looking up post for image: ${imgSrc}`);
          const postElement = this.getPostElementById(postId);
          if (postElement) {
            this.mutePost(postElement, postId);
            mutedCount++;
            console.log(`Muted post due to matching image: ${this.getPostText(postElement)} (postId: ${postId})`);
            break; // Stop checking other muted images for this post
          }
        }
      }
    }

    const duration = performance.now() - startTime;
    console.log(`Scan completed in ${duration}ms`);
    this.sendStatusUpdate(`Scan complete: Scanned ${posts.length} posts, muted ${mutedCount} posts`);
    this.isScanning = false;
  }

  getImagesFromPost(post) {
    // Look for images in both original posts and retweets
    const imageSelectors = [
      'img[src*="pbs.twimg.com/media"]', // Original post images
      'div[data-testid="tweetPhoto"] img', // Images in retweets
      'div[role="blockquote"] img[src*="pbs.twimg.com/media"]', // Retweet-specific images
    ];

    const images = [];
    for (const selector of imageSelectors) {
      const foundImages = post.querySelectorAll(selector);
      foundImages.forEach((img) => {
        if (img.src && !images.includes(img)) {
          images.push(img);
        }
      });
    }
    return images;
  }

  getPostId(post) {
    const timeElement = post.querySelector('time');
    if (!timeElement) return null;
    const datetime = timeElement.getAttribute('datetime');
    if (!datetime) return null;

    const usernameElement = post.querySelector('a[href*="/status/"]');
    const username = usernameElement ? usernameElement.href.split('/')[3] : 'unknown';
    return `${username}-${datetime}`;
  }

  getPostElementById(postId) {
    const posts = Array.from(document.querySelectorAll('article[role="article"]'));
    return posts.find((post) => this.getPostId(post) === postId) || null;
  }

  getPostText(post) {
    const textElement = post.querySelector('div[lang]');
    return textElement ? textElement.textContent : 'Unknown post content';
  }

  async compareImages(img1Src, img2Src) {
    try {
      const response = await fetch(`${this.serverUrl}/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ img1: img1Src, img2: img2Src }),
      });
      const data = await response.json();
      return data.similarity || 0;
    } catch (error) {
      console.error('Error comparing images:', error);
      return 0;
    }
  }

  mutePost(postElement, postId) {
    if (!this.isMuting) {
      this.isMuting = true;
      console.log(`Muted post: ${this.getPostText(postElement)}`);
      postElement.style.display = 'none';
      this.isMuting = false;
    }
  }

  sendStatusUpdate(message) {
    chrome.runtime.sendMessage({ action: 'statusUpdate', message }, (response) => {
      if (chrome.runtime.lastError) {
        console.log(`Popup not open or context invalidated, skipping status update: ${message}`);
      }
    });
  }
}

new ImageMuter();