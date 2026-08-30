# FeedRule Features & UI Capabilities

This document details all user-facing interfaces, analytics tools, and workflows currently implemented and reachable in the extension.

---

## 1. Feature Availability Matrix

| Feature | Surface / Entry Point | Status in Current Build |
| :--- | :--- | :--- |
| **Feed Filtering & Collapsing** | LinkedIn Feed (`/feed/`) | **Live & Operational** |
| **"Show anyway" Override** | Feed Post Placeholder | **Live & Operational** |
| **Video Autoplay Suppression** | Hidden Feed Posts | **Live & Operational** |
| **Popup Rules Editor** | Chrome Toolbar Icon | **Live & Operational** |
| **Multi-Key Pool Manager** | Options Page (`options.html`) | **Live & Operational** |
| **Test Connection Tool** | Options Page (`options.html`) | **Live & Operational** |
| **Second Brain (Saved Posts)** | `src/saved/saved.html` | **Live & Operational** |
| **Markdown / Obsidian Export** | Second Brain UI (`saved.html`) | **Live & Operational** |
| **Analytics Dashboard** | `src/dashboard/dashboard.html` | **Live & Operational** |
| **Interactive Knowledge Graph** | `src/graph/graph.html` | **Live & Operational** |
| **Decision & API Logs** | Dashboard & Options | **Live & Operational** |

---

## 2. Feed Filtering & In-Feed UI

When navigating [LinkedIn](https://www.linkedin.com/feed/), FeedRule scans incoming feed items and applies classification decisions in real time.

### In-Feed Components

- **Collapsed Post Placeholder** ([`src/content/content.css`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/content.css)): When a post matches a hide rule, its content is collapsed (`display: none !important`), and a lightweight placeholder is injected:
  ```
  ┌──────────────────────────────────────────────────────────┐
  │ 🚫 Hidden by your filter: Recruiter hiring spam           │
  │ [ Show anyway ]                                          │
  └──────────────────────────────────────────────────────────┘
  ```
- **"Show anyway" Reveal**: Clicking the button instantly restores the full post content. The reveal state is remembered in a bounded session cache (`userRevealedPostIds`) so the post will not be re-hidden if re-rendered by LinkedIn.
- **Autoplay Video Suppression**: Video elements inside hidden posts are automatically paused via [`pauseVideosInContainer()`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/content-index.js#L158) to prevent background audio and CPU usage.

---

## 3. Extension Popup (`src/popup/popup.html`)

Clicking the FeedRule icon in the browser toolbar opens the quick control panel.

### Capabilities
- **Filter Master Toggle**: Instantly enable or disable the filtering engine globally.
- **1. Filter Rules**: Edit your plain-English hide/keep instructions.
- **2. Second Brain Rules**: Edit comma-separated topic tags for automatic saving.
- **Quick Links**:
  - `🕸️ View Knowledge Graph →`
  - `🧠 View Second Brain / Saved Posts →`
  - `📊 View filter dashboard →`
  - `⚙️ API key & provider settings →`

---

## 4. Second Brain (`src/saved/saved.html`)

The Second Brain is a local post archive that stores high-value technical posts and articles.

### Features
- **Auto-Curated & Manual Saves**: Posts matching your topic save rules are saved automatically. Manual saves from other views are also recorded here.
- **Search & Filter**: Search full-text content or filter by extracted topic tags via real-time dropdowns.
- **Direct Post Links**: Jump directly to the original LinkedIn post via canonical permalinks (`/feed/update/urn:li:activity:...`).
- **Metadata Retention**: Stores author name, author profile URL, post text (up to 4,000 characters), extracted topics, save reason, and timestamp.
- **Exporting**:
  - **Export Markdown (Obsidian-ready)**: Exports saved posts formatted with YAML frontmatter, source links, and sanitized Obsidian hashtags (`#Embedded_Systems`, `#Machine_Learning`).
  - **Export JSON**: Exports a structured JSON array for custom scripting.
- **Unsave & Clear**: Remove individual posts (with double-click protection) or bulk-clear the repository.

---

## 5. Analytics Dashboard (`src/dashboard/dashboard.html`)

Visualizes your filtering efficiency, content trends, and decision audit logs based on the local rolling decision history (up to 500 entries).

### Metrics & Visualizations
- **Summary KPIs**: Total Analyzed, Kept, Hidden, Saved, Hide Rate (%), and Save Rate (%).
- **Time Window Filters**: `Today`, `Last 7 Days`, `Last 30 Days`, and `All Time` (calculated using local calendar date boundaries).
- **Activity Trends**: Pure SVG responsive time-series chart showing Kept vs. Hidden vs. Saved activity.
- **Topic Distribution**: Bar charts showing the most frequent hidden topics and top saved topics.
- **Decision Audit Log**: Real-time table displaying recent posts with author, text snippet, decision badge, reason, topics, and model provider.
- **Log Export**: Export audit logs to JSON or CSV.

---

## 6. Interactive Knowledge Graph (`src/graph/graph.html`)

An interactive network visualization mapping connections between your saved posts, topics, and authors.

### Graph Architecture
- **Nodes**:
  - `Post` (Indigo `#6366f1`): Individual saved articles/posts.
  - `Topic` (Emerald `#10b981`): Subject-matter topic tags.
  - `Author` (Amber `#f59e0b`): Authors who published saved posts.
- **Edges**:
  - `Post` $\xrightarrow{\text{HAS\_TOPIC}}$ `Topic`
  - `Post` $\xrightarrow{\text{WRITTEN\_BY}}$ `Author`

### Interaction & Controls
- **Canvas Renderer** ([`src/graph/graph-renderer.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/graph/graph-renderer.js)): 60fps hardware-accelerated rendering with smooth pan, zoom ($0.2\times$ to $4.0\times$), node dragging, and 1st-degree neighborhood glow on hover.
- **Physics Simulation** ([`src/graph/force-layout.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/graph/force-layout.js)): Spring-embedder force simulation (Coulomb repulsion, Hooke spring attraction, center gravity) with automatic energy cooldown.
- **Node Detail Sidebar**: Clicking any node opens a sidebar with post content, direct links to LinkedIn, or author/topic post aggregations.
- **Focus Mode**: Isolates a single node and its connected neighbors.
- **Search & Filter**: Keyword search input and topic filter dropdown.
