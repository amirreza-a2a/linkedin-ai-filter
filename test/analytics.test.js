import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDashboardAnalytics,
  toLocalDateString,
  getFilterDateBoundary,
} from "../src/analytics/dashboard-analytics.js";
import {
  renderTrendChart,
  renderTopicBarChart,
  escapeXml,
} from "../src/dashboard/charts.js";

test("toLocalDateString - formats local calendar dates accurately", () => {
  const d = new Date(2026, 7, 28, 14, 30, 0); // Month is 0-indexed: 7 = August
  assert.equal(toLocalDateString(d.getTime()), "2026-08-28");
});

test("computeDashboardAnalytics - KPI calculations and safe zero-division", () => {
  // 1. Empty records
  const emptyRes = computeDashboardAnalytics([]);
  assert.equal(emptyRes.kpis.total, 0);
  assert.equal(emptyRes.kpis.hidden, 0);
  assert.equal(emptyRes.kpis.kept, 0);
  assert.equal(emptyRes.kpis.hideRate, 0);
  assert.equal(emptyRes.kpis.saved, 0);
  assert.equal(emptyRes.kpis.saveRate, 0);
  assert.equal(emptyRes.kpis.uniqueTopicsCount, 0);

  // 2. Normal sample records
  const sample = [
    { id: "1", hide: true, saved: false, topics: ["AI", "5G"], ts: 1000 },
    { id: "2", hide: false, saved: true, topics: ["AI"], ts: 2000 },
    { id: "3", hide: false, saved: false, topics: ["Semiconductors"], ts: 3000 },
    { id: "4", hide: true, saved: true, topics: ["5G"], ts: 4000 }, // hidden and saved
  ];

  const res = computeDashboardAnalytics(sample);
  assert.equal(res.kpis.total, 4);
  assert.equal(res.kpis.hidden, 2);
  assert.equal(res.kpis.kept, 2);
  assert.equal(res.kpis.hideRate, 50); // 2 / 4 = 50%
  assert.equal(res.kpis.saved, 2);
  assert.equal(res.kpis.saveRate, 50); // 2 / 4 = 50%
  assert.equal(res.kpis.uniqueTopicsCount, 3);
});

test("computeDashboardAnalytics - Topic metrics with exact denominators", () => {
  const sample = [
    { id: "1", hide: true, saved: false, topics: ["AI", "5G"], ts: 1000 },
    { id: "2", hide: false, saved: true, topics: ["AI"], ts: 2000 },
    { id: "3", hide: true, saved: true, topics: ["AI"], ts: 3000 },
    { id: "4", hide: false, saved: false, topics: ["5G"], ts: 4000 },
  ];

  const res = computeDashboardAnalytics(sample);
  const aiTopic = res.topicStats.find((t) => t.topic === "AI");
  assert.ok(aiTopic);
  assert.equal(aiTopic.count, 3); // 3 posts with AI
  assert.equal(aiTopic.hiddenCount, 2); // posts 1 & 3
  assert.equal(aiTopic.keptCount, 1); // post 2
  assert.equal(aiTopic.hideRate, 67); // Math.round(2/3 * 100) = 67%
  assert.equal(aiTopic.savedCount, 2); // posts 2 & 3
  assert.equal(aiTopic.saveRate, 67); // Math.round(2/3 * 100) = 67%

  const gTopic = res.topicStats.find((t) => t.topic === "5G");
  assert.ok(gTopic);
  assert.equal(gTopic.count, 2); // 2 posts with 5G
  assert.equal(gTopic.hiddenCount, 1); // post 1
  assert.equal(gTopic.hideRate, 50); // Math.round(1/2 * 100) = 50%
  assert.equal(gTopic.savedCount, 0);
  assert.equal(gTopic.saveRate, 0);
});

test("computeDashboardAnalytics - Multi-criteria filtering (status, topic, dateRange, search)", () => {
  const baseTime = new Date(2026, 7, 28, 12, 0, 0).getTime();
  const sample = [
    { id: "1", textSnippet: "AI breakthrough in healthcare", reason: "keep", hide: false, saved: true, topics: ["AI"], provider: "openai", ts: baseTime },
    { id: "2", textSnippet: "Recruiter spam", reason: "spam", hide: true, saved: false, topics: ["Recruiting"], provider: "openai", ts: baseTime - 86400000 },
    { id: "3", textSnippet: "Older post from 10 days ago", reason: "keep", hide: false, saved: false, topics: ["AI"], provider: "gemini", ts: baseTime - 10 * 86400000 },
  ];

  // 1. Filter status: saved only
  const savedRes = computeDashboardAnalytics(sample, { status: "saved" }, baseTime);
  assert.equal(savedRes.filteredRecords.length, 1);
  assert.equal(savedRes.filteredRecords[0].id, "1");

  // 2. Filter topic: Recruiting
  const recRes = computeDashboardAnalytics(sample, { topic: "Recruiting" }, baseTime);
  assert.equal(recRes.filteredRecords.length, 1);
  assert.equal(recRes.filteredRecords[0].id, "2");

  // 3. Filter dateRange: 7d (excludes post from 10 days ago)
  const weekRes = computeDashboardAnalytics(sample, { dateRange: "7d" }, baseTime);
  assert.equal(weekRes.filteredRecords.length, 2);

  // 4. Filter search query
  const searchRes = computeDashboardAnalytics(sample, { search: "healthcare" }, baseTime);
  assert.equal(searchRes.filteredRecords.length, 1);
  assert.equal(searchRes.filteredRecords[0].id, "1");
});

test("SVG Safety - escapes dynamic topic names and labels to prevent XSS", () => {
  const maliciousTopic = '<script>alert("XSS")</script> & "Quotes" \'Single\'';
  const escaped = escapeXml(maliciousTopic);

  assert.ok(!escaped.includes("<script>"));
  assert.ok(!escaped.includes('"Quotes"'));
  assert.ok(escaped.includes("&lt;script&gt;"));
  assert.ok(escaped.includes("&amp;"));
  assert.ok(escaped.includes("&quot;Quotes&quot;"));
  assert.ok(escaped.includes("&#39;Single&#39;"));

  const chartSvg = renderTopicBarChart([
    { topic: maliciousTopic, count: 5, hideRate: 20, saveRate: 40 },
  ]);

  assert.ok(!chartSvg.includes("<script>alert"));
  assert.ok(chartSvg.includes("&lt;script&gt;"));
});
