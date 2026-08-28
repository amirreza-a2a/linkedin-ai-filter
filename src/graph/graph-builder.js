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
