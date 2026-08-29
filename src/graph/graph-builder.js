// src/graph/graph-builder.js
// Pure, deterministic graph data layer for the Second Brain Knowledge Graph.
// Transforms normalized SavedPost records into deterministic nodes and edges.

/**
 * Builds a deterministic Knowledge Graph from an array of SavedPost records.
 *
 * @param {Array<Object>} savedPosts - Array of canonical SavedPost objects
 * @returns {{ nodes: Array<Object>, edges: Array<Object> }}
 */
export function buildKnowledgeGraph(savedPosts) {
  if (!Array.isArray(savedPosts) || savedPosts.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodesMap = new Map();
  const edgesMap = new Map();

  for (const post of savedPosts) {
    if (!post || !post.id) continue;

    const postId = `post:${String(post.id).trim()}`;
    const rawText = String(post.text || "").trim();
    const rawAuthor = String(post.author || "").trim();
    const rawAuthorUrl = String(post.authorUrl || "").trim();

    // 1. Post Node
    const textSnippet = rawText.length > 50 ? `${rawText.slice(0, 50).trim()}…` : rawText || "Saved Post";
    const postLabel = rawAuthor ? `${rawAuthor}: ${textSnippet}` : textSnippet;

    if (!nodesMap.has(postId)) {
      nodesMap.set(postId, {
        id: postId,
        type: "post",
        label: postLabel,
        data: post,
      });
    }

    // 2. Topic Nodes and HAS_TOPIC Edges
    const rawTopics = Array.isArray(post.topics) ? post.topics : [];
    const seenTopicsForPost = new Set();

    for (const t of rawTopics) {
      if (typeof t !== "string" || !t.trim()) continue;
      const cleanTopic = t.trim();
      const topicLower = cleanTopic.toLowerCase();
      const topicId = `topic:${topicLower}`;

      // Deduplicate topics within the same post
      if (seenTopicsForPost.has(topicLower)) continue;
      seenTopicsForPost.add(topicLower);

      let topicNode = nodesMap.get(topicId);
      if (!topicNode) {
        topicNode = {
          id: topicId,
          type: "topic",
          label: cleanTopic, // Preserve canonical casing of first appearance
          count: 0,
        };
        nodesMap.set(topicId, topicNode);
      }
      topicNode.count++;

      // Edge: Post -> Topic
      const edgeId = `edge:has-topic:${postId}->${topicId}`;
      if (!edgesMap.has(edgeId)) {
        edgesMap.set(edgeId, {
          id: edgeId,
          source: postId,
          target: topicId,
          type: "has-topic",
        });
      }
    }

    // 3. Author Node and WRITTEN_BY Edge
    // Prefer stable authorUrl as canonical identity, fallback to author name
    let authorKey = "";
    if (rawAuthorUrl) {
      authorKey = `url:${rawAuthorUrl.toLowerCase()}`;
    } else if (rawAuthor) {
      authorKey = `name:${rawAuthor.toLowerCase()}`;
    }

    if (authorKey) {
      const authorId = `author:${authorKey}`;
      let authorNode = nodesMap.get(authorId);
      if (!authorNode) {
        authorNode = {
          id: authorId,
          type: "author",
          label: rawAuthor || "LinkedIn Author",
          authorUrl: rawAuthorUrl,
          count: 0,
        };
        nodesMap.set(authorId, authorNode);
      }
      authorNode.count++;

      // Edge: Post -> Author
      const edgeId = `edge:written-by:${postId}->${authorId}`;
      if (!edgesMap.has(edgeId)) {
        edgesMap.set(edgeId, {
          id: edgeId,
          source: postId,
          target: authorId,
          type: "written-by",
        });
      }
    }
  }

  // Deterministic sorting of nodes: by type ('post', 'topic', 'author'), then by id lexicographically
  const typeOrder = { post: 1, topic: 2, author: 3 };
  const nodes = Array.from(nodesMap.values()).sort((a, b) => {
    const typeDiff = (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
    if (typeDiff !== 0) return typeDiff;
    return a.id.localeCompare(b.id);
  });

  // Deterministic sorting of edges: by source, target, then type
  const edges = Array.from(edgesMap.values()).sort((a, b) => {
    const srcDiff = a.source.localeCompare(b.source);
    if (srcDiff !== 0) return srcDiff;
    const tgtDiff = a.target.localeCompare(b.target);
    if (tgtDiff !== 0) return tgtDiff;
    return a.type.localeCompare(b.type);
  });

  return { nodes, edges };
}

/**
 * Filters an array of SavedPost objects by one or more selected topics (logical OR).
 * If selectedTopics is empty or null, returns all posts (no topic restriction).
 *
 * @param {Array<Object>} posts
 * @param {Array<string>|Set<string>|null} selectedTopics
 * @returns {Array<Object>}
 */
export function filterPostsByTopics(posts, selectedTopics) {
  if (!Array.isArray(posts)) return [];
  if (
    !selectedTopics ||
    (Array.isArray(selectedTopics) && selectedTopics.length === 0) ||
    (selectedTopics instanceof Set && selectedTopics.size === 0)
  ) {
    return posts;
  }

  const topicSet = new Set(
    (Array.isArray(selectedTopics) ? selectedTopics : Array.from(selectedTopics))
      .filter((t) => typeof t === "string" && t.trim())
      .map((t) => t.trim().toLowerCase())
  );

  if (topicSet.size === 0) return posts;

  return posts.filter((p) => {
    if (!p || !Array.isArray(p.topics)) return false;
    return p.topics.some((t) => typeof t === "string" && topicSet.has(t.trim().toLowerCase()));
  });
}

/**
 * Filters an array of SavedPost objects by one or more selected authors (logical OR).
 * If selectedAuthors is empty or null, returns all posts (no author restriction).
 *
 * @param {Array<Object>} posts
 * @param {Array<string>|Set<string>|null} selectedAuthors
 * @returns {Array<Object>}
 */
export function filterPostsByAuthors(posts, selectedAuthors) {
  if (!Array.isArray(posts)) return [];
  if (
    !selectedAuthors ||
    (Array.isArray(selectedAuthors) && selectedAuthors.length === 0) ||
    (selectedAuthors instanceof Set && selectedAuthors.size === 0)
  ) {
    return posts;
  }

  const authorSet = new Set(
    (Array.isArray(selectedAuthors) ? selectedAuthors : Array.from(selectedAuthors))
      .filter((a) => typeof a === "string" && a.trim())
      .map((a) => a.trim().toLowerCase())
  );

  if (authorSet.size === 0) return posts;

  return posts.filter((p) => {
    if (!p || typeof p.author !== "string") return false;
    return authorSet.has(p.author.trim().toLowerCase());
  });
}

/**
 * Filters a Knowledge Graph by one or more allowed node types (e.g. ['post', 'topic'])
 * while eliminating dangling edges.
 *
 * @param {{ nodes: Array<Object>, edges: Array<Object> }} graph
 * @param {Array<string>|Set<string>|string} selectedTypes - Array/Set of types or single string
 * @returns {{ nodes: Array<Object>, edges: Array<Object> }}
 */
export function filterGraphByNodeTypes(graph, selectedTypes = "all") {
  if (!graph || !Array.isArray(graph.nodes)) {
    return { nodes: [], edges: [] };
  }

  let allowedTypesSet;
  if (typeof selectedTypes === "string") {
    const str = selectedTypes.trim().toLowerCase();
    if (str === "all" || !str) return graph;
    if (str === "posts" || str === "post") allowedTypesSet = new Set(["post"]);
    else if (str === "topics" || str === "topic") allowedTypesSet = new Set(["topic"]);
    else if (str === "authors" || str === "author") allowedTypesSet = new Set(["author"]);
    else return graph;
  } else if (Array.isArray(selectedTypes) || selectedTypes instanceof Set) {
    const raw = Array.isArray(selectedTypes) ? selectedTypes : Array.from(selectedTypes);
    if (raw.length === 0) return graph;
    allowedTypesSet = new Set();
    for (const t of raw) {
      if (typeof t !== "string") continue;
      const clean = t.trim().toLowerCase();
      if (clean === "posts" || clean === "post") allowedTypesSet.add("post");
      else if (clean === "topics" || clean === "topic") allowedTypesSet.add("topic");
      else if (clean === "authors" || clean === "author") allowedTypesSet.add("author");
    }
    if (allowedTypesSet.size === 0 || allowedTypesSet.size === 3) {
      return graph; // "all" or empty means all node types enabled
    }
  } else {
    return graph;
  }

  const filteredNodes = graph.nodes.filter((n) => allowedTypesSet.has(n.type));
  const nodeIds = new Set(filteredNodes.map((n) => n.id));

  // Retain only edges where BOTH source and target exist in the filtered node set
  const filteredEdges = (graph.edges || []).filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  return { nodes: filteredNodes, edges: filteredEdges };
}

/**
 * Filters a graph by a single node type while eliminating dangling edges.
 * (Backward-compatible alias for filterGraphByNodeTypes)
 *
 * @param {{ nodes: Array<Object>, edges: Array<Object> }} graph
 * @param {"all" | "posts" | "topics" | "authors"} nodeTypeFilter
 * @returns {{ nodes: Array<Object>, edges: Array<Object> }}
 */
export function filterGraphByNodeType(graph, nodeTypeFilter = "all") {
  return filterGraphByNodeTypes(graph, nodeTypeFilter);
}

/**
 * Extracts a focused neighborhood subgraph around a specific target node.
 *
 * @param {{ nodes: Array<Object>, edges: Array<Object> }} graph
 * @param {string} targetNodeId
 * @returns {{ nodes: Array<Object>, edges: Array<Object> }}
 */
export function extractNeighborhood(graph, targetNodeId) {
  if (!graph || !Array.isArray(graph.nodes) || !targetNodeId) {
    return { nodes: [], edges: [] };
  }

  const targetNode = graph.nodes.find((n) => n.id === targetNodeId);
  if (!targetNode) {
    return { nodes: [], edges: [] };
  }

  const neighborhoodNodeIds = new Set([targetNodeId]);
  const neighborhoodEdges = [];

  for (const edge of graph.edges || []) {
    if (edge.source === targetNodeId) {
      neighborhoodNodeIds.add(edge.target);
      neighborhoodEdges.push(edge);
    } else if (edge.target === targetNodeId) {
      neighborhoodNodeIds.add(edge.source);
      neighborhoodEdges.push(edge);
    }
  }

  const neighborhoodNodes = graph.nodes.filter((n) => neighborhoodNodeIds.has(n.id));

  return { nodes: neighborhoodNodes, edges: neighborhoodEdges };
}

/**
 * Determines whether two Knowledge Graph instances are structurally and visually equal.
 *
 * EQUALITY INVARIANT:
 * Two graphs g1 and g2 are equal if and only if:
 * 1. Node count and edge count are identical.
 * 2. Every node at index i (due to deterministic sorting) has identical id, type, label, count, and authorUrl.
 * 3. Every edge at index i has identical id, source, target, and type.
 *
 * When areGraphsEqual returns true, the visual layout, node labels, connectivity, and neighbor details
 * are completely identical, allowing layout.init() and position resets to be safely skipped.
 *
 * @param {{ nodes: Array<Object>, edges: Array<Object> } | null} g1
 * @param {{ nodes: Array<Object>, edges: Array<Object> } | null} g2
 * @returns {boolean}
 */
export function areGraphsEqual(g1, g2) {
  if (!g1 || !g2) return false;
  if (g1 === g2) return true;
  if (!Array.isArray(g1.nodes) || !Array.isArray(g2.nodes)) return false;
  if (!Array.isArray(g1.edges) || !Array.isArray(g2.edges)) return false;
  if (g1.nodes.length !== g2.nodes.length || g1.edges.length !== g2.edges.length) return false;

  for (let i = 0; i < g1.nodes.length; i++) {
    const n1 = g1.nodes[i];
    const n2 = g2.nodes[i];
    if (n1.id !== n2.id || n1.type !== n2.type || n1.label !== n2.label) {
      return false;
    }
    if (n1.count !== n2.count || n1.authorUrl !== n2.authorUrl) {
      return false;
    }
  }

  for (let i = 0; i < g1.edges.length; i++) {
    const e1 = g1.edges[i];
    const e2 = g2.edges[i];
    if (e1.id !== e2.id || e1.source !== e2.source || e1.target !== e2.target || e1.type !== e2.type) {
      return false;
    }
  }

  return true;
}
