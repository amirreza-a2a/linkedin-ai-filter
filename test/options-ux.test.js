// test/options-ux.test.js
// Regression tests for Settings / Provider Configuration conditional visibility and value preservation.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { updateProviderVisibility, load } from "../src/options/options.js";

function createMockConfigElement(provider, isHidden = false) {
  let hidden = isHidden;
  return {
    getAttribute: (attr) => (attr === "data-provider" ? provider : null),
    hasAttribute: (attr) => (attr === "hidden" ? hidden : false),
    removeAttribute: (attr) => {
      if (attr === "hidden") hidden = false;
    },
    setAttribute: (attr, val) => {
      if (attr === "hidden") hidden = true;
    },
  };
}

test("Options HTML Contract: options.html defines .provider-config fieldsets for all 3 providers", () => {
  const html = fs.readFileSync(path.resolve("src/options/options.html"), "utf-8");

  assert.ok(html.includes('data-provider="openai"'), "options.html must contain OpenAI config section");
  assert.ok(html.includes('data-provider="gemini"'), "options.html must contain Gemini config section");
  assert.ok(html.includes('data-provider="claude"'), "options.html must contain Claude config section");
  assert.ok(html.includes(".provider-config[hidden]"), "options.html must contain CSS rule for hidden provider configs");
});

test("Options UX Visibility: updateProviderVisibility correctly sets hidden on inactive providers", () => {
  const mockOpenAI = createMockConfigElement("openai", false);
  const mockGemini = createMockConfigElement("gemini", true);
  const mockClaude = createMockConfigElement("claude", true);

  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll: (selector) => {
      if (selector === ".provider-config") {
        return [mockOpenAI, mockGemini, mockClaude];
      }
      return [];
    },
  };

  try {
    // 1. Activate Gemini
    updateProviderVisibility("gemini");
    assert.equal(mockOpenAI.hasAttribute("hidden"), true, "OpenAI must be hidden when Gemini is active");
    assert.equal(mockGemini.hasAttribute("hidden"), false, "Gemini must NOT be hidden when Gemini is active");
    assert.equal(mockClaude.hasAttribute("hidden"), true, "Claude must be hidden when Gemini is active");

    // 2. Switch to Claude
    updateProviderVisibility("claude");
    assert.equal(mockOpenAI.hasAttribute("hidden"), true, "OpenAI must be hidden when Claude is active");
    assert.equal(mockGemini.hasAttribute("hidden"), true, "Gemini must be hidden when Claude is active");
    assert.equal(mockClaude.hasAttribute("hidden"), false, "Claude must NOT be hidden when Claude is active");

    // 3. Switch to OpenAI
    updateProviderVisibility("openai");
    assert.equal(mockOpenAI.hasAttribute("hidden"), false, "OpenAI must NOT be hidden when OpenAI is active");
    assert.equal(mockGemini.hasAttribute("hidden"), true, "Gemini must be hidden when OpenAI is active");
    assert.equal(mockClaude.hasAttribute("hidden"), true, "Claude must be hidden when OpenAI is active");
  } finally {
    globalThis.document = originalDocument;
  }
});

test("Options UX State: load() populates stored provider values and triggers visibility update", async () => {
  const mockOpenAI = createMockConfigElement("openai", false);
  const mockGemini = createMockConfigElement("gemini", true);
  const mockClaude = createMockConfigElement("claude", true);

  const formElements = {
    provider: { value: "" },
    openaiKey: { value: "" },
    openaiModel: { value: "" },
    openaiBaseUrl: { value: "" },
    geminiKey: { value: "" },
    geminiModel: { value: "" },
    geminiBaseUrl: { value: "" },
    claudeKey: { value: "" },
    claudeModel: { value: "" },
    claudeBaseUrl: { value: "" },
    dailyCap: { value: "" },
  };

  const originalDocument = globalThis.document;
  const originalChrome = globalThis.chrome;

  globalThis.document = {
    getElementById: (id) => formElements[id] || null,
    querySelectorAll: (selector) => {
      if (selector === ".provider-config") {
        return [mockOpenAI, mockGemini, mockClaude];
      }
      return [];
    },
  };

  // Mock stored settings with Gemini active, but preserved keys for all 3
  globalThis.chrome = {
    storage: {
      sync: {
        get: async () => ({
          provider: "gemini",
          model: {
            openai: "gpt-4o",
            gemini: "gemini-1.5-pro",
            claude: "claude-3-5-sonnet-20241022",
          },
          baseUrl: {
            openai: "http://localhost:11434/v1",
            gemini: "",
            claude: "",
          },
          dailyCallCap: 1000,
        }),
      },
      local: {
        get: async () => ({
          apiKeys: {
            openai: "sk-openai-saved",
            gemini: "AI-gemini-saved",
            claude: "sk-ant-claude-saved",
          },
        }),
      },
    },
  };

  try {
    await load();

    // 1. Values for all providers must be populated in inputs
    assert.equal(formElements.provider.value, "gemini");
    assert.equal(formElements.openaiKey.value, "sk-openai-saved");
    assert.equal(formElements.geminiKey.value, "AI-gemini-saved");
    assert.equal(formElements.claudeKey.value, "sk-ant-claude-saved");
    assert.equal(formElements.openaiModel.value, "gpt-4o");
    assert.equal(formElements.geminiModel.value, "gemini-1.5-pro");
    assert.equal(formElements.claudeModel.value, "claude-3-5-sonnet-20241022");
    assert.equal(formElements.openaiBaseUrl.value, "http://localhost:11434/v1");

    // 2. Visibility must strictly match the stored provider (Gemini visible, OpenAI/Claude hidden)
    assert.equal(mockOpenAI.hasAttribute("hidden"), true);
    assert.equal(mockGemini.hasAttribute("hidden"), false);
    assert.equal(mockClaude.hasAttribute("hidden"), true);
  } finally {
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
  }
});
