document.addEventListener('DOMContentLoaded', () => {
  const keywordInput = document.getElementById('keywordInput');
  const fetchImagesButton = document.getElementById('fetchImages');
  const muteButton = document.getElementById('muteButton');
  const fetchedImagesDiv = document.getElementById('fetchedImages');
  const statusDiv = document.getElementById('status');

  let fetchedImageUrls = [];

  // Replace with your Google Custom Search API key and CSE ID
  const GOOGLE_API_KEY = '';
  const GOOGLE_CSE_ID = '';

  fetchImagesButton.addEventListener('click', async () => {
    const keyword = keywordInput.value.trim();
    if (!keyword) {
      statusDiv.textContent = 'Please enter a keyword.';
      return;
    }

    statusDiv.textContent = 'Fetching images...';
    fetchedImagesDiv.innerHTML = '';
    muteButton.disabled = true;
    fetchedImageUrls = [];

    try {
      const response = await fetch(
        `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(keyword)}&searchType=image&num=5`
      );
      const data = await response.json();

      if (data.items && data.items.length > 0) {
        fetchedImageUrls = data.items.map(item => item.link);
        fetchedImageUrls.forEach((url, index) => {
          const div = document.createElement('div');
          div.className = 'image-preview';
          div.innerHTML = `
            <img src="${url}" alt="Fetched image ${index + 1}" />
            <input type="checkbox" checked data-url="${url}" />
            <span>Image ${index + 1}</span>
          `;
          fetchedImagesDiv.appendChild(div);
        });
        muteButton.disabled = false;
        statusDiv.textContent = `Fetched ${fetchedImageUrls.length} images. Select images to mute and click "Mute Posts".`;
      } else {
        statusDiv.textContent = 'No images found for this keyword.';
      }
    } catch (error) {
      console.error('Error fetching images:', error);
      statusDiv.textContent = 'Error fetching images. Check the console for details.';
    }
  });

  muteButton.addEventListener('click', () => {
    const selectedImages = Array.from(fetchedImagesDiv.querySelectorAll('input[type="checkbox"]:checked'))
      .map(checkbox => checkbox.dataset.url);
  
    if (selectedImages.length === 0) {
      statusDiv.textContent = 'Please select at least one image to mute.';
      return;
    }
  
    chrome.storage.local.set({ mutedImages: selectedImages }, () => {
      statusDiv.textContent = 'Images saved. Scanning feed...';
  
      // Send the rescan message via the background script
      const sendRescanMessage = (attempt = 1, maxAttempts = 3) => {
        if (!chrome.runtime?.id) {
          statusDiv.textContent = 'Extension context invalidated. Please reload the extension and try again.';
          console.error('Extension context invalidated. Cannot send rescan message.');
          return;
        }
  
        chrome.runtime.sendMessage({ action: 'rescan' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(`Attempt ${attempt} failed: ${chrome.runtime.lastError.message}`);
            if (attempt < maxAttempts) {
              console.log(`Retrying rescan message (attempt ${attempt + 1}/${maxAttempts})...`);
              setTimeout(() => sendRescanMessage(attempt + 1, maxAttempts), 500);
            } else {
              statusDiv.textContent = 'Error triggering rescan after multiple attempts. Please reload the extension.';
              console.error('Max attempts reached. Could not trigger rescan.');
            }
          } else if (response.status === 'error') {
            statusDiv.textContent = `Error: ${response.message}`;
            console.error(`Rescan failed: ${response.message}`);
          } else {
            statusDiv.textContent = 'Rescan triggered. Check the feed.';
            console.log('Rescan message sent successfully.');
          }
        });
      };
  
      sendRescanMessage();
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.status) {
      statusDiv.textContent = message.status;
    }
  });
});
