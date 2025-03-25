// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'rescan') {
      console.log('Background script received rescan message from popup.');
  
      // Get the active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          console.error('No active tab found.');
          sendResponse({ status: 'error', message: 'No active tab found.' });
          return;
        }
  
        const tabId = tabs[0].id;
        console.log(`Sending rescan message to tab ${tabId}...`);
  
        // Send the rescan message to the content script in the active tab
        chrome.tabs.sendMessage(tabId, { action: 'rescan' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(`Failed to send rescan message to tab ${tabId}: ${chrome.runtime.lastError.message}`);
            // Attempt to inject the content script if it's not already active
            chrome.scripting.executeScript(
              {
                target: { tabId: tabId },
                files: ['content.js'],
              },
              () => {
                if (chrome.runtime.lastError) {
                  console.error(`Failed to inject content script: ${chrome.runtime.lastError.message}`);
                  sendResponse({ status: 'error', message: 'Failed to inject content script.' });
                } else {
                  console.log('Content script injected. Retrying rescan message...');
                  // Retry sending the message after injecting the script
                  chrome.tabs.sendMessage(tabId, { action: 'rescan' }, (retryResponse) => {
                    if (chrome.runtime.lastError) {
                      console.error(`Retry failed: ${chrome.runtime.lastError.message}`);
                      sendResponse({ status: 'error', message: 'Failed to trigger rescan after injecting content script.' });
                    } else {
                      console.log('Rescan message sent successfully after injection.');
                      sendResponse({ status: 'success', message: 'Rescan triggered.' });
                    }
                  });
                }
              }
            );
          } else {
            console.log('Rescan message sent successfully to content script.');
            sendResponse({ status: 'success', message: 'Rescan triggered.' });
          }
        });
      });
  
      // Keep the message channel open for async response
      return true;
    }
  });