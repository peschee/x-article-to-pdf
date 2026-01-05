document.getElementById("open-browser").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.runtime.sendMessage({
        action: "executeScript",
        tabId: tabs[0].id,
        mode: "browser",
      });
      window.close();
    }
  });
});

document.getElementById("download-html").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.runtime.sendMessage({
        action: "executeScript",
        tabId: tabs[0].id,
        mode: "download",
      });
      window.close();
    }
  });
});
