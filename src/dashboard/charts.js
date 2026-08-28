// src/dashboard/charts.js
// Zero-dependency, XSS-safe pure SVG chart renderers for FeedRule Dashboard.

/**
 * Escapes XML/HTML special characters to prevent XSS injection in SVG markup.
 *
 * @param {string} str
 * @returns {string} Safe XML string
 */
export function escapeXml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders a pure SVG multi-line trend chart showing Analyzed, Hidden, Kept, and Saved over time.
 *
 * @param {Array<{date: string, total: number, hidden: number, kept: number, saved: number}>} timeBuckets
 * @param {number} [width=680]
 * @param {number} [height=220]
 * @returns {string} Safe SVG markup
 */
export function renderTrendChart(timeBuckets = [], width = 680, height = 200) {
  if (!Array.isArray(timeBuckets) || timeBuckets.length === 0) {
    return `
      <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="#fafafa" rx="8" />
        <text x="${width / 2}" y="${height / 2}" font-family="sans-serif" font-size="13" fill="#888" text-anchor="middle">No activity data in this time range</text>
      </svg>
    `;
  }

  const padding = { top: 25, right: 30, bottom: 35, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  let maxVal = Math.max(...timeBuckets.map((b) => Math.max(b.total, b.hidden, b.kept, b.saved)), 5);
  maxVal = Math.ceil(maxVal / 5) * 5; // round up to multiple of 5

  const n = timeBuckets.length;
  const getX = (i) => (n <= 1 ? padding.left + chartW / 2 : padding.left + (i / (n - 1)) * chartW);
  const getY = (val) => padding.top + chartH - (val / maxVal) * chartH;

  // Grid lines & Y-axis labels
  const gridLines = [0, 0.5, 1]
    .map((ratio) => {
      const y = padding.top + chartH * (1 - ratio);
      const val = Math.round(maxVal * ratio);
      return `
        <line x1="${padding.left}" y1="${y}" x2="${padding.left + chartW}" y2="${y}" stroke="#e5e5e5" stroke-dasharray="3,3" />
        <text x="${padding.left - 8}" y="${y + 4}" font-family="sans-serif" font-size="10" fill="#999" text-anchor="end">${val}</text>
      `;
    })
    .join("");

  // X-axis date labels (show first, middle, and last dates if multiple)
  const xLabels = timeBuckets
    .map((b, i) => {
      if (n > 5 && i !== 0 && i !== Math.floor(n / 2) && i !== n - 1) return "";
      const x = getX(i);
      const shortDate = b.date.slice(5); // MM-DD
      return `<text x="${x}" y="${height - 10}" font-family="sans-serif" font-size="10" fill="#888" text-anchor="middle">${escapeXml(shortDate)}</text>`;
    })
    .join("");

  function makePolyline(seriesKey, strokeColor) {
    if (n === 1) {
      const x = getX(0);
      const y = getY(timeBuckets[0][seriesKey]);
      return `<circle cx="${x}" cy="${y}" r="4" fill="${strokeColor}" />`;
    }
    const points = timeBuckets.map((b, i) => `${getX(i)},${getY(b[seriesKey])}`).join(" ");
    const dots = timeBuckets
      .map((b, i) => `<circle cx="${getX(i)}" cy="${getY(b[seriesKey])}" r="3" fill="${strokeColor}" />`)
      .join("");
    return `
      <polyline fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${points}" />
      ${dots}
    `;
  }

  return `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#ffffff" rx="8" />
      ${gridLines}
      ${xLabels}
      ${makePolyline("total", "#0a66c2")}
      ${makePolyline("kept", "#2a7a34")}
      ${makePolyline("hidden", "#d11")}
      ${makePolyline("saved", "#7c3aed")}
    </svg>
  `;
}

/**
 * Renders a horizontal bar chart displaying top topics and their frequency with hide/save badges.
 *
 * @param {Array<{topic: string, count: number, hideRate: number, saveRate: number}>} topicStats
 * @param {number} [maxTopics=6]
 * @param {number} [width=680]
 * @returns {string} Safe SVG markup
 */
export function renderTopicBarChart(topicStats = [], maxTopics = 6, width = 680) {
  const topTopics = (Array.isArray(topicStats) ? topicStats : []).slice(0, maxTopics);
  if (topTopics.length === 0) {
    return `
      <svg width="100%" height="160" viewBox="0 0 ${width} 160" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="160" fill="#fafafa" rx="8" />
        <text x="${width / 2}" y="80" font-family="sans-serif" font-size="13" fill="#888" text-anchor="middle">No topics extracted in this time range</text>
      </svg>
    `;
  }

  const rowHeight = 32;
  const height = topTopics.length * rowHeight + 30;
  const maxCount = Math.max(...topTopics.map((t) => t.count), 1);
  const barStart = 160;
  const maxBarWidth = width - barStart - 160;

  const rows = topTopics
    .map((t, i) => {
      const y = i * rowHeight + 20;
      const barW = Math.max(Math.round((t.count / maxCount) * maxBarWidth), 8);
      const safeTopic = escapeXml(t.topic.length > 20 ? t.topic.slice(0, 20) + "…" : t.topic);

      return `
        <text x="15" y="${y + 14}" font-family="sans-serif" font-size="12" font-weight="500" fill="#333">${safeTopic}</text>
        <rect x="${barStart}" y="${y}" width="${barW}" height="18" fill="#e8f3ff" rx="4" />
        <rect x="${barStart}" y="${y}" width="${Math.round(barW * (t.hideRate / 100))}" height="18" fill="#fde8e8" rx="4" />
        <text x="${barStart + barW + 8}" y="${y + 13}" font-family="sans-serif" font-size="11" font-weight="600" fill="#0a66c2">${t.count} posts</text>
        <text x="${width - 15}" y="${y + 13}" font-family="sans-serif" font-size="10.5" fill="#666" text-anchor="end">${t.hideRate}% hidden • ${t.saveRate}% saved</text>
      `;
    })
    .join("");

  return `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#ffffff" rx="8" />
      ${rows}
    </svg>
  `;
}
