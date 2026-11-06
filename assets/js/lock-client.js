/**
 * ==============================================================================
 * BPMN ARCHITECT - COOPERATIVE LOCK CLIENT
 * ==============================================================================
 * Coordinates client-side soft locks, heartbeat loops, inactivity detection,
 * and courteous token handoff workflows.
 * ==============================================================================
 */

class BPMNLockClient {
  constructor(apiClient, diagramId, options = {}) {
    this.api = apiClient;
    this.diagramId = diagramId;
    this.heartbeatIntervalSec = options.heartbeatIntervalSec || 15;
    this.idleTimeoutMin = options.idleTimeoutMin || 15;

    // Callbacks for UI events
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onHandoffNotification = options.onHandoffNotification || (() => {});
    this.onLockLost = options.onLockLost || (() => {});

    this.heartbeatTimer = null;
    this.idleTimer = null;
    this.isEditing = false;
    this.lastHandoffNotified = null;

    this._bindIdleListeners();
  }

  _bindIdleListeners() {
    this._resetIdle = this.resetIdleTimer.bind(this);
    window.addEventListener("mousemove", this._resetIdle);
    window.addEventListener("keydown", this._resetIdle);
    window.addEventListener("mousedown", this._resetIdle);

    // Release on tab close if we hold the lock
    window.addEventListener("beforeunload", () => {
      if (this.isEditing) {
        const url = `${this.api.baseUrl}/api/diagram/${encodeURIComponent(this.diagramId)}/lock`;
        const payload = JSON.stringify({ action: "release" });
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon(url, blob);
      }
    });
  }

  /**
   * Attempts to acquire the edit lock and starts heartbeat.
   */
  async acquire() {
    try {
      const res = await this.api.sendLockAction(this.diagramId, "acquire");
      if (res.is_locked && res.locked_by === this.api.username) {
        this.isEditing = true;
        this.startHeartbeat();
        this.resetIdleTimer();
        this.onStatusChange({ isLocked: true, lockedBy: res.locked_by, isOwner: true });
        return { success: true, isOwner: true };
      } else {
        this.isEditing = false;
        this.stopHeartbeat();
        this.onStatusChange({ isLocked: res.is_locked, lockedBy: res.locked_by, isOwner: false });
        return { success: false, lockedBy: res.locked_by, isOwner: false };
      }
    } catch (err) {
      console.error("[LockClient] Failed to acquire lock:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Starts periodic heartbeat requests to renew the lock.
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      try {
        const res = await this.api.sendLockAction(this.diagramId, "heartbeat");
        if (res.locked_by !== this.api.username) {
          console.warn("[LockClient] Lock lost during heartbeat!");
          this.isEditing = false;
          this.stopHeartbeat();
          this.onLockLost();
          return;
        }

        // Check if another user requested a token handoff
        if (res.pending_handoff_to && res.pending_handoff_to !== this.lastHandoffNotified) {
          this.lastHandoffNotified = res.pending_handoff_to;
          this.onHandoffNotification(res.pending_handoff_to);
        }

        this.onStatusChange({
          isLocked: true,
          lockedBy: res.locked_by,
          isOwner: true,
          expiresInSec: res.expires_in_sec,
          activeViewers: res.active_viewers || []
        });
      } catch (hbErr) {
        console.warn("[LockClient] Heartbeat failed (network blip?):", hbErr);
      }
    }, this.heartbeatIntervalSec * 1000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  resetIdleTimer() {
    clearTimeout(this.idleTimer);
    if (!this.isEditing) return;

    const timeoutMs = this.idleTimeoutMin * 60 * 1000;
    this.idleTimer = setTimeout(() => {
      console.warn("[LockClient] Idle timeout reached. Releasing lock.");
      this.release(true);
    }, timeoutMs);
  }

  /**
   * Voluntarily releases the lock.
   */
  async release(isIdleTimeout = false) {
    this.stopHeartbeat();
    clearTimeout(this.idleTimer);
    this.isEditing = false;

    try {
      await this.api.sendLockAction(this.diagramId, "release");
      this.onStatusChange({ isLocked: false, lockedBy: null, isOwner: false });
    } catch (e) {
      console.error("[LockClient] Error during lock release:", e);
    }

    if (isIdleTimeout) {
      this.onLockLost("Inactivity timeout: You have been idle for too long. Edit lock released.");
    }
  }

  /**
   * Requests handoff from the current active editor.
   */
  async requestHandoff() {
    try {
      const res = await this.api.sendLockAction(this.diagramId, "request_handoff");
      return res;
    } catch (e) {
      console.error("[LockClient] Failed to request handoff:", e);
      throw e;
    }
  }

  /**
   * Destroys timers and event listeners.
   */
  destroy() {
    this.stopHeartbeat();
    clearTimeout(this.idleTimer);
    window.removeEventListener("mousemove", this._resetIdle);
    window.removeEventListener("keydown", this._resetIdle);
    window.removeEventListener("mousedown", this._resetIdle);
  }
}

window.BPMNLockClient = BPMNLockClient;

