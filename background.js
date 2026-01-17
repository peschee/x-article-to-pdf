// Store the selected mode for the content script to read
let currentMode = "browser";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle request from popup to execute script
  if (message.action === "executeScript") {
    currentMode = message.mode;
    chrome.storage.session.set({ currentMode: message.mode }, () => {
      chrome.scripting.executeScript({
        target: { tabId: message.tabId },
        files: ["contentScript.js"],
      });
    });
    return;
  }

  // Handle request from content script to get mode
  if (message.action === "getMode") {
    chrome.storage.session.get("currentMode", (result) => {
      sendResponse({ mode: result.currentMode || currentMode });
    });
    return true;
  }

  // Handle download request from content script
  if (message.action === "downloadHtml") {
    const dataUrl =
      "data:text/html;charset=utf-8," + encodeURIComponent(message.html);

    chrome.downloads.download({
      url: dataUrl,
      filename: message.filename,
      saveAs: true,
    });
  }
});
