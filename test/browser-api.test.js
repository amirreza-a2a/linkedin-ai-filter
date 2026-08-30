// test/browser-api.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { browserApi, isFirefox, getExtensionUrl } from "../src/utils/browser.js";

test("browserApi: Routes to globalThis.browser when available (Firefox / W3C)", () => {
  const origBrowser = globalThis.browser;
  const origChrome = globalThis.chrome;

  try {
    const mockStorageLocal = {
      get: async (keys) => ({ testKey: "firefoxValue" }),
      set: async () => {},
    };
    globalThis.browser = {
      storage: { local: mockStorageLocal },
      runtime: {
        getURL: (path) => `moz-extension://test-uuid-12345/${path}`,
      },
    };
    globalThis.chrome = undefined;

    assert.equal(browserApi.storage.local, mockStorageLocal);
    assert.equal(
      getExtensionUrl("src/dashboard/dashboard.html"),
      "moz-extension://test-uuid-12345/src/dashboard/dashboard.html"
    );
  } finally {
    globalThis.browser = origBrowser;
    globalThis.chrome = origChrome;
  }
});

test("browserApi: Routes to globalThis.chrome when globalThis.browser is undefined (Chromium)", () => {
  const origBrowser = globalThis.browser;
  const origChrome = globalThis.chrome;

  try {
    const mockStorageSync = {
      get: async () => ({ enabled: true }),
      set: async () => {},
    };
    globalThis.browser = undefined;
    globalThis.chrome = {
      storage: { sync: mockStorageSync },
      runtime: {
        getURL: (path) => `chrome-extension://chrome-id-67890/${path}`,
      },
    };

    assert.equal(browserApi.storage.sync, mockStorageSync);
    assert.equal(
      getExtensionUrl("src/options/options.html"),
      "chrome-extension://chrome-id-67890/src/options/options.html"
    );
  } finally {
    globalThis.browser = origBrowser;
    globalThis.chrome = origChrome;
  }
});

test("browserApi: Permissions and Tabs API proxy delegation", async () => {
  const origBrowser = globalThis.browser;
  const origChrome = globalThis.chrome;

  try {
    let permChecked = false;
    let tabCreated = false;

    globalThis.browser = {
      permissions: {
        async contains(req) {
          permChecked = true;
          return req.origins?.includes("https://api.openai.com/*");
        },
        async request() {
          return true;
        },
      },
      tabs: {
        async create(props) {
          tabCreated = true;
          return { id: 101, url: props.url };
        },
      },
    };
    globalThis.chrome = undefined;

    const hasPerm = await browserApi.permissions.contains({ origins: ["https://api.openai.com/*"] });
    assert.equal(hasPerm, true);
    assert.equal(permChecked, true);

    const tab = await browserApi.tabs.create({ url: "https://example.com" });
    assert.equal(tab.id, 101);
    assert.equal(tabCreated, true);
  } finally {
    globalThis.browser = origBrowser;
    globalThis.chrome = origChrome;
  }
});

test("isFirefox detection helper", () => {
  const origBrowser = globalThis.browser;
  try {
    globalThis.browser = { runtime: { getBrowserInfo: async () => ({ name: "Firefox" }) } };
    assert.equal(isFirefox(), true);

    globalThis.browser = { runtime: {} };
    // In Node without Firefox userAgent or getBrowserInfo
    assert.equal(isFirefox(), false);
  } finally {
    globalThis.browser = origBrowser;
  }
});

test("getExtensionUrl: strips leading slashes and handles empty input safely", () => {
  const origBrowser = globalThis.browser;
  const origChrome = globalThis.chrome;

  try {
    globalThis.browser = {
      runtime: {
        getURL: (p) => `moz-extension://uuid/${p}`,
      },
    };
    globalThis.chrome = undefined;

    assert.equal(getExtensionUrl(""), "");
    assert.equal(getExtensionUrl(null), "");
    assert.equal(getExtensionUrl("///src/saved/saved.html"), "moz-extension://uuid/src/saved/saved.html");
  } finally {
    globalThis.browser = origBrowser;
    globalThis.chrome = origChrome;
  }
});
