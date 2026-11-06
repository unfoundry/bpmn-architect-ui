/**
 * ==============================================================================
 * BPMN ARCHITECT - BPMN EDITOR & TOOLKIT WRAPPER
 * ==============================================================================
 * Encapsulates the local `bpmn-js` modeler engine, providing:
 * 1. Interactive diagram modeling with native sidebar palette and drag-and-drop.
 * 2. Canvas controls: Auto-fit, zoom, undo, redo, and grid background toggling.
 * 3. Extended BPMN Tools: Dedicated Comment / Text Annotation tools and direct
 *    sidebar element injection (User Task, Service Task, Gateways).
 * 4. Dual-Format Exporters: High-fidelity BPMN 2.0 XML and pre-rendered SVG.
 * 5. Dirty state tracking for safe unsaved exit prompts.
 * ==============================================================================
 */

class BPMNEditorWrapper {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.options = options;
    this.modeler = null;
    this.isDirty = false;

    // Callbacks
    this.onDirtyStateChange = options.onDirtyStateChange || (() => {});

    this._initModeler();
  }

  _initModeler() {
    if (this.modeler) {
      this.modeler.destroy();
      this.modeler = null;
    }

    if (!window.BpmnJS) {
      throw new Error("BPMN-JS modeler engine is not loaded on this page.");
    }

    // Instantiate interactive BpmnModeler
    this.modeler = new window.BpmnJS({
      container: this.container,
      keyboard: { bindTo: window },
    });

    this._bindChangeEvents();
  }

  _bindChangeEvents() {
    if (!this.modeler) return;

    try {
      const eventBus = this.modeler.get("eventBus");
      eventBus.on("commandStack.changed", () => {
        this.setDirty(true);
      });
    } catch (e) {
      console.warn("[Editor] Could not bind commandStack.changed:", e);
    }
  }

  setDirty(dirty) {
    if (this.isDirty !== dirty) {
      this.isDirty = dirty;
      this.onDirtyStateChange(this.isDirty);
    }
  }

  /**
   * Imports BPMN 2.0 XML into the canvas and fits the viewport.
   */
  async loadXml(xmlString) {
    if (!this.modeler) {
      this._initModeler();
    }

    try {
      const result = await this.modeler.importXML(xmlString);
      const canvas = this.modeler.get("canvas");
      canvas.zoom("fit-viewport", "auto");
      this.setDirty(false);
      return result;
    } catch (err) {
      console.error("[Editor] Failed to import XML:", err);
      throw err;
    }
  }

  /**
   * Exports the diagram as formatted BPMN 2.0 XML.
   */
  async exportXml() {
    if (!this.modeler) throw new Error("Modeler not initialized");
    const { xml } = await this.modeler.saveXML({ format: true });
    return xml;
  }

  /**
   * Exports the diagram as an SVG string.
   */
  async exportSvg() {
    if (!this.modeler) throw new Error("Modeler not initialized");
    const { svg } = await this.modeler.saveSVG();
    return svg;
  }

  /**
   * Undo last action.
   */
  undo() {
    try {
      this.modeler.get("commandStack").undo();
    } catch (e) {
      console.warn("[Editor] Undo unavailable:", e);
    }
  }

  /**
   * Redo action.
   */
  redo() {
    try {
      this.modeler.get("commandStack").redo();
    } catch (e) {
      console.warn("[Editor] Redo unavailable:", e);
    }
  }

  /**
   * Fits the diagram to the visible canvas area.
   */
  fitViewport() {
    if (!this.modeler) return;
    try {
      this.modeler.get("canvas").zoom("fit-viewport", "auto");
    } catch (e) {
      console.warn("[Editor] Fit viewport failed:", e);
    }
  }

  zoomIn() {
    if (!this.modeler) return;
    try {
      this.modeler.get("zoomScroll").stepZoom(1);
    } catch (e) {
      console.warn("[Editor] ZoomIn failed:", e);
    }
  }

  zoomOut() {
    if (!this.modeler) return;
    try {
      this.modeler.get("zoomScroll").stepZoom(-1);
    } catch (e) {
      console.warn("[Editor] ZoomOut failed:", e);
    }
  }

  /**
   * Adds a BPMN Text Annotation (Comment) to the active canvas.
   * If an element is currently selected, also draws a bpmn:Association line to it.
   */
  addCommentAnnotation(commentText = "New Comment / Note") {
    if (!this.modeler) return;

    try {
      const elementFactory = this.modeler.get("elementFactory");
      const modeling = this.modeler.get("modeling");
      const canvas = this.modeler.get("canvas");
      const selection = this.modeler.get("selection");

      const selectedElements = selection.get();
      const parent = canvas.getRootElement();

      // Position: either offset from selected element or near center
      let posX = 400;
      let posY = 200;

      let targetShape = null;
      if (selectedElements && selectedElements.length > 0) {
        targetShape = selectedElements[0];
        posX = targetShape.x + (targetShape.width || 100) + 50;
        posY = targetShape.y;
      }

      // 1. Create the Text Annotation shape
      const annotationShape = elementFactory.createShape({
        type: "bpmn:TextAnnotation",
        businessObject: this.modeler.get("bpmnFactory").create("bpmn:TextAnnotation", {
          text: commentText,
        }),
        width: 140,
        height: 60,
      });

      modeling.createShape(annotationShape, { x: posX, y: posY }, parent);

      // 2. If a shape was selected, create an Association connecting them
      if (targetShape) {
        modeling.connect(targetShape, annotationShape, {
          type: "bpmn:Association",
        });
      }

      // Select newly placed annotation for immediate text editing
      selection.select(annotationShape);
      this.setDirty(true);
    } catch (err) {
      console.error("[Editor] Failed to add comment annotation:", err);
    }
  }

  /**
   * Sidebar Quick-Tool Helper: Drops specific BPMN elements onto the canvas.
   */
  createQuickElement(type, name = "") {
    if (!this.modeler) return;

    try {
      const elementFactory = this.modeler.get("elementFactory");
      const modeling = this.modeler.get("modeling");
      const canvas = this.modeler.get("canvas");
      const selection = this.modeler.get("selection");
      const parent = canvas.getRootElement();

      // Find center of current viewport
      const viewbox = canvas.viewbox();
      const targetX = Math.round(viewbox.x + viewbox.width / 2);
      const targetY = Math.round(viewbox.y + viewbox.height / 2);

      const shapeOptions = { type };
      if (name) {
        shapeOptions.businessObject = this.modeler.get("bpmnFactory").create(type, { name });
      }

      const shape = elementFactory.createShape(shapeOptions);
      modeling.createShape(shape, { x: targetX, y: targetY }, parent);
      selection.select(shape);
      this.setDirty(true);
    } catch (err) {
      console.error(`[Editor] Failed to create quick element '${type}':`, err);
    }
  }

  destroy() {
    if (this.modeler) {
      this.modeler.destroy();
      this.modeler = null;
    }
  }
}

window.BPMNEditorWrapper = BPMNEditorWrapper;
