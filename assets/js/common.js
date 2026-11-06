/**
 * ==============================================================================
 * BPMN ARCHITECT - COMMON UTILITIES & BOOTSTRAPPER
 * ==============================================================================
 * Shared across all distinct views:
 * - Library (/)
 * - Process Viewer (/view/)
 * - Process Editor (/edit/)
 * - Embeddable Viewer (/embed/)
 *
 * Responsibilities:
 * 1. URL Normalization: Strips `.html` extensions from the browser address bar.
 * 2. Configuration & User Info Loading: Fetches `config.json` and `userInfoUrl`.
 * 3. Dynamic Branding & User Pill Rendering.
 * ==============================================================================
 */

// 1. Immediately clean up URL if it ends with .html
(function cleanUrl() {
  try {
    const path = window.location.pathname;
    if (path.endsWith(".html")) {
      let clean = path.replace(/\.html$/, "");
      if (clean.endsWith("/index")) {
        clean = clean.replace(/\/index$/, "/");
      } else if (!clean.endsWith("/")) {
        clean += "/";
      }
      const newUrl = clean + window.location.search + window.location.hash;
      window.history.replaceState(null, "", newUrl);
    }
  } catch (e) {
    console.debug("[Common] URL cleanup bypassed:", e);
  }
})();

// Global namespace for BPMN Architect
window.BPMN_APP = {
  config: null,
  user: null,

  /**
   * Resolves a relative path based on the current page's directory depth.
   */
  resolvePath(relativePath) {
    // If running in a subfolder like /view/ or /edit/, prefix with ../
    const path = window.location.pathname;
    const isSubdir = path.includes("/view") || path.includes("/edit") || path.includes("/embed");
    if (isSubdir && !relativePath.startsWith("/") && !relativePath.startsWith("http")) {
      return "../" + relativePath;
    }
    return relativePath;
  },

  /**
   * Loads `config.json` dynamically.
   */
  async loadConfig() {
    if (this.config) return this.config;
    try {
      const configUrl = this.resolvePath("config.json");
      const res = await fetch(configUrl);
      this.config = await res.json();
    } catch (e) {
      console.warn("[Common] Could not load config.json, using safe defaults:", e);
      this.config = {
        appName: "BPMN Architect",
        appSubtitle: "Collaborative Enterprise Process Modeler",
        endpoints: {
          serviceUrl: "http://127.0.0.1:8001",
          userInfoUrl: "assets/sample-data/user-info.json",
        },
      };
    }
    return this.config;
  },

  /**
   * Fetches the current logged in user information (from userInfoUrl or fallback).
   */
  async loadUser() {
    if (this.user) return this.user;
    const config = await this.loadConfig();
    const userUrl = config.endpoints && config.endpoints.userInfoUrl;

    if (userUrl) {
      try {
        const resolvedUserUrl = this.resolvePath(userUrl);
        const res = await fetch(resolvedUserUrl);
        if (res.ok) {
          this.user = await res.json();
        }
      } catch (e) {
        console.warn("[Common] Could not load user-info from URL:", e);
      }
    }

    if (!this.user) {
      this.user = {
        username: localStorage.getItem("bpmn_user") || "a.taylor",
        name: "Ashley",
        email: "ashley@enterprise.org",
        role: "Process Architect",
      };
    }

    // Persist active username for API client calls
    localStorage.setItem("bpmn_user", this.user.username);
    return this.user;
  },

  /**
   * Populates brand headers, title, and the user badge in the navbar.
   */
  async applyBrandingAndUser() {
    const config = await this.loadConfig();
    const user = await this.loadUser();

    // Brand Name & Subtitle
    const nameEl = document.getElementById("app-brand-name");
    const subEl = document.getElementById("app-brand-subtitle");
    if (nameEl) nameEl.innerText = config.appName || "BPMN Architect";
    if (subEl) subEl.innerText = config.appSubtitle || "Collaborative Process Modeler";

    // User Widget Pill
    const userContainer = document.getElementById("navbar-user-display");
    if (userContainer) {
      userContainer.innerHTML = `
        <div class="d-flex align-items-center gap-2 bg-light px-2 py-1 rounded border">
          <i class="bi bi-person-circle text-primary"></i>
          <span class="small fw-bold text-dark">${user.name || user.username}</span>
        </div>
      `;
    }
  },

  /**
   * Formats an ISO date or timestamp into a friendly relative string (e.g. "5m ago", "2h ago", "yesterday", "3d ago").
   */
  timeAgo(dateInput) {
    if (!dateInput) return "-";
    const date = typeof dateInput === "object" ? dateInput : new Date(dateInput);
    if (isNaN(date.getTime())) return String(dateInput);

    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 0) return "just now";
    if (diffSec < 45) return "just now";
    if (diffSec < 90) return "1m ago";

    const minutes = Math.floor(diffSec / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours === 1) return "1h ago";
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;

    const months = Math.floor(days / 30);
    if (months === 1) return "1mo ago";
    if (months < 12) return `${months}mo ago`;

    const years = Math.floor(days / 365);
    return `${years}y ago`;
  },

  /**
   * Helper to parse query parameter from current URL.
   */
  getQueryParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
  },

  /**
   * Helper to construct clean links between pages.
   */
  getPageUrl(page, id = null) {
    let base = "";
    const path = window.location.pathname;
    const isSubdir = path.includes("/view") || path.includes("/edit") || path.includes("/embed");

    if (page === "library") {
      base = isSubdir ? "../" : "./";
      return base;
    }

    base = isSubdir ? `../${page}/` : `${page}/`;
    if (id) {
      base += `?id=${encodeURIComponent(id)}`;
    }
    return base;
  },

  /**
   * Retrieves lightweight recent diagrams manifest from localStorage.
   * Does NOT store XML payloads, only card metadata.
   */
  getRecentDiagrams() {
    try {
      return JSON.parse(localStorage.getItem("bpmn_recent_diagrams") || "[]");
    } catch (e) {
      return [];
    }
  },

  /**
   * Records or updates a diagram card summary in the user's personal recents list.
   */
  recordRecentDiagram(item) {
    if (!item || !item.id) return;
    try {
      let recents = this.getRecentDiagrams();
      // Remove any existing entry for this diagram ID
      recents = recents.filter(d => d.id !== item.id);
      // Prepend fresh record
      recents.unshift({
        id: item.id,
        friendly_name: item.friendly_name || item.id,
        project_name: item.project_name || "",
        author: item.author || "Unknown",
        last_visited: Date.now(),
        has_svg: item.has_svg !== false
      });
      // Cap at 40 recent items
      if (recents.length > 40) recents = recents.slice(0, 40);
      localStorage.setItem("bpmn_recent_diagrams", JSON.stringify(recents));
    } catch (e) {
      console.warn("[Common] Could not update recent diagrams:", e);
    }
  },

  /**
   * Removes a specific diagram from the user's personal recents list.
   */
  removeRecentDiagram(id) {
    try {
      let recents = this.getRecentDiagrams().filter(d => d.id !== id);
      localStorage.setItem("bpmn_recent_diagrams", JSON.stringify(recents));
      return recents;
    } catch (e) {
      return [];
    }
  },
};

// Auto-run branding when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  window.BPMN_APP.applyBrandingAndUser();
});

