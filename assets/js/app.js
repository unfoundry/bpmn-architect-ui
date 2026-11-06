/**
 * ==============================================================================
 * BPMN ARCHITECT - MAIN APPLICATION CONTROLLER
 * ==============================================================================
 * Central orchestration for the static single-page application:
 * - Bootstrapping and dynamic branding from `config.json`
 * - URL Hash-based routing (#library, #edit/{id}, #view/{id})
 * - Process library rendering, template gallery & process creation
 * - Cooperative lock coordination & polite handoff toasts (SweetAlert2)
 * - Safe exit prompts and local draft recovery
 * ==============================================================================
 */

class BPMNApp {
  constructor() {
    this.config = null;
    this.api = null;
    this.editor = null;
    this.lockClient = null;

    this.currentDiagramId = null;
    this.currentDiagramMeta = null;
    this.activeTemplates = [];

    // DOM Elements
    this.dom = {
      brandName: document.getElementById("app-brand-name"),
      brandSubtitle: document.getElementById("app-brand-subtitle"),
      brandIcon: document.getElementById("app-brand-icon"),
      supportEmailLinks: document.querySelectorAll(".app-support-email"),

      dashboardView: document.getElementById("dashboard-view"),
      editorView: document.getElementById("editor-view"),
      diagramsListContainer: document.getElementById("diagrams-list-container"),
      searchFilterInput: document.getElementById("search-diagrams-input"),

      // Editor header & presence elements
      activeProjectName: document.getElementById("header-project-name"),
      dirtyBadge: document.getElementById("dirty-state-badge"),
      lockStatusContainer: document.getElementById("lock-status-container"),
      lockBadge: document.getElementById("lock-status-badge"),
      lockActionBtn: document.getElementById("lock-action-btn"),
      activeViewersList: document.getElementById("active-viewers-list"),

      // Sidebar inputs
      metaProjectName: document.getElementById("meta-project-name"),
      metaFriendlyName: document.getElementById("meta-friendly-name"),
      metaDescription: document.getElementById("meta-description"),
      metaAuthor: document.getElementById("meta-author"),
      metaLastEdited: document.getElementById("meta-last-edited"),

      // Template selection modal container
      templatesContainer: document.getElementById("modal-templates-container"),
    };
  }

  /**
   * Initializes configuration, API client, templates, and routes.
   */
  async init() {
    try {
      // 1. Fetch config.json
      const configRes = await fetch("config.json");
      this.config = await configRes.json();
    } catch (e) {
      console.warn("[App] Could not load config.json, using defaults:", e);
      this.config = {
        appName: "BPMN Architect",
        appSubtitle: "Collaborative Process Modeler",
        endpoints: { serviceUrl: "http://127.0.0.1:8001" },
      };
    }

    // 2. Initialize API Client
    this.api = new BPMNApiClient(this.config);

    // 3. Apply branding
    this._applyBranding();

    // 4. Preload template registry
    this._loadTemplates();

    // 5. Bind global event listeners & navigation
    this._bindEvents();
    window.addEventListener("hashchange", () => this.handleRoute());

    // 6. Execute initial route
    this.handleRoute();
  }

  _applyBranding() {
    if (this.dom.brandName) this.dom.brandName.innerText = this.config.appName || "BPMN Architect";
    if (this.dom.brandSubtitle) this.dom.brandSubtitle.innerText = this.config.appSubtitle || "";
    if (this.config.supportEmail) {
      this.dom.supportEmailLinks.forEach((el) => (el.href = `mailto:${this.config.supportEmail}`));
    }
  }

  async _loadTemplates() {
    const regUrl = (this.config.endpoints && this.config.endpoints.templatesRegistryUrl) || "templates/templates.json";
    this.activeTemplates = await this.api.fetchTemplatesRegistry(regUrl);
    this._renderTemplatePicker();
  }

  _renderTemplatePicker() {
    if (!this.dom.templatesContainer) return;
    this.dom.templatesContainer.innerHTML = this.activeTemplates
      .map(
        (t, idx) => `
        <div class="col-md-6 mb-3">
          <div class="card h-100 template-card p-3 cursor-pointer ${idx === 0 ? "border-primary" : ""}" 
               data-template-id="${t.id}" data-template-file="${t.file}" onclick="app.selectTemplate(this)">
            <div class="d-flex align-items-center gap-2 mb-2">
              <i class="bi ${t.icon || "bi-diagram-2"} text-primary fs-4"></i>
              <h6 class="mb-0 fw-bold">${t.name}</h6>
            </div>
            <p class="small text-muted mb-0">${t.description}</p>
          </div>
        </div>
      `
      )
      .join("");
  }

  selectTemplate(element) {
    document.querySelectorAll(".template-card").forEach((c) => c.classList.remove("border-primary", "bg-light"));
    element.classList.add("border-primary", "bg-light");
    this.selectedTemplateFile = element.getAttribute("data-template-file");
  }

  /**
   * Router: Handles URL Hash Changes (#library, #edit/{id}, #view/{id})
   */
  async handleRoute() {
    const hash = window.location.hash.replace(/^#/, "").trim();

    if (hash.startsWith("edit/")) {
      const diagramId = hash.replace("edit/", "").trim();
      await this.openEditor(diagramId, false);
    } else if (hash.startsWith("view/")) {
      const diagramId = hash.replace("view/", "").trim();
      await this.openEditor(diagramId, true);
    } else {
      await this.showDashboard();
    }
  }

  /**
   * Shows Process Library Dashboard
   */
  async showDashboard() {
    if (this.lockClient) {
      await this.lockClient.release();
      this.lockClient.destroy();
      this.lockClient = null;
    }
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }

    this.currentDiagramId = null;
    this.dom.dashboardView.classList.remove("d-none");
    this.dom.editorView.classList.add("d-none");

    // Toggle header buttons
    const saveBtn = document.getElementById("header-save-btn");
    const closeBtn = document.getElementById("header-close-btn");
    const tools = document.getElementById("ribbon-editor-tools");
    const newBtn = document.getElementById("header-new-btn");
    if (saveBtn) saveBtn.classList.add("d-none");
    if (closeBtn) closeBtn.classList.add("d-none");
    if (tools) tools.classList.add("d-none");
    if (newBtn) newBtn.classList.remove("d-none");
    if (this.dom.dirtyBadge) this.dom.dirtyBadge.classList.add("d-none");
    if (this.dom.activeProjectName) this.dom.activeProjectName.innerText = "Library";

    await this.refreshLibrary();
  }

  async refreshLibrary() {
    this.dom.diagramsListContainer.innerHTML = `
      <div class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading diagram library...</div>
      </div>
    `;

    try {
      const diagrams = await this.api.fetchDiagrams();
      this.renderDiagramCards(diagrams);
    } catch (err) {
      this.dom.diagramsListContainer.innerHTML = `
        <div class="alert alert-warning">
          <i class="bi bi-exclamation-triangle me-2"></i>
          Could not connect to the API service. You may still create new local diagrams or upload .bpmn files.
        </div>
      `;
    }
  }

  renderDiagramCards(diagrams) {
    if (!diagrams || diagrams.length === 0) {
      this.dom.diagramsListContainer.innerHTML = `
        <div class="col-12 text-center py-5">
          <i class="bi bi-diagram-3 text-muted" style="font-size: 3rem;"></i>
          <h5 class="mt-3 text-secondary">No Process Diagrams Found</h5>
          <p class="text-muted small">Create your first diagram using a template or upload an existing .bpmn file.</p>
          <button class="btn btn-primary btn-sm mt-2" data-bs-toggle="modal" data-bs-target="#newDiagramModal">
            <i class="bi bi-plus-lg me-1"></i> Create Process
          </button>
        </div>
      `;
      return;
    }

    const searchTerm = (this.dom.searchFilterInput ? this.dom.searchFilterInput.value : "").toLowerCase().trim();
    const filtered = diagrams.filter(
      (d) =>
        !searchTerm ||
        (d.friendly_name && d.friendly_name.toLowerCase().includes(searchTerm)) ||
        (d.project_name && d.project_name.toLowerCase().includes(searchTerm))
    );

    this.dom.diagramsListContainer.innerHTML = filtered
      .map((d) => {
        const isLocked = Boolean(d.locked_by);
        const lockBadgeHtml = isLocked
          ? `<span class="badge bg-warning text-dark"><i class="bi bi-lock me-1"></i>Locked by ${d.locked_by}</span>`
          : `<span class="badge bg-light text-secondary border"><i class="bi bi-unlock me-1"></i>Available</span>`;

        // Preview image or placeholder
        const previewUrl = `${this.api.baseUrl}/api/diagram/${encodeURIComponent(d.id)}/svg`;

        return `
        <div class="col-md-6 col-lg-4 mb-4">
          <div class="card h-100 process-card shadow-sm">
            <div class="process-preview-box">
              <img src="${previewUrl}" alt="Preview" onerror="this.onerror=null; this.src='assets/img/bpmn-arch.svg'; this.style.opacity=0.3; this.style.width='64px';">
            </div>
            <div class="card-body p-3 d-flex flex-column">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <h6 class="card-title fw-bold text-truncate mb-0" title="${d.friendly_name}">${d.friendly_name}</h6>
                ${lockBadgeHtml}
              </div>
              <p class="small text-muted mb-2">${d.project_name || "Uncategorized Process"}</p>
              <div class="mt-auto pt-2 border-top d-flex justify-content-between align-items-center">
                <span class="small text-muted" style="font-size: 0.72rem;">
                  <i class="bi bi-pencil me-1"></i>${d.last_edited_by || d.author}
                </span>
                <div class="btn-group btn-group-sm">
                  <a href="#edit/${d.id}" class="btn btn-outline-primary btn-sm">
                    <i class="bi bi-pencil-square me-1"></i> Edit
                  </a>
                  <a href="#view/${d.id}" class="btn btn-outline-secondary btn-sm" title="View Only">
                    <i class="bi bi-eye"></i>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      })
      .join("");
  }

  /**
   * Opens Editor View for a Diagram
   */
  async openEditor(diagramId, readOnly = false) {
    this.currentDiagramId = diagramId;
    this.dom.dashboardView.classList.add("d-none");
    this.dom.editorView.classList.remove("d-none");

    // Toggle header ribbon buttons
    const saveBtn = document.getElementById("header-save-btn");
    const closeBtn = document.getElementById("header-close-btn");
    const tools = document.getElementById("ribbon-editor-tools");
    const newBtn = document.getElementById("header-new-btn");
    if (newBtn) newBtn.classList.add("d-none");
    if (tools) tools.classList.remove("d-none");
    if (saveBtn) saveBtn.classList.toggle("d-none", readOnly);
    if (closeBtn) closeBtn.classList.remove("d-none");
    if (this.dom.dirtyBadge) this.dom.dirtyBadge.classList.toggle("d-none", readOnly);

    // Initialize Editor Wrapper
    const canvasContainer = document.getElementById("bpmn-canvas");
    this.editor = new BPMNEditorWrapper(canvasContainer, {
      readOnly: readOnly,
      onDirtyStateChange: (dirty) => this._updateDirtyState(dirty),
    });

    // Initialize Lock Client
    if (!readOnly && this.config.features.enableLocking) {
      this.lockClient = new BPMNLockClient(this.api, diagramId, {
        heartbeatIntervalSec: (this.config.sessions && this.config.sessions.heartbeatIntervalSec) || 15,
        idleTimeoutMin: (this.config.sessions && this.config.sessions.idleTimeoutMin) || 15,
        onStatusChange: (status) => this._renderLockStatus(status),
        onHandoffNotification: (requester) => this._notifyHandoffRequest(requester),
        onLockLost: (msg) => this._handleLockLost(msg),
      });

      // Attempt initial lock acquisition
      const lockRes = await this.lockClient.acquire();
      if (!lockRes.success && !lockRes.isOwner) {
        Swal.fire({
          icon: "info",
          title: "Diagram Currently Locked",
          text: `This diagram is being edited by '${lockRes.lockedBy}'. Opening in View-Only mode.`,
          confirmButtonText: "Continue",
        });
      }
    }

    // Load Diagram Content
    try {
      const xml = await this.api.fetchDiagramXml(diagramId);
      await this.editor.loadXml(xml);

      // Load Metadata
      const meta = await this.api.fetchDiagramMetadata(diagramId).catch(() => null);
      if (meta) {
        this.currentDiagramMeta = meta;
        this._populateMetadataSidebar(meta);
      }
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Load Error",
        text: "Could not load the BPMN diagram. Returning to library.",
      }).then(() => {
        window.location.hash = "#library";
      });
    }
  }

  _populateMetadataSidebar(meta) {
    if (this.dom.activeProjectName) {
      this.dom.activeProjectName.innerText = meta.project_name ? `${meta.project_name} / ${meta.friendly_name}` : meta.friendly_name;
    }
    if (this.dom.metaProjectName) this.dom.metaProjectName.value = meta.project_name || "";
    if (this.dom.metaFriendlyName) this.dom.metaFriendlyName.value = meta.friendly_name || "";
    if (this.dom.metaDescription) this.dom.metaDescription.value = meta.project_description || "";
    if (this.dom.metaAuthor) this.dom.metaAuthor.innerText = meta.author || "Unknown";
    if (this.dom.metaLastEdited) this.dom.metaLastEdited.innerText = meta.last_edited_by || meta.author;
  }

  _updateDirtyState(isDirty) {
    if (!this.dom.dirtyBadge) return;
    if (isDirty) {
      this.dom.dirtyBadge.className = "dirty-indicator dirty";
      this.dom.dirtyBadge.innerHTML = `<i class="bi bi-circle-fill" style="font-size:0.5rem;"></i> Unsaved Changes`;
    } else {
      this.dom.dirtyBadge.className = "dirty-indicator clean";
      this.dom.dirtyBadge.innerHTML = `<i class="bi bi-check2"></i> Saved`;
    }
  }

  _renderLockStatus(status) {
    if (!this.dom.lockBadge) return;

    if (status.isOwner) {
      this.dom.lockBadge.className = "lock-badge locked-self";
      this.dom.lockBadge.innerHTML = `<span class="pulse-dot"></span> Editing (Lock Held)`;
      if (this.dom.lockActionBtn) {
        this.dom.lockActionBtn.innerText = "Yield Lock";
        this.dom.lockActionBtn.onclick = () => this.yieldLock();
        this.dom.lockActionBtn.classList.remove("d-none");
      }
    } else if (status.isLocked) {
      this.dom.lockBadge.className = "lock-badge locked-other";
      this.dom.lockBadge.innerHTML = `<i class="bi bi-lock-fill"></i> Locked by ${status.lockedBy}`;
      if (this.dom.lockActionBtn) {
        this.dom.lockActionBtn.innerText = "Request Token";
        this.dom.lockActionBtn.onclick = () => this.requestLockHandoff();
        this.dom.lockActionBtn.classList.remove("d-none");
      }
    } else {
      this.dom.lockBadge.className = "lock-badge unlocked";
      this.dom.lockBadge.innerHTML = `<i class="bi bi-unlock"></i> Free to Edit`;
      if (this.dom.lockActionBtn) {
        this.dom.lockActionBtn.innerText = "Take Lock";
        this.dom.lockActionBtn.onclick = () => this.lockClient.acquire();
        this.dom.lockActionBtn.classList.remove("d-none");
      }
    }
  }

  /**
   * Polite Token Handoff Notification Toast
   */
  _notifyHandoffRequest(requester) {
    Swal.fire({
      title: "Edit Token Requested",
      text: `'${requester}' would like to edit this diagram. Would you like to save and yield the lock?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Save & Yield",
      cancelButtonText: "Keep Editing",
      confirmButtonColor: "#158cba",
    }).then(async (result) => {
      if (result.isConfirmed) {
        await this.saveDiagram();
        await this.lockClient.release();
        Swal.fire({
          toast: true,
          position: "top-end",
          icon: "success",
          title: "Lock yielded cleanly.",
          showConfirmButton: false,
          timer: 3000,
        });
      }
    });
  }

  _handleLockLost(msg = "You no longer hold the active edit token.") {
    Swal.fire({
      icon: "warning",
      title: "Edit Lock Lost",
      text: `${msg} Your changes have been preserved in local drafts. Switching to View mode.`,
      confirmButtonText: "OK",
    }).then(() => {
      window.location.hash = `#view/${this.currentDiagramId}`;
    });
  }

  async saveDiagram() {
    if (!this.editor) return;

    if (this.dom.dirtyBadge) {
      this.dom.dirtyBadge.className = "dirty-indicator saving";
      this.dom.dirtyBadge.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Saving...`;
    }

    try {
      // 1. Export BPMN XML
      const bpmnXml = await this.editor.exportXml();

      // 2. Export pre-rendered SVG for zero-overhead server preview
      let svgContent = null;
      try {
        svgContent = await this.editor.exportSvg();
      } catch (svgErr) {
        console.warn("[App] SVG export omitted:", svgErr);
      }

      // 3. Metadata updates
      const metadataUpdates = {
        friendly_name: this.dom.metaFriendlyName ? this.dom.metaFriendlyName.value : undefined,
        project_name: this.dom.metaProjectName ? this.dom.metaProjectName.value : undefined,
        project_description: this.dom.metaDescription ? this.dom.metaDescription.value : undefined,
      };

      // 4. Dual-Save via API Client
      await this.api.saveDiagram(this.currentDiagramId, bpmnXml, svgContent, metadataUpdates);
      this.editor.setDirty(false);

      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Diagram & SVG saved successfully",
        showConfirmButton: false,
        timer: 2500,
      });
    } catch (err) {
      this.editor.setDirty(true);
      Swal.fire({
        icon: "error",
        title: "Save Failed",
        text: err.message,
      });
    }
  }

  async saveAndClose() {
    await this.saveDiagram();
    if (this.lockClient) {
      await this.lockClient.release();
    }
    window.location.hash = "#library";
  }

  async yieldLock() {
    if (this.editor && this.editor.isDirty) {
      await this.saveDiagram();
    }
    if (this.lockClient) {
      await this.lockClient.release();
    }
  }

  async requestLockHandoff() {
    if (!this.lockClient) return;
    try {
      await this.lockClient.requestHandoff();
      Swal.fire({
        icon: "info",
        title: "Request Sent",
        text: "The current editor has been notified to yield the lock.",
        confirmButtonText: "OK",
      });
    } catch (e) {
      Swal.fire({ icon: "error", title: "Request Failed", text: e.message });
    }
  }

  async createNewDiagramFromForm() {
    const friendlyName = document.getElementById("new-flow-name").value.trim();
    const projectName = document.getElementById("new-project-name").value.trim();
    const projectDesc = document.getElementById("new-project-desc").value.trim();
    const uploadInput = document.getElementById("new-diagram-upload");

    if (!friendlyName) {
      Swal.fire({ icon: "warning", title: "Name Required", text: "Please provide a flow name." });
      return;
    }

    let initialXml = null;

    // Check if user uploaded a file
    if (uploadInput && uploadInput.files && uploadInput.files[0]) {
      const file = uploadInput.files[0];
      initialXml = await file.text();
    } else if (this.selectedTemplateFile) {
      initialXml = await this.api.fetchTemplateXml(this.selectedTemplateFile).catch(() => null);
    }

    try {
      const newMeta = await this.api.createDiagram(friendlyName, projectName, projectDesc, initialXml);
      // Close modal
      const modalEl = document.getElementById("newDiagramModal");
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      // Navigate to new editor
      window.location.hash = `#edit/${newMeta.id}`;
    } catch (err) {
      Swal.fire({ icon: "error", title: "Creation Failed", text: err.message });
    }
  }

  async deleteCurrentDiagram() {
    if (!this.currentDiagramId) return;

    Swal.fire({
      title: "Delete Diagram?",
      text: "This will permanently remove this process diagram. This cannot be undone.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ff4136",
      confirmButtonText: "Yes, Delete",
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await this.api.deleteDiagram(this.currentDiagramId);
          window.location.hash = "#library";
          Swal.fire({ icon: "success", title: "Deleted", text: "Diagram deleted successfully." });
        } catch (err) {
          Swal.fire({ icon: "error", title: "Delete Failed", text: err.message });
        }
      }
    });
  }

  downloadBpmn() {
    if (!this.editor) return;
    this.editor.exportXml().then((xml) => {
      const blob = new Blob([xml], { type: "application/xml" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const name = (this.dom.metaFriendlyName ? this.dom.metaFriendlyName.value : "process") || "diagram";
      a.download = `${name.replace(/[^a-z0-9_-]/gi, "_")}.bpmn`;
      a.click();
    });
  }

  downloadSvg() {
    if (!this.editor) return;
    this.editor.exportSvg().then((svg) => {
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const name = (this.dom.metaFriendlyName ? this.dom.metaFriendlyName.value : "process") || "diagram";
      a.download = `${name.replace(/[^a-z0-9_-]/gi, "_")}.svg`;
      a.click();
    });
  }

  toggleGrid() {
    const canvasArea = document.querySelector(".canvas-area");
    if (canvasArea) canvasArea.classList.toggle("with-grid");
  }

  _bindEvents() {
    if (this.dom.searchFilterInput) {
      this.dom.searchFilterInput.addEventListener("input", () => {
        this.refreshLibrary();
      });
    }

    // Unsaved Exit Warning
    window.addEventListener("beforeunload", (e) => {
      if (this.editor && this.editor.isDirty && this.config.features.allowOfflineMode) {
        e.preventDefault();
        e.returnValue = "You have unsaved diagram changes!";
      }
    });
  }
}

// Global App Singleton
window.app = new BPMNApp();
document.addEventListener("DOMContentLoaded", () => window.app.init());
