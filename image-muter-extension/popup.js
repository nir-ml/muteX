document.addEventListener('DOMContentLoaded', () => {
  const imageInput = document.getElementById('imageInput');
  const uploadButton = document.getElementById('uploadButton');
  const imagePreview = document.getElementById('imagePreview');
  const removeButton = document.getElementById('removeButton');
  const statusDiv = document.getElementById('status');

  // Load existing muted images
  chrome.storage.local.get(['mutedImages'], (result) => {
    const mutedImages = result.mutedImages || [];
    if (mutedImages.length > 0) {
      mutedImages.forEach((imageData) => {
        const img = document.createElement('img');
        img.src = imageData;
        imagePreview.appendChild(img);
      });
      removeButton.style.display = 'block';
    }
  });

  // Update status
  chrome.runtime.onMessage.addListener((message) => {
    if (message.status) {
      statusDiv.textContent = message.status;
    }
  });

  // Handle image upload
  uploadButton.addEventListener('click', () => {
    const file = imageInput.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageData = e.target.result;
        chrome.storage.local.get(['mutedImages'], (result) => {
          const mutedImages = result.mutedImages || [];
          mutedImages.push(imageData);
          chrome.storage.local.set({ mutedImages }, () => {
            const img = document.createElement('img');
            img.src = imageData;
            imagePreview.appendChild(img);
            removeButton.style.display = 'block';
            chrome.runtime.sendMessage({ action: 'rescan' });
          });
        });
      };
      reader.readAsDataURL(file);
    }
  });

  // Handle image removal
  removeButton.addEventListener('click', () => {
    chrome.storage.local.set({ mutedImages: [] }, () => {
      imagePreview.innerHTML = '';
      removeButton.style.display = 'none';
      chrome.runtime.sendMessage({ action: 'rescan' });
    });
  });
});