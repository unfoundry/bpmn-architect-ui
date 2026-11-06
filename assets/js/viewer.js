/**
 * ==============================================================================
 * BPMN ARCHITECT - VIEWER ENGINE WRAPPER
 * ==============================================================================
 * Lightweight, read-only diagram viewer wrapper using `bpmn-navigated-viewer`.
 * Provides smooth panning, pinch/wheel zooming, auto-fit, and vector export.
 * Used exclusively on /view/ and /embed/ to prevent any accidental lock acquisitions.
 * ==============================================================================
 */

class BPMNViewerWrapper {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.options = options;
    this.viewer = null;

    this._initViewer();
  }

  _initViewer() {
    if (this.viewer) {
      this.viewer.destroy();
      this.viewer = null;
    }

    // window.BpmnJS is provided by bpmn-navigated-viewer.production.min.js
    this.viewer = new window.BpmnJS({
      container: this.container,
    });
  }

  /**
   * Imports BPMN 2.0 XML and fits canvas to viewport.
   */
  async loadXml(xmlString) {
    if (!this.viewer) {
      this._initViewer();
    }

    try {
      const result = await this.viewer.importXML(xmlString);
      const canvas = this.viewer.get("canvas");
      canvas.zoom("fit-viewport", "auto");
      return result;
    } catch (err) {
      console.error("[Viewer] Failed to render BPMN XML:", err);
      throw err;
    }
  }

  fitViewport() {
    if (!this.viewer) return;
    try {
      this.viewer.get("canvas").zoom("fit-viewport", "auto");
    } catch (e) {
      console.warn("[Viewer] Auto-fit failed:", e);
    }
  }

  zoomIn() {
    if (!this.viewer) return;
    try {
      this.viewer.get("zoomScroll").stepZoom(1);
    } catch (e) {
      console.warn("[Viewer] ZoomIn failed:", e);
    }
  }

  zoomOut() {
    if (!this.viewer) return;
    try {
      this.viewer.get("zoomScroll").stepZoom(-1);
    } catch (e) {
      console.warn("[Viewer] ZoomOut failed:", e);
    }
  }

  async exportXml() {
    if (!this.viewer) throw new Error("Viewer not initialized");
    const { xml } = await this.viewer.saveXML({ format: true });
    return xml;
  }

  async exportSvg() {
    if (!this.viewer) throw new Error("Viewer not initialized");
    const { svg } = await this.viewer.saveSVG();
    return svg;
  }

  destroy() {
    if (this.viewer) {
      this.viewer.destroy();
      this.viewer = null;
    }
  }
}

window.BPMNViewerWrapper = BPMNViewerWrapper;

