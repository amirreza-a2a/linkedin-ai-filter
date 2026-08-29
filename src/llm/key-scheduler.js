// src/llm/key-scheduler.js
// Runtime-only in-memory key scheduler, reservation leasing, and health state tracker.
// Pure module: zero Chrome API or storage dependencies.

/**
 * @typedef {Object} KeyRuntimeState
 * @property {number} activeLeases - Number of in-flight concurrent requests currently using this key
 * @property {"healthy"|"cooldown"|"invalid"} status - Runtime health status
 * @property {number} cooldownUntil - Timestamp ms when cooldown expires (0 if healthy)
 * @property {number} failureCount - Consecutive failure count
 * @property {number} lastUsed - Timestamp ms when key was last acquired
 */

/**
 * @typedef {Object} ProviderRuntimeState
 * @property {number} cursor - Current round-robin rotation index
 * @property {Map<number, KeyRuntimeState>} keyStates - Map of keyIndex -> KeyRuntimeState
 */

/** @type {Map<string, ProviderRuntimeState>} */
const providerPools = new Map();

/**
 * Gets or initializes runtime state for a given provider.
 *
 * @param {string} provider
 * @returns {ProviderRuntimeState}
 */
function getProviderState(provider) {
  const normProvider = (provider || "openai").trim().toLowerCase();
  let state = providerPools.get(normProvider);
  if (!state) {
    state = {
      cursor: 0,
      keyStates: new Map(),
    };
    providerPools.set(normProvider, state);
  }
  return state;
}

/**
 * Retrieves or initializes KeyRuntimeState for a specific index.
 *
 * @param {ProviderRuntimeState} state
 * @param {number} keyIndex
 * @returns {KeyRuntimeState}
 */
function getOrCreateKeyState(state, keyIndex) {
  let keyState = state.keyStates.get(keyIndex);
  if (!keyState) {
    keyState = {
      activeLeases: 0,
      status: "healthy",
      cooldownUntil: 0,
      failureCount: 0,
      lastUsed: 0,
    };
    state.keyStates.set(keyIndex, keyState);
  }
  return keyState;
}

/**
 * Ensures runtime key state exists for all configured key indices and cleans expired cooldowns.
 *
 * @param {ProviderRuntimeState} state
 * @param {number} keyCount
 */
function syncAndRefreshKeys(state, keyCount) {
  const now = Date.now();

  for (let i = 0; i < keyCount; i++) {
    const keyState = getOrCreateKeyState(state, i);
    // Auto-recover expired cooldowns
    if (keyState.status === "cooldown" && now >= keyState.cooldownUntil) {
      keyState.status = "healthy";
      keyState.cooldownUntil = 0;
    }
  }

  // Remove stale indices if keys array shrank
  for (const idx of state.keyStates.keys()) {
    if (idx >= keyCount) {
      state.keyStates.delete(idx);
    }
  }
}

/**
 * Acquires a key for a request attempt using least-leased round-robin selection.
 *
 * @param {string} provider - "openai" | "gemini" | "claude"
 * @param {string[]} keys - Array of configured API keys
 * @param {Object} [options]
 * @param {Set<number>|number[]} [options.excludeIndices] - Key indices already attempted in current request
 * @returns {{ key: string, keyIndex: number, keyLabel: string, inCooldown?: boolean, cooldownRemainingMs?: number } | null}
 */
export function acquireKey(provider, keys = [], options = {}) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return null;
  }

  const state = getProviderState(provider);
  syncAndRefreshKeys(state, keys.length);

  const excluded = new Set(
    Array.isArray(options.excludeIndices)
      ? options.excludeIndices
      : options.excludeIndices instanceof Set
      ? options.excludeIndices
      : []
  );

  const now = Date.now();

  // 1. Identify all eligible (non-invalid, non-excluded) candidate indices
  const candidateIndices = [];
  for (let i = 0; i < keys.length; i++) {
    if (excluded.has(i)) continue;
    const ks = state.keyStates.get(i);
    if (ks && ks.status !== "invalid") {
      candidateIndices.push(i);
    }
  }

  if (candidateIndices.length === 0) {
    // All keys are invalid or excluded
    return null;
  }

  // 2. Separate healthy candidates from cooldown candidates
  const healthyCandidates = candidateIndices.filter((idx) => {
    const ks = state.keyStates.get(idx);
    return ks.status === "healthy" || (ks.status === "cooldown" && now >= ks.cooldownUntil);
  });

  let chosenIndex = -1;
  let inCooldown = false;
  let cooldownRemainingMs = 0;

  if (healthyCandidates.length > 0) {
    // Select healthy candidate with minimum active leases
    let minLeases = Infinity;
    for (const idx of healthyCandidates) {
      const leases = state.keyStates.get(idx).activeLeases;
      if (leases < minLeases) {
        minLeases = leases;
      }
    }

    const leastLeased = healthyCandidates.filter(
      (idx) => state.keyStates.get(idx).activeLeases === minLeases
    );

    // Among candidates with equal minimum leases, pick closest to rotation cursor
    leastLeased.sort((a, b) => {
      const distA = (a - state.cursor + keys.length) % keys.length;
      const distB = (b - state.cursor + keys.length) % keys.length;
      return distA - distB;
    });

    chosenIndex = leastLeased[0];
    state.cursor = (chosenIndex + 1) % keys.length;
  } else {
    // All available candidates are in cooldown: pick the one with earliest cooldown expiry
    candidateIndices.sort((a, b) => {
      const cdA = state.keyStates.get(a).cooldownUntil;
      const cdB = state.keyStates.get(b).cooldownUntil;
      return cdA - cdB;
    });

    chosenIndex = candidateIndices[0];
    inCooldown = true;
    cooldownRemainingMs = Math.max(0, state.keyStates.get(chosenIndex).cooldownUntil - now);
  }

  const chosenState = state.keyStates.get(chosenIndex);
  chosenState.activeLeases += 1;
  chosenState.lastUsed = now;

  return {
    key: keys[chosenIndex],
    keyIndex: chosenIndex,
    keyLabel: `Key #${chosenIndex + 1}`,
    inCooldown,
    cooldownRemainingMs,
  };
}

/**
 * Releases a lease on a key after an HTTP attempt finishes.
 *
 * @param {string} provider
 * @param {number} keyIndex
 */
export function releaseKey(provider, keyIndex) {
  const state = getProviderState(provider);
  const keyState = state.keyStates.get(keyIndex);
  if (keyState) {
    keyState.activeLeases = Math.max(0, keyState.activeLeases - 1);
  }
}

/**
 * Applies a failure policy decision to a key's runtime state.
 *
 * @param {string} provider
 * @param {number} keyIndex
 * @param {Object} policyDecision
 * @param {boolean} [policyDecision.invalidateKey]
 * @param {number} [policyDecision.cooldownMs]
 */
export function applyFailureOutcome(provider, keyIndex, policyDecision = {}) {
  const state = getProviderState(provider);
  const keyState = getOrCreateKeyState(state, keyIndex);

  keyState.failureCount += 1;

  if (policyDecision.invalidateKey) {
    keyState.status = "invalid";
    keyState.cooldownUntil = 0;
  } else if (policyDecision.cooldownMs && policyDecision.cooldownMs > 0) {
    keyState.status = "cooldown";
    keyState.cooldownUntil = Date.now() + policyDecision.cooldownMs;
  }
}

/**
 * Applies a successful outcome to a key's runtime state, restoring it to healthy.
 *
 * @param {string} provider
 * @param {number} keyIndex
 */
export function applySuccessOutcome(provider, keyIndex) {
  const state = getProviderState(provider);
  const keyState = getOrCreateKeyState(state, keyIndex);

  keyState.status = "healthy";
  keyState.cooldownUntil = 0;
  keyState.failureCount = 0;
}

/**
 * Returns a diagnostic snapshot of runtime key states for a provider.
 *
 * @param {string} provider
 * @param {string[]} keys
 * @returns {Array<Object>}
 */
export function getKeyPoolStatus(provider, keys = []) {
  const state = getProviderState(provider);
  syncAndRefreshKeys(state, keys.length);
  const now = Date.now();

  return keys.map((key, idx) => {
    const ks = state.keyStates.get(idx) || {
      activeLeases: 0,
      status: "healthy",
      cooldownUntil: 0,
      failureCount: 0,
      lastUsed: 0,
    };

    const isCooldown = ks.status === "cooldown" && now < ks.cooldownUntil;
    const effectiveStatus = ks.status === "invalid" ? "invalid" : isCooldown ? "cooldown" : "healthy";

    return {
      keyIndex: idx,
      keyLabel: `Key #${idx + 1}`,
      status: effectiveStatus,
      activeLeases: ks.activeLeases,
      cooldownRemainingMs: isCooldown ? ks.cooldownUntil - now : 0,
      failureCount: ks.failureCount,
      lastUsed: ks.lastUsed,
    };
  });
}

/**
 * Resets all in-memory scheduler state (useful for tests or provider reloads).
 *
 * @param {string} [provider] - If omitted, resets all providers
 */
export function resetScheduler(provider) {
  if (provider) {
    providerPools.delete((provider || "").trim().toLowerCase());
  } else {
    providerPools.clear();
  }
}
