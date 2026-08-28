// src/analytics/dashboard-analytics.js
// Pure, deterministic analytics engine for the FeedRule Dashboard.
// Processes normalized decision log records in a single O(N) traversal.

/**
 * Formats a timestamp into a local calendar date string (YYYY-MM-DD).
 *
 * @param {number|Date} ts
 * @returns {string} Local date string
 */
export function toLocalDateString(ts) {
  const d = ts instanceof Date ? ts : new Date(ts || Date.now());
  if (isNaN(d.getTime())) return "Unknown";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Calculates the local start timestamp for standard date range filters.
 *
 * @param {string} dateRange - 'all' | 'today' | '7d' | '30d'
 * @param {number} [nowMs]
 * @returns {number} Minimum timestamp inclusive
 */
export function getFilterDateBoundary(dateRange, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  switch (dateRange) {
    case "today":
      return startOfToday;
    case "7d":
      return startOfToday - 6 * 86400000; // 7 calendar days
    case "30d":
      return startOfToday - 29 * 86400000; // 30 calendar days
    case "all":
    default:
      return 0;
  }
}

/**
 * Computes all dashboard KPIs, time-series buckets, and topic metrics
 * in a single-pass traversal over the decision log records.
 *
 * @param {Object[]} records - Array of normalized LogEntry objects
 * @param {Object} [filters]
 * @param {string} [filters.dateRange] - 'all' | 'today' | '7d' | '30d'
 * @param {string} [filters.status] - 'all' | 'hidden' | 'kept' | 'saved'
 * @param {string} [filters.topic] - Exact topic name filter
 * @param {string} [filters.provider] - Provider filter
 * @param {string} [filters.search] - Substring search
 * @param {number} [nowMs] - Current time override for deterministic testing
 * @returns {Object} Computed analytics view model
 */
export function computeDashboardAnalytics(records, filters = {}, nowMs = Date.now()) {
  const safeRecords = Array.isArray(records) ? records : [];

  const minTs = getFilterDateBoundary(filters.dateRange || "all", nowMs);
  const statusFilter = (filters.status || "all").toLowerCase();
  const topicFilter = (filters.topic || "").trim().toLowerCase();
  const providerFilter = (filters.provider || "all").toLowerCase();
  const searchQuery = (filters.search || "").trim().toLowerCase();

  let totalCount = 0;
  let hiddenCount = 0;
  let savedCount = 0;

  const dayBucketsMap = new Map();
  const topicStatsMap = new Map();
  const providerStatsMap = new Map();
  const filteredRecords = [];

  for (const r of safeRecords) {
    if (!r) continue;

    // 1. Date Range Filter
    const ts = typeof r.ts === "number" && !isNaN(r.ts) ? r.ts : 0;
    if (minTs > 0 && ts < minTs) {
      continue;
    }

    // 2. Status Filter
    const isHidden = r.hide === true;
    const isSaved = r.saved === true;
    if (statusFilter === "hidden" && !isHidden) continue;
    if (statusFilter === "kept" && isHidden) continue;
    if (statusFilter === "saved" && !isSaved) continue;

    // 3. Topic Filter
    const topics = Array.isArray(r.topics) ? r.topics : [];
    if (topicFilter) {
      const hasTopic = topics.some((t) => typeof t === "string" && t.trim().toLowerCase() === topicFilter);
      if (!hasTopic) continue;
    }

    // 4. Provider Filter
    const provider = String(r.provider || "openai").toLowerCase();
    if (providerFilter !== "all" && provider !== providerFilter) {
      continue;
    }

    // 5. Search Query Filter
    if (searchQuery) {
      const text = String(r.textSnippet || "").toLowerCase();
      const reason = String(r.reason || "").toLowerCase();
      const model = String(r.model || "").toLowerCase();
      const hasTopicMatch = topics.some((t) => typeof t === "string" && t.toLowerCase().includes(searchQuery));
      if (!text.includes(searchQuery) && !reason.includes(searchQuery) && !model.includes(searchQuery) && !hasTopicMatch) {
        continue;
      }
    }

    // --- Record matches all filters -> Accumulate metrics ---
    filteredRecords.push(r);
    totalCount++;
    if (isHidden) hiddenCount++;
    if (isSaved) savedCount++;

    // Time-series bucketing
    const dayKey = toLocalDateString(ts);
    let dayBucket = dayBucketsMap.get(dayKey);
    if (!dayBucket) {
      dayBucket = { date: dayKey, total: 0, hidden: 0, kept: 0, saved: 0 };
      dayBucketsMap.set(dayKey, dayBucket);
    }
    dayBucket.total++;
    if (isHidden) {
      dayBucket.hidden++;
    } else {
      dayBucket.kept++;
    }
    if (isSaved) {
      dayBucket.saved++;
    }

    // Topic performance aggregation
    for (const rawTopic of topics) {
      if (typeof rawTopic !== "string" || !rawTopic.trim()) continue;
      const lower = rawTopic.trim().toLowerCase();
      let stat = topicStatsMap.get(lower);
      if (!stat) {
        stat = {
          topic: rawTopic.trim(),
          count: 0,
          hiddenCount: 0,
          savedCount: 0,
        };
        topicStatsMap.set(lower, stat);
      }
      stat.count++;
      if (isHidden) stat.hiddenCount++;
      if (isSaved) stat.savedCount++;
    }

    // Provider aggregation
    providerStatsMap.set(provider, (providerStatsMap.get(provider) || 0) + 1);
  }

  const keptCount = totalCount - hiddenCount;
  const hideRate = totalCount > 0 ? Math.round((hiddenCount / totalCount) * 100) : 0;
  const saveRate = totalCount > 0 ? Math.round((savedCount / totalCount) * 100) : 0;

  // Format and sort Topic stats
  const topicStats = Array.from(topicStatsMap.values())
    .map((stat) => ({
      topic: stat.topic,
      count: stat.count,
      hiddenCount: stat.hiddenCount,
      keptCount: stat.count - stat.hiddenCount,
      hideRate: stat.count > 0 ? Math.round((stat.hiddenCount / stat.count) * 100) : 0,
      savedCount: stat.savedCount,
      saveRate: stat.count > 0 ? Math.round((stat.savedCount / stat.count) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Format and sort Time buckets chronologically
  const timeBuckets = Array.from(dayBucketsMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return {
    kpis: {
      total: totalCount,
      hidden: hiddenCount,
      kept: keptCount,
      hideRate,
      saved: savedCount,
      saveRate,
      uniqueTopicsCount: topicStats.length,
    },
    timeBuckets,
    topicStats,
    providerStats: Object.fromEntries(providerStatsMap),
    filteredRecords,
  };
}
