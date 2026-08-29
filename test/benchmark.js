import { fileURLToPath, pathToFileURL } from "node:url";
import { isLikelyPostContainer } from "../src/content/post-qualifier.js";
import { extractPost, findContainers } from "../src/content/content-index.js";
import { extractAuthor } from "../src/content/author-extractor.js";
import { buildKnowledgeGraph } from "../src/graph/graph-builder.js";
import { ForceLayout } from "../src/graph/force-layout.js";
import { computeDashboardAnalytics } from "../src/analytics/dashboard-analytics.js";

// DOM mock helper
function el(tag, attrs = {}, children = [], text = "") {
  const classListSet = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
  const node = {
    tagName: tag.toUpperCase(),
    attributes: { ...attrs },
    children: [...children],
    textContent: text,
    innerText: text,
    parentElement: null,
    dataset: {},
    classList: {
      contains(cls) {
        return classListSet.has(cls);
      },
      add(cls) {
        classListSet.add(cls);
      },
      remove(cls) {
        classListSet.delete(cls);
      },
    },
    getAttribute(name) {
      return this.attributes[name] || null;
    },
    setAttribute(name, val) {
      this.attributes[name] = val;
      if (name === "class") {
        classListSet.clear();
        (val || "").split(/\s+/).filter(Boolean).forEach((c) => classListSet.add(c));
      }
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (matches(current, selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
    matches(selector) {
      return matches(this, selector);
    },
    querySelector(selector) {
      const all = this.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    },
    querySelectorAll(selector) {
      const subSelectors = selector.split(",").map((s) => s.trim());
      const results = [];
      function traverse(n) {
        if (!n || !n.children) return;
        for (const child of n.children) {
          for (const sub of subSelectors) {
            if (matches(child, sub)) {
              results.push(child);
              break;
            }
          }
          traverse(child);
        }
      }
      traverse(this);
      return results;
    },
  };

  for (const c of children) {
    if (c && typeof c === "object") {
      c.parentElement = node;
    }
  }

  return node;
}

function matches(node, sel) {
  if (!node || !node.tagName) return false;
  if (sel.startsWith(".")) {
    const cls = sel.slice(1);
    const classes = (node.attributes.class || "").split(/\s+/);
    return classes.includes(cls);
  }
  if (sel.startsWith("div.")) {
    if (node.tagName !== "DIV") return false;
    const cls = sel.slice(4);
    const classes = (node.attributes.class || "").split(/\s+/);
    return classes.includes(cls);
  }
  if (sel.startsWith("a[") || sel.includes("a.") || sel.includes("a[")) {
    if (node.tagName !== "A") return false;
    if (sel.includes("href*='/in/'")) return (node.attributes.href || "").includes("/in/");
    if (sel.includes("href*='/company/'")) return (node.attributes.href || "").includes("/company/");
    if (sel.includes("href*='/school/'")) return (node.attributes.href || "").includes("/school/");
    if (sel.includes("href*='/showcase/'")) return (node.attributes.href || "").includes("/showcase/");
    if (sel.includes("href*='/feed/update/'")) return (node.attributes.href || "").includes("/feed/update/");
    if (sel.includes("href*='/posts/'")) return (node.attributes.href || "").includes("/posts/");
  }
  if (sel.startsWith("button[") || sel.includes("button[")) {
    if (node.tagName !== "BUTTON") return false;
    if (sel.includes("aria-label*='Start a post'")) return (node.attributes["aria-label"] || "").includes("Start a post");
    if (sel.includes("aria-label*='Create a post'")) return (node.attributes["aria-label"] || "").includes("Create a post");
    if (sel.includes("aria-label*='Follow'")) return (node.attributes["aria-label"] || "").includes("Follow");
    if (sel.includes("aria-label*='post by ']") || sel.includes("aria-label*='Post by ']")) {
      const aria = (node.attributes["aria-label"] || "").toLowerCase();
      return aria.includes("post by ");
    }
  }
  if (sel === "a[href]") {
    return node.tagName === "A" && Boolean(node.attributes.href);
  }
  if (sel.includes("share-box")) {
    return node.attributes["data-testid"] === "share-box" || (node.attributes.class || "").includes("share-box");
  }
  if (sel.includes("expandable-text-box")) {
    return node.attributes["data-testid"] === "expandable-text-box";
  }
  if (sel.includes("actor-container")) {
    return node.attributes["data-testid"] === "actor-container";
  }
  if (sel.includes("recs-list")) {
    return (node.attributes["data-testid"] || "").includes("recs-list");
  }
  if (sel.includes("data-urn*='activity:'")) {
    return (node.attributes["data-urn"] || "").includes("activity:");
  }
  if (sel.includes("data-urn*='ugcPost:'")) {
    return (node.attributes["data-urn"] || "").includes("ugcPost:");
  }
  if (sel.includes("data-urn*='sponsoredUpdate:'")) {
    return (node.attributes["data-urn"] || "").includes("sponsoredUpdate:");
  }
  if (sel.includes("data-id*='activity:'")) {
    return (node.attributes["data-id"] || "").includes("activity:");
  }
  if (sel === "h2" && node.tagName === "H2") return true;
  if (sel === "h3" && node.tagName === "H3") return true;
  if (sel === 'div[role="listitem"]' && node.tagName === "DIV" && node.attributes.role === "listitem") return true;
  return false;
}

/**
 * Builds a deterministic synthetic feed tree with exact distribution of posts vs non-post widgets.
 *
 * @param {number} totalCandidates Total item count
 */
function buildSyntheticFeed(totalCandidates) {
  const postCount = Math.round(totalCandidates * 0.6);
  const recsCount = Math.round(totalCandidates * 0.2);
  const composerCount = Math.round(totalCandidates * 0.1);
  const commentsCount = totalCandidates - postCount - recsCount - composerCount;

  const items = [];

  // 1. Real Posts
  for (let i = 0; i < postCount; i++) {
    const authorAnchor = el(
      "A",
      { class: "app-aware-link update-components-actor__image", href: `https://linkedin.com/in/author-${i % 25}` },
      [],
      `Author ${i % 25}`
    );
    const nameSpan = el("SPAN", { class: "update-components-actor__name" }, [authorAnchor], `Author ${i % 25}`);
    const metaDiv = el("DIV", { class: "update-components-actor__meta" }, [nameSpan]);
    const actorDiv = el("DIV", { class: "update-components-actor" }, [metaDiv]);
    const textDiv = el(
      "DIV",
      { class: "update-components-text" },
      [],
      `Post content ${i}: Evaluating large language model architectures and deterministic graph physics in production.`
    );
    const menuBtn = el("BUTTON", { "aria-label": `Open control menu for post by Author ${i % 25}` }, []);

    const postCard = el(
      "DIV",
      {
        class: "feed-shared-update-v2",
        "data-urn": i % 3 === 0 ? `urn:li:activity:71000000000000000${i}` : "",
        role: "listitem",
      },
      [actorDiv, textDiv, menuBtn]
    );
    items.push(postCard);
  }

  // 2. Recommendation Carousels
  for (let i = 0; i < recsCount; i++) {
    const h2 = el("H2", {}, [], "Recommended for you");
    const recCards = [1, 2, 3].map((r) =>
      el("DIV", { class: "feed-shared-actor-recommendation" }, [
        el("A", { href: `https://linkedin.com/in/rec-${i}-${r}` }, [], `Person ${r}`),
        el("BUTTON", { "aria-label": `Follow Person ${r}` }, [], "+ Follow"),
      ])
    );
    items.push(el("DIV", { class: "feed-shared-carousel", role: "listitem" }, [h2, ...recCards]));
  }

  // 3. Composers
  for (let i = 0; i < composerCount; i++) {
    const btn = el("BUTTON", { "aria-label": "Start a post, try writing with AI" }, [], "Start a post");
    items.push(el("DIV", { class: "share-box-feed-entry__wrapper", role: "listitem" }, [btn]));
  }

  // 4. Comments Containers
  for (let i = 0; i < commentsCount; i++) {
    const commentItem = el("DIV", { class: "comments-comment-item" }, [
      el("A", { href: `https://linkedin.com/in/commenter-${i}` }, [], `Commenter ${i}`),
    ]);
    items.push(el("DIV", { class: "comments-comments-list" }, [commentItem]));
  }

  const feedRoot = el("DIV", { "data-testid": "mainFeed" }, items);
  return { feedRoot, items, postCount, recsCount, composerCount, commentsCount };
}

/**
 * Runs the deterministic multi-scale performance benchmark.
 *
 * @param {number[]} [scales=[100, 500, 1000]]
 */
export function runBenchmark(scales = [100, 500, 1000]) {
  console.log("================================================================================");
  console.log("           FEEDRULE MULTI-SCALE PERFORMANCE BENCHMARK (SYNTHETIC DOM)           ");
  console.log("================================================================================");

  const results = {};

  for (const scale of scales) {
    console.log(`\n▶ Benchmarking scale: ${scale} candidates...`);
    const { feedRoot, items, postCount } = buildSyntheticFeed(scale);

    // 1. Candidate Discovery
    const t0 = performance.now();
    const containers = findContainers(feedRoot);
    const t1 = performance.now();

    // 2. Post Qualification & Extraction
    let accepted = 0;
    let ambiguous = 0;
    let rejected = 0;
    const extractedPosts = [];

    const t2 = performance.now();
    for (const c of containers) {
      const qual = isLikelyPostContainer(c);
      if (qual.decision === "ACCEPT") accepted++;
      else if (qual.decision === "AMBIGUOUS") ambiguous++;
      else rejected++;

      if (qual.decision !== "REJECT") {
        const post = extractPost(c);
        if (post) extractedPosts.push(post);
      }
    }
    const t3 = performance.now();

    // 3. extractAuthor Throughput on all genuine posts
    const t4 = performance.now();
    for (let i = 0; i < postCount; i++) {
      extractAuthor(items[i]);
    }
    const t5 = performance.now();

    // 4. Knowledge Graph Build & Layout Simulation
    const mockSavedPosts = Array.from({ length: postCount }, (_, i) => ({
      id: `post-${i}`,
      text: `Post content number ${i} with systems architecture concepts.`,
      author: `Author ${i % 25}`,
      authorUrl: `https://linkedin.com/in/author-${i % 25}`,
      topics: [`Topic-${i % 12}`, `Topic-${(i + 1) % 12}`],
      savedAt: Date.now() - i * 3600000,
    }));

    const t6 = performance.now();
    const graph = buildKnowledgeGraph(mockSavedPosts);
    const t7 = performance.now();

    const layout = new ForceLayout();
    layout.init(graph.nodes, graph.edges, 800, 600);
    const t8 = performance.now();
    for (let step = 0; step < 50; step++) {
      layout.tick();
    }
    const t9 = performance.now();

    // 5. Analytics Calculation (capped at 500 entries)
    const logEntriesCount = Math.min(scale, 500);
    const mockLog = Array.from({ length: logEntriesCount }, (_, i) => ({
      id: `post-${i}`,
      textSnippet: `Post snippet ${i}`,
      hide: i % 4 === 0,
      reason: i % 4 === 0 ? "Filtered" : "",
      topics: [`Topic-${i % 8}`],
      saved: i % 6 === 0,
      saveReason: i % 6 === 0 ? "Saved" : "",
      autoSaved: true,
      provider: "openai",
      model: "gpt-4o-mini",
      rulesText: "Rules",
      ts: Date.now() - i * 1800000,
    }));

    const t10 = performance.now();
    computeDashboardAnalytics(mockLog, { status: "all", topic: "", dateRange: "all", searchQuery: "" });
    const t11 = performance.now();

    const scaleResult = {
      scale,
      dom: {
        totalCandidates: containers.length,
        findContainersMs: Number((t1 - t0).toFixed(3)),
        qualifyAndExtractMs: Number((t3 - t2).toFixed(3)),
        avgCandidateMs: Number(((t3 - t2) / (containers.length || 1)).toFixed(4)),
        acceptedCount: accepted,
        ambiguousCount: ambiguous,
        rejectedCount: rejected,
        extractedPostsCount: extractedPosts.length,
        extractAuthorMs: Number((t5 - t4).toFixed(3)),
        avgExtractAuthorMs: Number(((t5 - t4) / (postCount || 1)).toFixed(4)),
      },
      graph: {
        nodesCount: graph.nodes.length,
        edgesCount: graph.edges.length,
        buildGraphMs: Number((t7 - t6).toFixed(3)),
        layoutInitMs: Number((t8 - t7).toFixed(3)),
        layout50TicksMs: Number((t9 - t8).toFixed(3)),
        avgTickMs: Number(((t9 - t8) / 50).toFixed(4)),
      },
      analytics: {
        entriesCount: logEntriesCount,
        computeAnalyticsMs: Number((t11 - t10).toFixed(3)),
      },
    };

    results[scale] = scaleResult;
    console.log(JSON.stringify(scaleResult, null, 2));
  }

  console.log("\n================================================================================");
  console.log("                           BENCHMARK EXECUTION COMPLETE                         ");
  console.log("================================================================================");
  return results;
}

// Execute benchmark ONLY when run directly via CLI (e.g. node test/benchmark.js or npm run bench)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runBenchmark([100, 500, 1000]);
}
