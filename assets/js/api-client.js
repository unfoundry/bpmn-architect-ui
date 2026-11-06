/**
 * ==============================================================================
 * BPMN ARCHITECT - API CLIENT MODULE
 * ==============================================================================
 * Handles all network communication between the static web platform and the
 * headless BPMN Architect microservice.
 *
 * Core Features:
 * 1. Dual-Save Support: Bundles BPMN 2.0 XML and pre-rendered SVG in a single payload.
 * 2. High-Availability Fallback: If the API service is unreachable, attempts to
 *    read diagram files directly from the static filestore folder (e.g. hosted on IIS).
 * 3. Cooperative Lock Coordination: Sends heartbeats and requests handoffs.
 * 4. Zero External Dependencies: Pure modern browser Fetch API.
 * ==============================================================================
 */

class BPMNApiClient {
  constructor(config = {}) {
    this.config = config;
    this.baseUrl = (config.endpoints && config.endpoints.serviceUrl) || "http://127.0.0.1:8002";
    this.dataStaticServeUrl = (config.endpoints && (config.endpoints.dataStaticServeUrl || config.endpoints.filestoreFolderUrl)) || "";
    this.isOffline = false;
  }

  get username() {
    if (window.BPMN_APP && window.BPMN_APP.user) {
      return window.BPMN_APP.user.username;
    }
    return localStorage.getItem("bpmn_user") || "a.taylor";
  }

  get masterKey() {
    return (
      (this.config.endpoints && this.config.endpoints.apiKey) ||
      (this.config.auth && this.config.auth.masterKey) ||
      localStorage.getItem("bpmn_master_key") ||
      ""
    );
  }

  /**
   * Helper to construct request headers including identity and API authorization key.
   */
  _getHeaders(contentType = "application/json") {
    const headers = {};
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    if (this.username) {
      headers["X-Username"] = this.username;
    }
    const key = this.masterKey;
    if (key) {
      headers["X-Master-Key"] = key;
    }
    return headers;
  }

  /**
   * Fetches the listing of diagrams from the service.
   * Returns null if service is unreachable (allowing library to switch to static recents).
   */
  async fetchDiagrams(includeDeleted = false) {
    try {
      const url = `${this.baseUrl}/api/diagrams?include_deleted=${includeDeleted}`;
      const response = await fetch(url, { headers: this._getHeaders() });
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }
      this.isOffline = false;
      return await response.json();
    } catch (err) {
      this.isOffline = true;
      console.warn("[ApiClient] API service unreachable for diagram listing:", err);
      return null;
    }
  }

  /**
   * Retrieves diagram metadata.
   * If API service is offline, attempts to read direct {id}.json from dataStaticServeUrl!
   */
  async fetchDiagramMetadata(id) {
    const cleanId = encodeURIComponent(id);
    const url = `${this.baseUrl}/api/diagram/${cleanId}`;
    try {
      const response = await fetch(url, { headers: this._getHeaders() });
      if (response.ok) {
        this.isOffline = false;
        const data = await response.json();
        // Record in recents
        if (window.BPMN_APP && window.BPMN_APP.recordRecentDiagram) {
          window.BPMN_APP.recordRecentDiagram(data);
        }
        return data;
      }
    } catch (err) {
      this.isOffline = true;
      console.warn(`[ApiClient] API unavailable for metadata of ${id}. Checking dataStaticServeUrl...`);
    }

    // Static fallback: read {id}.json
    if (this.dataStaticServeUrl) {
      try {
        const staticJsonUrl = `${this.dataStaticServeUrl.replace(/\/$/, "")}/${cleanId}.json`;
        const res = await fetch(staticJsonUrl);
        if (res.ok) {
          const staticData = await res.json();
          staticData._isStaticFallback = true;
          return staticData;
        }
      } catch (e) {
        console.warn("[ApiClient] Static metadata fallback also unavailable:", e);
      }
    }

    // Secondary fallback: check local recent diagrams cache
    const recents = (window.BPMN_APP && window.BPMN_APP.getRecentDiagrams) ? window.BPMN_APP.getRecentDiagrams() : [];
    const cached = recents.find(r => r.id === id);
    if (cached) {
      return {
        ...cached,
        _isStaticFallback: true
      };
    }

    // Minimal fallback object
    return {
      id: id,
      friendly_name: id,
      project_name: "Static Diagram",
      project_description: "",
      author: "Unknown",
      updated_at: null,
      _isStaticFallback: true
    };
  }

  /**
   * Fetches raw BPMN XML.
   * Employs High-Availability Fallback: If API service is offline and
   * dataStaticServeUrl is configured (e.g. static IIS directory), fetches directly from there!
   */
  async fetchDiagramXml(id) {
    const cleanId = encodeURIComponent(id);
    const apiUrl = `${this.baseUrl}/api/diagram/${cleanId}/xml`;

    try {
      const response = await fetch(apiUrl, { headers: this._getHeaders(null) });
      if (response.ok) {
        this.isOffline = false;
        return await response.text();
      }
    } catch (apiErr) {
      this.isOffline = true;
      console.warn(`[ApiClient] API service unreachable for XML of ${id}. Checking dataStaticServeUrl...`, apiErr);
    }

    // High-Availability Fallback: Fetch from direct static filestore if defined
    if (this.dataStaticServeUrl) {
      try {
        const staticUrl = `${this.dataStaticServeUrl.replace(/\/$/, "")}/${cleanId}.bpmn`;
        console.info(`[ApiClient] Fetching from static filestore fallback: ${staticUrl}`);
        const staticRes = await fetch(staticUrl);
        if (staticRes.ok) {
          return await staticRes.text();
        }
      } catch (staticErr) {
        console.error(`[ApiClient] Static filestore fallback also failed:`, staticErr);
      }
    }

    // Secondary Fallback: Check browser local drafts
    const draftKey = `bpmn_draft_${id}`;
    const localDraft = localStorage.getItem(draftKey);
    if (localDraft) {
      console.info(`[ApiClient] Restoring diagram from local browser draft cache.`);
      return localDraft;
    }

    throw new Error(`Could not load BPMN XML from API, static filestore, or local cache.`);
  }

  /**
   * Dual-Save: Submits both BPMN 2.0 XML and pre-rendered SVG to the service.
   */
  async saveDiagram(id, bpmnXml, svgContent = null, metadataUpdates = null) {
    // Save locally first as a safety backup
    localStorage.setItem(`bpmn_draft_${id}`, bpmnXml);

    const cleanId = encodeURIComponent(id);
    const url = `${this.baseUrl}/api/diagram/${cleanId}/save`;
    const payload = {
      bpmn_xml: bpmnXml,
      svg_content: svgContent,
      ...metadataUpdates,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: this._getHeaders("application/json"),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Save failed with HTTP ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Creates a new diagram.
   */
  async createDiagram(friendlyName, projectName = "", projectDescription = "", initialXml = null) {
    const url = `${this.baseUrl}/api/diagram/new`;
    const payload = {
      friendly_name: friendlyName,
      project_name: projectName,
      project_description: projectDescription,
      initial_xml: initialXml,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: this._getHeaders("application/json"),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Creation failed with HTTP ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Updates process metadata without altering XML.
   */
  async updateMetadata(id, updates) {
    const cleanId = encodeURIComponent(id);
    const url = `${this.baseUrl}/api/diagram/${cleanId}/metadata`;

    const response = await fetch(url, {
      method: "POST",
      headers: this._getHeaders("application/json"),
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(`Failed to update metadata (${response.status})`);
    }

    return await response.json();
  }

  /**
   * Deletes a process diagram.
   */
  async deleteDiagram(id) {
    const cleanId = encodeURIComponent(id);
    const url = `${this.baseUrl}/api/diagram/${cleanId}/delete`;

    const response = await fetch(url, {
      method: "POST",
      headers: this._getHeaders("application/json"),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || "Delete operation failed.");
    }

    // Clean up local draft
    localStorage.removeItem(`bpmn_draft_${id}`);
    return await response.json();
  }

  /**
   * Coordinates cooperative soft lock actions:
   * 'acquire', 'heartbeat', 'release', 'request_handoff'
   */
  async sendLockAction(id, action) {
    const cleanId = encodeURIComponent(id);
    const url = `${this.baseUrl}/api/diagram/${cleanId}/lock`;

    const response = await fetch(url, {
      method: "POST",
      headers: this._getHeaders("application/json"),
      body: JSON.stringify({ action }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Lock action '${action}' failed.`);
    }

    return await response.json();
  }

  /**
   * Retrieves active lock status and viewer presence.
   */
  async fetchLockStatus(id) {
    const cleanId = encodeURIComponent(id);
    const url = `${this.baseUrl}/api/diagram/${cleanId}/lock/status`;

    const response = await fetch(url, { headers: this._getHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to get lock status (${response.status})`);
    }

    return await response.json();
  }

  /**
   * Pings presence to inform collaborators that this user is viewing the diagram.
   */
  async pingPresence(id) {
    const cleanId = encodeURIComponent(id);
    const url = `${this.baseUrl}/api/diagram/${cleanId}/presence`;

    const response = await fetch(url, {
      method: "POST",
      headers: this._getHeaders("application/json"),
    });

    if (response.ok) {
      return await response.json();
    }
    return null;
  }

  /**
   * Fetches the template registry list.
   */
  async fetchTemplatesRegistry(registryUrl = "templates/templates.json") {
    try {
      const resolved = window.BPMN_APP ? window.BPMN_APP.resolvePath(registryUrl) : registryUrl;
      const response = await fetch(resolved);
      if (!response.ok) {
        throw new Error(`Failed to load templates registry (${response.status})`);
      }
      return await response.json();
    } catch (e) {
      console.warn("[ApiClient] Could not load template registry:", e);
      return [];
    }
  }

  /**
   * Fetches the raw XML of a sample template.
   */
  async fetchTemplateXml(templateFilePath) {
    const resolved = window.BPMN_APP ? window.BPMN_APP.resolvePath(templateFilePath) : templateFilePath;
    const response = await fetch(resolved);
    if (!response.ok) {
      throw new Error(`Failed to load template file '${templateFilePath}'`);
    }
    return await response.text();
  }
}

// Export singleton class
window.BPMNApiClient = BPMNApiClient;
