(function () {
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeTextForDedup(str) {
    return String(str || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // Remove plain-text blocks that are just a duplicate rendering of the
  // following code block (like "python\n<same code>").
  function postprocessSegments(segments) {
    const cleaned = [];
    for (let i = 0; i < segments.length; i++) {
      const current = segments[i];
      const next = segments[i + 1];

      if (current && current.type === "text" && next && next.type === "code") {
        const textNorm = normalizeTextForDedup(current.text);

        const codeText = next.text || "";
        const lang = next.language || "";

        const codeNorm = normalizeTextForDedup(codeText);
        const langPlusCodeNewline = normalizeTextForDedup(
          lang + "\n" + codeText,
        );
        const langPlusCodeSpace = normalizeTextForDedup(lang + " " + codeText);

        if (
          textNorm === codeNorm ||
          textNorm === langPlusCodeNewline ||
          textNorm === langPlusCodeSpace
        ) {
          // Skip this text node; it's just the unformatted version of the code block.
          continue;
        }
      }

      cleaned.push(current);
    }
    return cleaned;
  }

  // Process a heading element (H1-H5) and extract text + any math content
  function processHeadingElement(el, level) {
    const segments = [];

    // Extract heading text (without KaTeX)
    const clone = el.cloneNode(true);
    const katexInHeading = clone.querySelectorAll(".katex");
    katexInHeading.forEach((n) => n.remove());
    const headingText = (clone.innerText || "").trim();

    if (headingText) {
      segments.push({
        type: "heading",
        level: level,
        text: headingText,
      });
    }

    // Extract inline math from heading
    const katexSpans = el.querySelectorAll(".katex");
    katexSpans.forEach((span) => {
      segments.push({
        type: "mathHtml",
        html: span.outerHTML,
        display: "inline",
      });
    });

    return segments;
  }

  // Extract HTML with bold/italic formatting preserved
  function extractFormattedHtml(el) {
    // Clone to avoid modifying original
    const clone = el.cloneNode(true);

    // Remove KaTeX (handled separately)
    clone.querySelectorAll(".katex").forEach((n) => n.remove());

    // Process all spans to convert inline styles to HTML tags
    const spans = Array.from(clone.querySelectorAll("span[style]"));
    spans.forEach((span) => {
      const style = span.getAttribute("style") || "";
      const isBold = style.includes("font-weight: bold");
      const isItalic = style.includes("font-style: italic");

      if (isBold || isItalic) {
        // Get inner text content
        const textNode = span.querySelector('[data-text="true"]');
        if (textNode) {
          const text = textNode.textContent;

          // Build replacement HTML with escaped text
          let html = escapeHtml(text);
          if (isBold && isItalic) {
            html = `<strong><em>${html}</em></strong>`;
          } else if (isBold) {
            html = `<strong>${html}</strong>`;
          } else if (isItalic) {
            html = `<em>${html}</em>`;
          }

          // Replace span with formatted HTML
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = html;
          span.replaceWith(...tempDiv.childNodes);
        }
      }
    });

    return clone.innerHTML.trim();
  }

  // Process a blockquote element and extract text + any math content
  function processBlockquoteElement(el) {
    const segments = [];

    // Extract blockquote HTML with formatting
    const quoteHtml = extractFormattedHtml(el);

    if (quoteHtml && quoteHtml !== "\\n" && quoteHtml !== "\\n\\n") {
      segments.push({
        type: "blockquote",
        html: quoteHtml,
      });
    }

    // Extract any KaTeX math in blockquote
    const katexSpans = el.querySelectorAll(".katex");
    katexSpans.forEach((span) => {
      const mathNode = span.querySelector("math");
      const display =
        mathNode && mathNode.getAttribute("display") === "block"
          ? "block"
          : "inline";
      segments.push({
        type: "mathHtml",
        html: span.outerHTML,
        display,
      });
    });

    return segments;
  }

  // ---------- ARTICLE MODE (twitterArticleReadView) ----------

  function extractArticleSegments(article) {
    const readView = article.querySelector(
      '[data-testid="twitterArticleReadView"]',
    );
    if (!readView) return null;

    const segments = [];
    const seenBlocks = new WeakSet();
    const seenCodeContainers = new WeakSet();

    const walker = document.createTreeWalker(
      readView,
      NodeFilter.SHOW_ELEMENT,
      null,
    );

    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (!el.getAttribute) continue;

      const dataTestId = el.getAttribute("data-testid");

      // ----- Code blocks: whole markdown-code-block container -----
      if (dataTestId === "markdown-code-block") {
        if (seenCodeContainers.has(el)) continue;
        seenCodeContainers.add(el);

        // Mark closest ancestor data-block as seen to avoid duplicate text
        const ancestorBlock = el.closest("[data-block='true']");
        if (ancestorBlock) {
          seenBlocks.add(ancestorBlock);
        }

        // language label
        let language = "";
        const langSpan = el.querySelector("span");
        if (langSpan && langSpan.innerText) {
          language = langSpan.innerText.trim();
        }

        // actual code text
        const pre = el.querySelector("pre");
        const codeText = pre ? (pre.innerText || "").trim() : "";

        // mark any inner Draft.js blocks as seen so we don't process them again
        el.querySelectorAll("[data-block='true']").forEach((n) => {
          seenBlocks.add(n);
        });

        if (codeText) {
          segments.push({
            type: "code",
            language,
            text: codeText,
          });
        }

        continue;
      }

      const dataBlock = el.getAttribute("data-block");

      // ----- Block-level content (headings, blockquotes, text, math) -----
      if (dataBlock === "true") {
        if (seenBlocks.has(el)) continue;
        seenBlocks.add(el);

        const tag = el.tagName.toUpperCase();

        // Headings (H1-H5 inside article)
        const headingMatch = tag.match(/^H([1-5])$/);
        if (headingMatch) {
          const level = parseInt(headingMatch[1], 10);
          const headingSegments = processHeadingElement(el, level);
          segments.push(...headingSegments);
          continue;
        }

        // Blockquotes
        if (tag === "BLOCKQUOTE") {
          const blockquoteSegments = processBlockquoteElement(el);
          segments.push(...blockquoteSegments);
          continue;
        }

        // Block with KaTeX math
        const hasKatex = el.querySelector && el.querySelector(".katex");
        if (hasKatex) {
          // formatted HTML in block (without math)
          const formattedHtml = extractFormattedHtml(el);
          if (
            formattedHtml &&
            formattedHtml !== "\\n" &&
            formattedHtml !== "\\n\\n"
          ) {
            segments.push({
              type: "text",
              html: formattedHtml,
            });
          }

          // math segments in this block
          const katexSpans = el.querySelectorAll(".katex");
          katexSpans.forEach((span) => {
            const mathNode = span.querySelector("math");
            const display =
              mathNode && mathNode.getAttribute("display") === "block"
                ? "block"
                : "inline";
            segments.push({
              type: "mathHtml",
              html: span.outerHTML,
              display,
            });
          });

          continue;
        }

        // formatted text block
        let html = extractFormattedHtml(el);
        // filter Draft-style literal "\n" filler blocks
        if (html && html !== "\\n" && html !== "\\n\\n") {
          segments.push({
            type: "text",
            html,
          });
        }

        continue;
      }

      // ----- Images (article photos) -----
      if (dataTestId === "tweetPhoto") {
        const img = el.querySelector("img");
        if (img && img.src) {
          segments.push({
            type: "image",
            src: img.src,
            alt: img.alt || "",
          });
        }
      }
    }

    if (!segments.length) return null;
    return postprocessSegments(segments);
  }

  // ---------- FALLBACK: regular tweet/thread (no article view) ----------

  function extractTweetSegments() {
    const articles = Array.from(document.querySelectorAll("article"));
    if (!articles.length) return [];

    const segments = [];

    articles.forEach((art, idx) => {
      const textBlocks = Array.from(
        art.querySelectorAll('div[data-testid="tweetText"]'),
      );

      let text = "";
      if (textBlocks.length) {
        text = textBlocks
          .map((b) => (b.innerText || "").trim())
          .filter(Boolean)
          .join("\n\n"); // real newlines, not literal "\n"
      } else {
        text = (art.innerText || "").trim();
      }

      if (text && text !== "\\n" && text !== "\\n\\n") {
        segments.push({
          type: "text",
          text,
        });
      }

      const imgs = Array.from(
        art.querySelectorAll('img[src*="pbs.twimg.com/media/"]'),
      );
      imgs.forEach((img) => {
        segments.push({
          type: "image",
          src: img.src,
          alt: img.alt || "",
        });
      });

      if (idx < articles.length - 1) {
        segments.push({ type: "separator" });
      }
    });

    return segments;
  }

  // ---------- MAIN EXTRACTION ----------

  function extractSegments() {
    const firstArticle = document.querySelector("article");
    if (!firstArticle) return [];

    const articleSegments = extractArticleSegments(firstArticle);
    if (articleSegments && articleSegments.length) {
      return articleSegments;
    }

    return extractTweetSegments();
  }

  const segments = extractSegments();
  if (!segments.length) {
    alert("No article/tweet content found on this page.");
    return;
  }

  const title = document.title || "X Article";
  const url = location.href;

  // ---------- RENDER TO PRINTABLE HTML ----------

  const bodyContent = segments
    .map((seg) => {
      if (seg.type === "heading") {
        const tag = `h${seg.level}`;
        return `<${tag} class="article-heading">${escapeHtml(seg.text)}</${tag}>`;
      }

      if (seg.type === "blockquote") {
        // HTML already contains formatting and escaped text
        const html = seg.html.replace(/\n/g, "<br>");
        return `<blockquote class="article-blockquote">${html}</blockquote>`;
      }

      if (seg.type === "text") {
        // HTML already contains formatting and escaped text
        const html = seg.html.replace(/\n/g, "<br>");
        return `<p class="article-text">${html}</p>`;
      }

      if (seg.type === "code") {
        const lang = seg.language ? escapeHtml(seg.language) : "";
        const langBadge = lang
          ? `<span class="code-lang">${lang}</span>`
          : `<span class="code-lang">code</span>`;
        return `
<div class="code-block">
  <div class="code-block-header">
    ${langBadge}
  </div>
  <pre class="code-block-body"><code>${escapeHtml(seg.text)}</code></pre>
</div>`;
      }

      if (seg.type === "mathHtml") {
        if (seg.display === "block") {
          return `<div class="math-block-display">${seg.html}</div>`;
        } else {
          return `<span class="math-block-inline">${seg.html}</span>`;
        }
      }

      if (seg.type === "image") {
        const alt = seg.alt ? escapeHtml(seg.alt) : "";
        return `
<figure class="article-image-box">
  <img src="${escapeHtml(seg.src)}" alt="${alt}">
  ${alt ? `<figcaption>${alt}</figcaption>` : ""}
</figure>`;
      }

      if (seg.type === "separator") {
        return `<hr class="tweet-separator" />`;
      }

      return "";
    })
    .join("\n");

  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 40px 20px;
      line-height: 1.7;
      color: #1a1a1a;
      background: #fff;
      font-size: 16px;
    }

    .content-wrapper {
      max-width: 680px;
      margin: 0 auto;
    }

    .doc-title {
      font-size: 32px;
      margin: 0 0 8px 0;
      line-height: 1.2;
      font-weight: 700;
    }

    .meta {
      font-size: 14px;
      color: #666;
      margin-bottom: 32px;
      word-break: break-all;
    }

    .article-heading {
      font-weight: 600;
      border-bottom: 1px solid #ddd;
      padding-bottom: 4px;
    }

    h1.article-heading {
      font-size: 28px;
      margin: 32px 0 16px 0;
      line-height: 1.3;
    }

    h2.article-heading {
      font-size: 24px;
      margin: 28px 0 14px 0;
      line-height: 1.3;
    }

    h3.article-heading {
      font-size: 20px;
      margin: 24px 0 12px 0;
      line-height: 1.3;
    }

    h4.article-heading {
      font-size: 16px;
      margin: 20px 0 10px 0;
      line-height: 1.3;
    }

    h5.article-heading {
      font-size: 14px;
      margin: 16px 0 8px 0;
      line-height: 1.3;
    }

    .article-text {
      margin: 0 0 16px 0;
      font-size: 16px;
      line-height: 1.7;
    }

    .article-text strong,
    .article-blockquote strong {
      font-weight: 600;
    }

    .article-text em,
    .article-blockquote em {
      font-style: italic;
    }

    .article-blockquote {
      margin: 24px 0;
      padding: 16px 0 16px 20px;
      border-left: 4px solid #536471;
      background: #f7f9f9;
      font-style: italic;
      font-size: 16px;
      line-height: 1.7;
      color: #0f1419;
    }

    .code-block {
      margin: 24px 0;
      border-radius: 8px;
      background: #f7f9f9;
      border: 1px solid #e1e4e8;
      overflow: hidden;
      font-size: 14px;
    }
    .code-block-header {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      padding: 6px 10px;
      border-bottom: 1px solid #e1e4e8;
      background: #f0f3f6;
    }
    .code-lang {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 2px 6px;
      border-radius: 999px;
      border: 1px solid #cbd2da;
      background: #ffffff;
    }
    .code-block-body {
      margin: 0;
      padding: 10px 12px;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 13px;
      background: #f7f9f9;
    }

    .math-block-display {
      margin: 10px 0 14px 0;
    }
    .math-block-inline {
    }

    .article-image-box {
      margin: 8px 0 12px 0;
      border: 1px solid #ccc;
      border-radius: 6px;
      padding: 6px;
      background: #fafafa;
    }
    .article-image-box img {
      max-width: 100%;
      height: auto;
      display: block;
      border-radius: 4px;
    }
    .article-image-box figcaption {
      font-size: 11px;
      color: #555;
      margin-top: 4px;
    }

    .tweet-separator {
      margin: 20px 0;
      border: none;
      border-top: 1px dashed #ccc;
    }

    @page {
      margin: 20mm;
    }
    @media print {
      body {
        margin: 0;
        padding: 0;
      }
      .content-wrapper {
        max-width: 100%;
      }
      a {
        text-decoration: none;
        color: inherit;
      }
    }
  </style>
</head>
<body>
  <div class="content-wrapper">
    <h1 class="doc-title">${escapeHtml(title)}</h1>
    <div class="meta">
      Source: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>
    </div>
    ${bodyContent}
  </div>
</body>
</html>`;

  // Create blob URL upfront (before async call to avoid popup blocking)
  const blob = new Blob([html], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);

  // Get mode from background script and execute accordingly
  chrome.runtime.sendMessage({ action: "getMode" }, (response) => {
    if (response.mode === "download") {
      // Generate a safe filename from the title
      const safeTitle = title
        .replace(/[^a-zA-Z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .substring(0, 100);
      const filename = (safeTitle || "x-article") + ".html";

      // Send HTML to background script for download (static HTML, no script)
      chrome.runtime.sendMessage({
        action: "downloadHtml",
        html: html,
        filename: filename,
      });
      URL.revokeObjectURL(blobUrl);
    } else {
      // Open blob URL in new tab
      window.open(blobUrl, "_blank");
    }
  });
})();
