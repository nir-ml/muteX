class ImageMuter {
  constructor() {
    this.mutedImages = [];
    this.processedPosts = new Set();
    this.isScanning = false;
    this.scanTimeout = null;
    this.serverUrl = 'http://localhost:3000';
    this.isMutating = false; // New flag to prevent recursive mutations
    this.init();
  }

  async init() {
    const { mutedImages } = await chrome.storage.local.get('mutedImages');
    this.mutedImages = mutedImages || [];
    this.observePage();
    this.scanPage();

    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'rescan') {
        this.processedPosts.clear();
        chrome.storage.local.get(['mutedImages'], (result) => {
          this.mutedImages = result.mutedImages || [];
          this.scanPage();
        });
      }
    });
  }

  observePage() {
    const observer = new MutationObserver((mutations) => {
      if (this.isMutating) {
        console.log('Skipping mutation observation due to ongoing mutation');
        return;
      }

      if (this.scanTimeout) {
        clearTimeout(this.scanTimeout);
      }
      this.scanTimeout = setTimeout(() => {
        if (!this.isScanning) {
          this.scanPage();
        }
      }, 300);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });
  }

  async scanPage() {
    if (this.isScanning || !this.mutedImages.length) {
      this.updatePopupStatus('No images to scan or already scanning');
      return;
    }

    this.isScanning = true;
    this.updatePopupStatus('Starting scan...');
    const startTime = performance.now();

    // Narrow down the selector to target only individual tweets
    const posts = document.querySelectorAll('article[data-testid="tweet"]');
    let postsScanned = 0;
    let postsMuted = 0;

    console.log(`Found ${posts.length} potential posts to scan`);

    const imageTasks = [];
    const postImageMap = new Map();

    // Step 1: Collect image URLs and map them to posts
    for (const post of posts) {
      const postId = post.innerText.slice(0, 50); // Use a unique identifier for the post
      if (this.processedPosts.has(postId)) {
        console.log(`Skipping already processed post: ${postId}`);
        continue;
      }

      // Exclude profile images and only target media images in the tweet
      const images = post.querySelectorAll('img[src*="/media/"], img[src*=".jpg"], img[src*=".png"], img[src*=".jpeg"]:not([src*="/profile_images/"])');
      console.log(`Found ${images.length} images in post: ${postId}`);

      for (const img of images) {
        if (!img.src) {
          console.log(`Image in post ${postId} has no src, skipping`);
          continue;
        }

        if (img.complete && img.naturalWidth) {
          const src = img.src;
          console.log(`Adding image to postImageMap: ${src}`);
          imageTasks.push({ src, postId });
          postImageMap.set(src, post);
        } else {
          console.log(`Image not loaded yet, will catch in next scan: ${img.src}`);
        }
      }

      this.processedPosts.add(postId);
      postsScanned++;
    }

    if (imageTasks.length > 0) {
      // Step 2: Prepare image pairs for comparison
      const imagePairs = [];
      for (const { src, postId } of imageTasks) {
        for (const mutedImgData of this.mutedImages) {
          imagePairs.push({ image1Url: mutedImgData, image2Url: src, postId });
        }
      }

      // Step 3: Send image pairs to the server and process results
      try {
        const results = await this.compareImagesBatch(imagePairs);

        for (const { image1Url, image2Url, similarity, error, postId } of results) {
          if (error) {
            console.error(`Error comparing images for post ${postId}: ${error}`);
            continue;
          }
          console.log(`Image similarity for ${image2Url}: ${similarity}`);
          if (similarity >= 0.4) {
            console.log(`Looking up post for image: ${image2Url}`);
            const post = postImageMap.get(image2Url);
            if (post) {
              this.mutePost(post);
              postsMuted++;
              console.log(`Muted post due to matching image: ${post.innerText.slice(0, 50)}`);
            } else {
              console.error(`Post not found for image: ${image2Url}`);
            }
          }
        }
      } catch (error) {
        console.error('Failed to compare images:', error);
      }
    }

    const endTime = performance.now();
    console.log(`Scan completed in ${endTime - startTime}ms`);

    this.updatePopupStatus(`Scan complete: Scanned ${postsScanned} posts, muted ${postsMuted} posts`);
    this.isScanning = false;
  }

  async compareImagesBatch(imagePairs) {
    try {
      const response = await fetch(`${this.serverUrl}/compare-images-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePairs }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const results = await response.json();
      return results;
    } catch (error) {
      console.error('Server batch comparison error:', error);
      throw error;
    }
  }

  mutePost(post) {
    // Safeguard: Check if the post is a tweet and not a parent container
    if (!post.closest('article[data-testid="tweet"]')) {
      console.warn('Attempted to mute a non-tweet element, skipping:', post);
      return;
    }

    this.isMutating = true; // Set flag to prevent recursive mutations
    post.style.display = 'none';
    console.log('Muted post:', post.innerText.slice(0, 50));
    this.isMutating = false; // Reset flag
  }

  updatePopupStatus(message) {
    try {
      chrome.runtime.sendMessage({ status: message }, (response) => {
        if (chrome.runtime.lastError) {
          console.log(`Popup not open, skipping status update: ${message}`);
        } else {
          console.log(`Popup status updated: ${message}`);
        }
      });
    } catch (error) {
      console.error('Error sending message to popup:', error);
    }
  }
}

new ImageMuter();